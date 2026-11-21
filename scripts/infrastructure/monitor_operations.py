"""Run deployment monitoring and scoped repairs through the project's isolated Ansible environment."""

import json
import os
from pathlib import Path
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager

if __package__:
    from .deploy_watch import DeploymentWatch, WatchError, inspect_report, validate_hosts
else:
    from deploy_watch import DeploymentWatch, WatchError, inspect_report, validate_hosts


@contextmanager
def ansible_settings(root, state, declared_path):
    ssh = root / ".auth/project-tools/home/.ssh"
    settings = {"ANSIBLE_SSH_ARGS": shlex.join([
        "-F", "none", "-o", "IdentityAgent=none", "-o", "IdentitiesOnly=yes",
        "-o", f"IdentityFile={ssh / 'id_ed25519'}",
        "-o", f"UserKnownHostsFile={ssh / 'known_hosts'}",
        "-o", f"GlobalKnownHostsFile={os.devnull}", "-o", "StrictHostKeyChecking=yes",
    ])}
    config = root / "infra/ansible.cfg"
    if config.exists() or config.is_symlink():
        settings["ANSIBLE_CONFIG"] = str(declared_path(root, "infra/ansible.cfg"))
        yield settings
    else:
        with tempfile.NamedTemporaryFile(dir=state, suffix=".cfg") as config_file:
            config_file.write(b"[defaults]\n")
            config_file.flush()
            settings["ANSIBLE_CONFIG"] = config_file.name
            yield settings


def run_bounded(root, command, timeout, *, quiet=False):
    """Bound the isolated local command group, including its Ansible/SSH controller children."""
    output = subprocess.DEVNULL if quiet else sys.stderr
    with subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL, stdout=output,
                          stderr=output, start_new_session=True) as process:
        try:
            status = process.wait(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    pass
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            if isinstance(error, KeyboardInterrupt):
                raise
            raise WatchError("Operation exceeded its time limit. Reconcile the target before retrying.") from error
        if status:
            raise subprocess.CalledProcessError(status, command)


def private_json(path):
    """Read a bounded, private controller result without following links or special files."""
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid()
                or info.st_mode & 0o077 or info.st_size > 256 * 1024):
            raise WatchError("The monitoring playbook must write a private, bounded report.")
        content = stream.read(256 * 1024 + 1)
    if len(content) > 256 * 1024:
        raise WatchError("Deployment monitoring report exceeds its size limit.")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise WatchError("Duplicate field in deployment monitoring report.")
            result[key] = value
        return result

    return json.loads(content, object_pairs_hook=unique)


def invoke_play(root, directory, op, playbook, hosts, timeout, declared_path, *, probe, check=False):
    config = op.monitor
    inventory = declared_path(root, config.get("inventory") or op.definition["inventory"])
    reviewed = validate_hosts(hosts) if hosts is not None else []
    with tempfile.TemporaryDirectory(dir=directory, prefix="observation-") as scratch:
        run = Path(scratch)
        report = run / "report.json"
        variables = run / "variables.json"
        variables.write_text(json.dumps({
            "operator_watch_report": str(report), "operator_watch_hosts": reviewed,
        }), encoding="utf-8")
        args = ["ansible-playbook", "-i", str(inventory), "--extra-vars", "@" + str(variables)]
        if probe or check:
            args.append("--check")
        if reviewed:
            # The probe may aggregate on the controller. Repairs target only affected aliases.
            limits = sorted(set(reviewed) | ({"localhost"} if probe else set()))
            limit_file = run / "hosts"
            limit_file.write_text("\n".join(limits) + "\n", encoding="ascii")
            # Ansible's limit parser splits an absolute @file on spaces in the checkout path.
            args.extend(["--limit", "@" + limit_file.relative_to(root).as_posix()])
        if not probe:
            # An inventory alias can disappear and later name a group. Check the resolved hosts in
            # the same Ansible invocation before handing control to the existing repair playbook.
            guard = run / "check-hosts.yml"
            guard.write_text(json.dumps([{
                "name": "Verify the diagnosed repair targets",
                "hosts": "all:localhost",
                "gather_facts": False,
                "any_errors_fatal": True,
                "tasks": [{"ansible.builtin.assert": {
                    "that": ["ansible_play_hosts_all | sort(case_sensitive=true) == operator_watch_hosts"],
                    "fail_msg": "Resolved repair targets differ from the diagnosed hosts.",
                }}],
            }]), encoding="utf-8")
            args.append(str(guard))
        args.append(str(declared_path(root, playbook)))
        with ansible_settings(root, run, declared_path) as settings:
            wrapper = root / "scripts/setup/run-project.sh"
            command = ["bash", "-p", str(wrapper), "env", *(f"{k}={v}" for k, v in settings.items()), *args]
            try:
                run_bounded(root, command, timeout, quiet=True)
                if probe:
                    return private_json(report)
            except (OSError, ValueError, subprocess.CalledProcessError) as error:
                raise WatchError(f"Monitoring playbook {playbook} failed. Check its target and private report.") from error


def preview_monitor(root, target_state, op, expected_hosts=None, *, declared_path):
    config = op.monitor
    report = invoke_play(root, target_state, op, config["probe"], expected_hosts,
                         config["timeoutSeconds"], declared_path, probe=True)
    if not isinstance(report, dict) or not isinstance(report.get("nodes"), dict):
        raise WatchError("Monitoring preview requires a nodes object.")
    hosts = validate_hosts(expected_hosts if expected_hosts is not None else list(report["nodes"]))
    inspect_report(report, hosts, config)
    return hosts


@contextmanager
def watched_deployment(root, target_state, op, reviewed_hosts, *, declared_path):
    config = op.monitor
    hosts = validate_hosts(reviewed_hosts)
    with tempfile.TemporaryDirectory(prefix="watch-", dir=target_state) as scratch:
        directory = Path(scratch)

        def sample(timeout):
            return invoke_play(root, directory, op, config["probe"], hosts, timeout, declared_path, probe=True)

        def repair(operation, affected, timeout):
            playbook = op.repair_playbooks[operation]
            deadline = time.monotonic() + timeout
            invoke_play(root, directory, op, playbook, affected, timeout, declared_path, probe=False, check=True)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise WatchError("The repair preview exhausted its time limit.")
            return invoke_play(root, directory, op, playbook, affected, remaining, declared_path, probe=False)

        try:
            with DeploymentWatch(config, sample=sample, repair=repair, directory=directory,
                                 expected_hosts=hosts, require_gate="deployment" in op.definition) as watch:
                watch.checkpoint("before")
                yield watch
                watch.checkpoint("after")
        finally:
            summary = directory / "watch-summary.json"
            if summary.is_file() and not summary.is_symlink():
                summary.replace(target_state / f"last-watch-{op.name}.json")
