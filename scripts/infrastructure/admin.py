#!/usr/bin/env python3
"""Administer project infrastructure through declared operations from scripts or a text menu."""

import argparse
from contextlib import contextmanager, ExitStack, nullcontext
from dataclasses import dataclass, field, replace
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile

if __package__:
    from .deploy_watch import validate_hosts, validate_monitor
    from .fleet_profile import load_fleet_profile
    from .monitor_operations import ansible_settings, preview_monitor, run_bounded, watched_deployment
else:
    from deploy_watch import validate_hosts, validate_monitor
    from fleet_profile import load_fleet_profile
    from monitor_operations import ansible_settings, preview_monitor, run_bounded, watched_deployment


ROOT = Path(__file__).resolve().parents[2]
NAME = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z")
PLAN_ID = re.compile(r"[0-9a-f]{32}\Z")
ANSIBLE_PLAY = Path("scripts/infrastructure/ansible/deploy.yml")
ANSIBLE_MODULE = ANSIBLE_PLAY.parent / "library" / "deploy_cpu_step.py"
FLEET_TASKS = ANSIBLE_PLAY.parent / "verify_fleet.yml"
FLEET_HELPER = ANSIBLE_PLAY.parent.parent / "fleet_profile.py"


class OperationError(Exception):
    """An operation cannot proceed with the selected configuration or plan."""


def unique_fields(fields):
    result = {}
    for key, value in fields:
        if key in result:
            raise OperationError(f"Duplicate configuration field: {key!r}")
        result[key] = value
    return result


def declared_path(root, value, directory=False):
    if not isinstance(value, str) or not value.isprintable() or "\\" in value:
        raise OperationError("Use repository-relative infrastructure paths.")
    parts = value.split("/")
    if parts[0] != "infra" or any(
        part in ("", ".", "..") or re.match(r"[A-Za-z]:", part) for part in parts
    ):
        raise OperationError(f"Expected a path inside infra/: {value!r}")
    result = root
    for part in parts:
        result = result / part
        if result.is_symlink():
            raise OperationError(f"Linked infrastructure path: {value!r}")
    exists = result.is_dir() if directory else result.is_file()
    if not exists:
        raise OperationError(f"Missing infrastructure input: {value!r}")
    return result


def validate_deployment(root, deployment):
    required_fields = {"activate", "cpuStep"}
    if not isinstance(deployment, dict) or set(deployment) - {"prepare"} != required_fields:
        raise OperationError("A deployment requires activate and cpuStep; prepare is optional. Its fleet profile owns the group.")
    for field in ("prepare", "activate"):
        if field in deployment:
            declared_path(root, deployment[field])
    step = deployment["cpuStep"]
    if not isinstance(step, dict) or set(step) - {"maxWorkers", "reserveMemoryMiB"} != {
        "argv", "minimumCpuFraction", "memoryMiBPerWorker"
    }:
        raise OperationError("cpuStep requires argv, minimumCpuFraction and memoryMiBPerWorker.")
    argv = step["argv"]
    if (
        not isinstance(argv, list) or not argv
        or any(not isinstance(arg, str) or "\0" in arg for arg in argv)
        or not argv[0].startswith("/") or "{workers}" in argv[0]
        or not any("{workers}" in arg for arg in argv[1:])
    ):
        raise OperationError("cpuStep.argv requires an absolute executable and a literal {workers} argument.")
    for name, lower, upper in [
        ("memoryMiBPerWorker", 1, 2**31 - 1), ("reserveMemoryMiB", 0, 2**31 - 1),
        ("maxWorkers", 1, 65536),
    ]:
        if name in step and (type(step[name]) is not int or not lower <= step[name] <= upper):
            raise OperationError(f"cpuStep.{name} must be an integer from {lower} to {upper}.")
    fraction = step["minimumCpuFraction"]
    if type(fraction) not in (int, float) or not 0 < fraction <= 1 or not math.isfinite(fraction):
        raise OperationError("cpuStep.minimumCpuFraction must be a finite number greater than 0 through 1.")


@dataclass(frozen=True)
class Operation:
    """Bind a named admin task to its target and versioned engine configuration."""

    target: str
    name: str
    definition: dict
    profile: dict = None
    profile_digest: str = None
    monitor: dict = None
    repair_playbooks: dict = field(default_factory=dict)

    @property
    def managed_ansible(self):
        return self.engine == "ansible" and self.profile is not None

    @property
    def baseline(self):
        return {key: self.profile[key] for key in (
            "distribution", "majorVersion", "sysctls", "packages", "files"
        ) if key in self.profile}

    @property
    def engine(self):
        return self.definition["engine"]


def load_operations(root):
    """Return the project's named operations. A new project starts with an empty catalog."""
    catalog = root / "infra" / "operations.json"
    if not catalog.exists() and not catalog.is_symlink() and not catalog.parent.is_symlink():
        return {}
    catalog = declared_path(root, "infra/operations.json")
    document = json.loads(catalog.read_text(encoding="utf-8"), object_pairs_hook=unique_fields)
    if not isinstance(document, dict) or set(document) != {"targets"}:
        raise OperationError("infra/operations.json requires a targets object.")
    if not isinstance(document["targets"], dict):
        raise OperationError("infra/operations.json requires a targets object.")
    operations = {}
    modules = set()
    for target, group in document["targets"].items():
        if not NAME.fullmatch(target) or not isinstance(group, dict) or set(group) != {"operations"}:
            raise OperationError(f"Invalid target or operations object: {target!r}")
        if not isinstance(group["operations"], dict):
            raise OperationError(f"Invalid target or operations object: {target!r}")
        for name, definition in group["operations"].items():
            if not NAME.fullmatch(name) or not isinstance(definition, dict):
                raise OperationError(f"Invalid operation in {target!r}: {name!r}")
            fields = set(definition) - {"parallelism", "fleetProfile", "monitor", "remediation", "purpose"}
            profile = None
            profile_digest = None
            if "fleetProfile" in definition:
                profile_path = declared_path(root, definition["fleetProfile"])
                profile_digest = file_digest(profile_path)
                profile = load_fleet_profile(root, definition["fleetProfile"], declared_path)
                if file_digest(profile_path) != profile_digest:
                    raise OperationError("Fleet profile changed while reading its contract.")
            if "parallelism" in definition:
                limit = definition["parallelism"]
                if type(limit) is not int or not 1 <= limit <= 256:
                    raise OperationError(
                        f"parallelism for {target}/{name} must be an integer from 1 to 256."
                    )
            monitor = None
            if "monitor" in definition:
                monitor = validate_monitor(root, definition["monitor"], declared_path)
                if definition.get("engine") == "terraform" and "inventory" not in monitor:
                    raise OperationError("Terraform deployment monitoring requires an Ansible inventory.")
            if definition.get("engine") == "terraform" and fields == {"engine", "directory"}:
                module = declared_path(root, definition["directory"], directory=True)
                if module in modules:
                    raise OperationError("Each Terraform operation requires its own root module.")
                modules.add(module)
            elif definition.get("engine") == "ansible" and profile is None and fields == {
                "engine", "playbook", "inventory"
            }:
                declared_path(root, definition["playbook"])
                declared_path(root, definition["inventory"])
            elif definition.get("engine") == "ansible" and profile is not None and fields in (
                {"engine", "inventory"}, {"engine", "inventory", "deployment"}
            ):
                declared_path(root, definition["inventory"])
                if "deployment" in definition:
                    validate_deployment(root, definition["deployment"])
                    if monitor is None:
                        raise OperationError("A managed deployment requires a live monitor.")
                elif monitor is not None:
                    raise OperationError("A fleet baseline convergence cannot declare a deployment monitor.")
            else:
                raise OperationError(f"Unsupported engine or fields in {target}/{name}.")
            if "remediation" in definition:
                record = definition["remediation"]
                if (definition.get("engine") != "ansible" or "playbook" not in definition
                        or monitor is not None or not isinstance(record, dict)
                        or set(record) != {"preconditions", "impact", "verification", "rollback"}
                        or any(not isinstance(value, str) or not value.strip() for value in record.values())):
                    raise OperationError("An ordinary unmonitored Ansible remediation operation requires "
                                         "preconditions, impact, verification and rollback descriptions.")
            # A module or a custom playbook can deploy under any operation name.
            generic = definition["engine"] == "terraform" or (
                "playbook" in definition and "remediation" not in definition
            )
            if "purpose" in definition and (
                not generic or definition["purpose"] not in ("deployment", "maintenance")
            ):
                raise OperationError(
                    "Only a Terraform module or custom playbook may set purpose to deployment or maintenance."
                )
            if generic and monitor is None and definition.get("purpose") != "maintenance":
                raise OperationError(
                    "A deployment requires a live monitor. Mark a non-deployment operation with purpose maintenance."
                )
            operations[target, name] = Operation(target, name, definition, profile, profile_digest, monitor)
    for key, op in operations.items():
        if op.monitor is None or not op.monitor.get("repairs"):
            continue
        inventory = op.monitor.get("inventory") or op.definition.get("inventory")
        owners = {}
        for owner_name in set(op.monitor["repairs"].values()):
            owner = operations.get((op.target, owner_name))
            if (owner is None or owner == op or owner.engine != "ansible" or owner.monitor is not None
                    or "remediation" not in owner.definition or owner.definition["inventory"] != inventory
                    or (op.engine == "ansible" and op.definition["inventory"] != inventory)):
                raise OperationError(
                    f"Repair {owner_name!r} must name a documented ordinary Ansible remediation operation "
                    f"on the same target and inventory as {op.target}/{op.name}."
                )
            owners[owner_name] = owner.definition["playbook"]
        operations[key] = replace(op, repair_playbooks=owners)
    return operations


def private_directory(parent, name, private=True):
    directory = parent / name
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or (hasattr(os, "getuid") and info.st_uid != os.getuid()):
        raise OperationError(f"Unsafe state directory: {directory}")
    if os.name == "posix" and info.st_mode & (0o077 if private else 0o022):
        raise OperationError(f"Unsafe state directory permissions: {directory}")
    return directory


@contextmanager
def target_lock(directory):
    # The OS releases the lock when the operation exits, including interruption.
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(directory / "operation.lock", flags, 0o600), "r+b") as lock:
        if os.name == "nt":
            import msvcrt
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise OperationError("Another infrastructure operation owns this target.") from error
        else:
            import fcntl
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise OperationError("Another infrastructure operation owns this target.") from error
        yield


def file_digest(file):
    info = file.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise OperationError(f"Expected a regular file: {file}")
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(128 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ansible_inputs(root, op):
    # Includes imported roles, variables, templates and dynamic-inventory programs in infra/.
    digest = hashlib.sha256()

    def traversal_error(error):
        raise error

    def bind(file):
        if file.resolve() != file:
            raise OperationError(f"Linked Ansible input: {file}")
        entry = [file.relative_to(root).as_posix(), file.lstat().st_mode, file_digest(file)]
        digest.update(json.dumps(entry).encode("utf-8"))

    module = root / ANSIBLE_MODULE
    if not module.is_file():
        raise OperationError(f"Missing managed Ansible module: {ANSIBLE_MODULE}")
    if op.managed_ansible:
        for shipped in (ANSIBLE_PLAY, FLEET_TASKS, FLEET_HELPER):
            bind(root / shipped)
    if op.monitor is not None:
        for helper in ("deploy_watch.py", "monitor_operations.py"):
            bind(root / FLEET_HELPER.parent / helper)
    for source in (root / "infra", module.parent):
        if source.resolve() != source:
            raise OperationError(f"Linked Ansible input directory: {source}")
        for parent, directories, files in os.walk(source, onerror=traversal_error):
            parent = Path(parent)
            directories[:] = sorted(d for d in directories if d not in {".terraform", "__pycache__"})
            if any((parent / d).is_symlink() for d in directories):
                raise OperationError("Ansible inputs must reside inside their project source tree.")
            for name in sorted(files):
                bind(parent / name)
    return digest.hexdigest()


def reviewed_deployment_hosts(directory):
    file = directory / "ansible-hosts.json"
    if file.is_symlink() or not file.is_file():
        raise OperationError("The deployment did not record its inventory hosts.")
    hosts = json.loads(file.read_text(encoding="utf-8"))
    if (
        not isinstance(hosts, list) or not hosts
        or any(not isinstance(host, str) or not host or not host.isprintable() for host in hosts)
        or hosts != sorted(set(hosts))
    ):
        raise OperationError("The deployment needs a nonempty reviewed list of inventory hosts.")
    return hosts


def literal_ansible_value(value):
    if isinstance(value, str):
        # Ansible resolves numeric/bool-like scalars again under !unsafe, losing string types.
        # Plain quoted strings preserve their types. Only template expressions need the tag.
        tagged = any(token in value for token in ("{{", "{%", "{#", "#jinja2:"))
        return ("!unsafe " if tagged else "") + json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ", ".join(literal_ansible_value(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ", ".join(
            f"{json.dumps(key, ensure_ascii=False)}: {literal_ansible_value(item)}"
            for key, item in value.items()
        ) + "}"
    return json.dumps(value, allow_nan=False)


@contextmanager
def managed_ansible_variables(root, state, op, action, plan_directory, reviewed_hosts, watch_dir, timeout):
    deployment = op.definition.get("deployment")
    variables = {
        "operator_deploy_group": op.profile["group"],
        "operator_fleet_profile": op.baseline,
        "operator_managed_deployment": deployment is not None,
        "operator_fleet_report_only": deployment is None and action == "plan",
        "operator_converge_tasks": str(declared_path(root, op.profile["converge"])),
    }
    if deployment:
        step = deployment["cpuStep"]
        variables.update(
            operator_activate_tasks=str(declared_path(root, deployment["activate"])),
            operator_cpu_argv=step["argv"],
            operator_cpu_limits={
                "memory_mib_per_worker": step["memoryMiBPerWorker"],
                "minimum_cpu_fraction": step["minimumCpuFraction"],
                **({"max_workers": step["maxWorkers"]} if "maxWorkers" in step else {}),
                "reserve_memory_mib": step.get("reserveMemoryMiB", 0),
            },
        )
        if "prepare" in deployment:
            variables["operator_prepare_tasks"] = str(declared_path(root, deployment["prepare"]))
    if action == "plan":
        variables["operator_record_hosts"] = str(plan_directory / "ansible-hosts.json")
    else:
        variables["operator_reviewed_hosts"] = reviewed_hosts
        if deployment:
            if watch_dir is None:
                raise OperationError("A managed deployment requires an active observer.")
            variables["operator_watch_dir"] = str(watch_dir)
            variables["operator_watch_timeout"] = max(1, math.ceil(timeout))
    # !unsafe preserves literal task paths and argv, including strings that resemble Jinja.
    # A private file also keeps arguments and large host lists out of the process command line.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".yml", dir=state) as stream:
        for name, value in variables.items():
            stream.write(f"{name}: {literal_ansible_value(value)}\n")
        stream.flush()
        yield stream.name


def run_engine(root, target_state, op, action, plan_directory=None, reviewed_hosts=None,
               watch_dir=None, timeout=None):
    # The project wrapper owns the account allowlist and locked tool environment. Invoke it at
    # dispatch even when an administrator imports the SDK outside a canonical session.
    settings = {}
    variables = nullcontext()
    limit = op.definition.get("parallelism")
    if op.engine == "terraform":
        directory = declared_path(root, op.definition["directory"], directory=True)
        data = private_directory(target_state, op.name)
        settings.update(
            TF_DATA_DIR=str(data), TF_WORKSPACE="default", TF_IN_AUTOMATION="1", TF_INPUT="0"
        )
        if op.profile is not None:
            settings["TF_VAR_fleet_profile"] = json.dumps(op.baseline, separators=(",", ":"))
        args = ["terraform", f"-chdir={directory}", action, "-input=false"]
        if action != "init" and limit is not None:
            args.append(f"-parallelism={limit}")
        if action == "plan":
            args.append(f"-out={plan_directory / 'terraform.plan'}")
        elif action == "apply":
            args.append(str(plan_directory / "terraform.plan"))
    else:
        if op.managed_ansible:
            playbook = root / ANSIBLE_PLAY
            variables = managed_ansible_variables(
                root, target_state, op, action, plan_directory, reviewed_hosts, watch_dir, timeout
            )
        else:
            playbook = declared_path(root, op.definition["playbook"])
        inventory = declared_path(root, op.definition["inventory"])
        args = ["ansible-playbook", "-i", str(inventory), "-M", str((root / ANSIBLE_MODULE).parent)]
        if limit is not None:
            args.extend(["--forks", str(limit)])
        if action == "plan":
            preview_message = (
                "Auditing the target fleet. Convergence, staging and activation are skipped." if op.managed_ansible else
                "Ansible check mode skips unsupported modules. Tasks with check_mode: false can execute."
            )
            print(preview_message, file=sys.stderr)
            args.append("--check")
        args.append(str(playbook))
    wrapper = root / "scripts" / "setup" / "run-project.sh"
    dispatch = ["bash", "-p", str(wrapper), "env"]
    try:
        with ExitStack() as temporary:
            if op.engine == "ansible":
                settings.update(temporary.enter_context(ansible_settings(root, target_state, declared_path)))
            extra_vars = temporary.enter_context(variables)
            dispatch.extend(f"{key}={value}" for key, value in settings.items())
            if extra_vars:
                args[-1:-1] = ["--extra-vars", f"@{extra_vars}"]
            if watch_dir is not None:
                run_bounded(root, dispatch + args, timeout)
            else:
                subprocess.run(
                    dispatch + args, cwd=root, check=True, stdin=subprocess.DEVNULL, stdout=sys.stderr
                )
    except FileNotFoundError as error:
        raise OperationError(f"Install the project-selected {args[0]} executable.") from error
    except subprocess.CalledProcessError as error:
        raise OperationError(f"{args[0]} {action} exited with status {error.returncode}.") from error


def execute(root, target, operation, action, plan_id=None):
    """Initialize, preview or apply a named operation. Successful previews return a one-use ID."""
    root = Path(root).resolve()
    op = load_operations(root).get((target, operation))
    if op is None:
        raise OperationError(f"Unknown infrastructure operation: {target!r}/{operation!r}")
    if action not in {"init", "plan", "apply"} or (action == "init" and op.engine != "terraform"):
        raise OperationError(f"Unsupported {op.engine} action: {action}")
    if action == "apply" and (not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id)):
        raise OperationError("Apply requires the plan ID returned by the preview.")
    project_state = private_directory(root, ".project-state", private=False)
    state = private_directory(project_state, "infrastructure")
    targets = private_directory(state, "targets")
    target_state = private_directory(targets, op.target)
    with target_lock(target_state):
        if action == "init":
            run_engine(root, target_state, op, action)
            return None
        plans = private_directory(state, "plans")
        last_apply = target_state / "last-apply.json"
        binding = {
            "root": str(root),
            "target": op.target,
            "operation": op.name,
            "definition": op.definition,
            "previousApply": file_digest(last_apply) if last_apply.exists() else None,
        }
        if op.profile is not None:
            if file_digest(declared_path(root, op.definition["fleetProfile"])) != op.profile_digest:
                raise OperationError("The fleet profile changed before the operation.")
            binding["fleetProfileSha256"] = op.profile_digest
        if op.engine == "ansible" or op.monitor is not None:
            binding["inputs"] = ansible_inputs(root, op)
        if action == "plan":
            plan_id = secrets.token_hex(16)
            directory = plans / plan_id
            directory.mkdir(mode=0o700)
            try:
                artifact = directory / "terraform.plan"
                run_engine(root, target_state, op, action, directory)
                if (op.profile is not None and
                        file_digest(declared_path(root, op.definition["fleetProfile"])) != op.profile_digest):
                    raise OperationError("Fleet profile changed during preview. Plan again.")
                if op.engine == "terraform":
                    binding["artifact"] = file_digest(artifact)
                if op.managed_ansible:
                    binding["hosts"] = reviewed_deployment_hosts(directory)
                if op.monitor is not None:
                    binding["watchHosts"] = preview_monitor(
                        root, target_state, op, binding.get("hosts"), declared_path=declared_path
                    )
                if "inputs" in binding and binding["inputs"] != ansible_inputs(root, op):
                    raise OperationError("Ansible or observer inputs changed during preview. Plan again.")
                (directory / "review.json").write_text(json.dumps(binding), encoding="utf-8")
            except BaseException:
                shutil.rmtree(directory)
                raise
            return plan_id
        directory = plans / plan_id
        receipt = directory / "review.json"
        if directory.is_symlink() or receipt.is_symlink() or not receipt.is_file():
            raise OperationError(
                "Plan is missing or already used. Reconcile the target before planning again."
            )
        approved = json.loads(receipt.read_text(encoding="utf-8"))
        if not isinstance(approved, dict):
            raise OperationError("Invalid infrastructure plan receipt.")
        artifact = directory / "terraform.plan"
        if op.engine == "terraform" and approved.get("definition") == op.definition:
            binding["artifact"] = file_digest(artifact)
        if op.managed_ansible:
            binding["hosts"] = reviewed_deployment_hosts(directory)
        if op.monitor is not None:
            watch_hosts = validate_hosts(approved.get("watchHosts"))
            if op.managed_ansible and watch_hosts != binding["hosts"]:
                raise OperationError("Invalid monitored host membership in the reviewed plan.")
            binding["watchHosts"] = watch_hosts
        if approved != binding:
            raise OperationError(
                "The plan does not match this target, operation or its current inputs."
            )
        # Invalidate all older previews for the target before dispatch, even on partial failure.
        receipt.replace(last_apply)
        try:
            observer = (
                watched_deployment(root, target_state, op, binding["watchHosts"], declared_path=declared_path)
                if op.monitor is not None else nullcontext()
            )
            with observer as watch:
                run_engine(root, target_state, op, action, directory, binding.get("hosts"),
                           watch.directory if watch else None, watch.remaining_seconds() if watch else None)
        except (OperationError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            raise OperationError(f"{error} Reconcile {op.target} before planning again.") from error
        shutil.rmtree(directory)
        return None


def menu(root, operations):
    entries = sorted(operations)
    if not entries:
        print("No infrastructure operations configured in infra/operations.json.")
        return
    while True:
        for index, (target, name) in enumerate(entries, 1):
            print(f"{index}. {target} / {name} ({operations[target, name].engine})")
        choice = input("Select an operation, or q to quit: ").strip()
        if choice.lower() == "q":
            return
        if not choice.isascii() or not choice.isdecimal() or not 1 <= int(choice) <= len(entries):
            print("Choose a listed number.")
            continue
        op = operations[entries[int(choice) - 1]]
        choices = ["plan", "apply"] + (["init"] if op.engine == "terraform" else [])
        action = input(f"{op.target}/{op.name} [{', '.join(choices)}, back]: ").strip().lower()
        if action == "back":
            continue
        if action not in choices:
            print("Choose a listed action.")
            continue
        plan_id = None
        if action == "apply":
            plan_id = input("Reviewed plan ID: ").strip()
            selection = f"{op.target}/{op.name}"
            if input(f"Type {selection} to apply, or Enter to cancel: ").strip() != selection:
                print("Apply cancelled.")
                continue
        try:
            result = execute(root, op.target, op.name, action, plan_id)
            print(f"Plan ID: {result}" if result else f"{action.capitalize()} complete.")
        except (OperationError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            print(f"Operation failed: {error}", file=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("list", help="list configured targets and operations")
    commands.add_parser("tui", help="open the administrator's text menu")
    for action, help_text in [
        ("init", "initialize a Terraform root module"),
        ("plan", "preview and print its plan ID"),
        ("apply", "apply a reviewed plan"),
    ]:
        command = commands.add_parser(action, help=help_text)
        command.add_argument("--target", required=True)
        command.add_argument("--operation", required=True)
        if action == "apply":
            command.add_argument("--plan", required=True, help="the ID from plan")
    args = parser.parse_args(argv)
    if args.action == "tui":
        menu(ROOT, load_operations(ROOT))
    elif args.action == "list":
        operations = load_operations(ROOT)
        if not operations:
            print("No infrastructure operations configured in infra/operations.json.")
        for key in sorted(operations):
            print(*key, operations[key].engine, sep="\t")
    else:
        result = execute(ROOT, args.target, args.operation, args.action, getattr(args, "plan", None))
        if result:
            print(result)


if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        sys.exit(130)
    except (OperationError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as failure:
        print(f"Infrastructure operation failed: {failure}", file=sys.stderr)
        sys.exit(1)
