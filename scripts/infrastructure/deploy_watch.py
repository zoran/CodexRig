"""Watch deployment health and admit stable rollout checkpoints on the reviewed fleet."""
from collections import deque
from contextlib import suppress
import json
import math
import os
import re
import stat
import sys
import threading
import time
from uuid import uuid4


class WatchError(ValueError):
    """Invalid watch input or a deployment that cannot be accepted as healthy."""


HOST = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,252}\Z", re.ASCII)
CODE = re.compile(r"[a-z][a-z0-9_-]{0,47}\Z", re.ASCII)
METRICS = {"latencyMs": "latency-limit", "errorRate": "error-limit", "load": "load-limit"}
OPERATION = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z", re.ASCII)
GENERIC_CAUSES = {
    "ok", "unknown", "unhealthy", "error", "errors", "failed", "load", "latency",
    "high-load", "high-latency", "high-error-rate", "probe-failed", "probe-error",
    "timed-out", "timeout", "unreachable", *METRICS.values(),
}
MAX_HOSTS = 2048
REQUEST = "watch-request"
RESPONSE = "watch-response"
STATUS = "watch-summary.json"


def _number(value, low, high):
    return type(value) in (int, float) and low <= value <= high and math.isfinite(value)


def validate_hosts(hosts):
    """Return sorted literal inventory aliases suitable for a reviewed Ansible limit file."""
    if (not isinstance(hosts, (tuple, list)) or not 1 <= len(hosts) <= MAX_HOSTS
            or any(not isinstance(host, str) or not HOST.fullmatch(host)
                   or host.lower() in {"all", "ungrouped"} for host in hosts)
            or len(set(hosts)) != len(hosts)):
        raise WatchError("Expected unique literal inventory host names for the deployment watch.")
    return sorted(hosts)


def _specific_cause(code):
    if not isinstance(code, str) or not CODE.fullmatch(code):
        return False
    normalized = code.replace("_", "-")
    return (normalized not in GENERIC_CAUSES and
            not normalized.endswith(("-limit", "-timeout", "-timed-out", "-unreachable")))


def validate_monitor(root, block, declared_path):
    """Validate all project paths and return the effective monitor configuration."""
    if (not isinstance(block, dict) or "probe" not in block
            or set(block) - {"probe", "inventory", "intervalSeconds", "timeoutSeconds",
                             "maxDeploySeconds", "limits", "repairs"}):
        raise WatchError("A deployment monitor requires a reviewed Ansible probe and known fields.")
    config = dict(block)
    declared_path(root, config["probe"])
    if "inventory" in config:
        declared_path(root, config["inventory"])
    for name, default, low, high in (
        ("intervalSeconds", 10, 0.1, 300), ("timeoutSeconds", 30, 0.1, 300),
        ("maxDeploySeconds", 1800, 1, 86400),
    ):
        if not _number(config.setdefault(name, default), low, high):
            raise WatchError(f"monitor.{name} must be a finite number from {low} to {high}.")
    limits = config.setdefault("limits", {})
    if not isinstance(limits, dict) or set(limits) - METRICS.keys():
        raise WatchError("Use latencyMs, errorRate or load as deployment monitor limits.")
    for metric, value in limits.items():
        if not _number(value, 0, 1 if metric == "errorRate" else 1e18):
            raise WatchError(f"Invalid monitor limit for {metric}.")
    repairs = config.setdefault("repairs", {})
    if not isinstance(repairs, dict) or len(repairs) > 16:
        raise WatchError("monitor.repairs accepts at most 16 diagnoses and named operations.")
    for cause, operation in repairs.items():
        if not _specific_cause(cause):
            raise WatchError("A repair requires a specific diagnosed cause, not a symptom.")
        if not isinstance(operation, str) or not OPERATION.fullmatch(operation):
            raise WatchError("A repair must name an existing operation on the same target.")
    return config


def inspect_report(report, expected_hosts, config):
    """Bind a fresh observation to every reviewed host and classify explicit symptoms and limits."""
    hosts = validate_hosts(expected_hosts)
    if not isinstance(report, dict) or set(report) != {"nodes"}:
        raise WatchError("A monitor observation requires a nodes object.")
    nodes = report["nodes"]
    if not isinstance(nodes, dict) or len(nodes) != len(hosts) or set(nodes) != set(hosts):
        raise WatchError("Monitor observation membership differs from the reviewed inventory.")
    issues = {}
    causes = {}
    undiagnosed = []
    maxima = dict.fromkeys(METRICS, 0)
    for host in hosts:
        node = nodes[host]
        if not isinstance(node, dict) or set(node) - {"cause"} != {"status", "code", "metrics"}:
            raise WatchError("Each observed node requires status, code and metrics.")
        status, code, metrics = node["status"], node["code"], node["metrics"]
        if (status not in ("healthy", "unhealthy") or not isinstance(code, str)
                or not CODE.fullmatch(code) or (status == "healthy") != (code == "ok")):
            raise WatchError("Invalid node status or incident code.")
        if not isinstance(metrics, dict) or metrics.keys() != METRICS.keys():
            raise WatchError("Each node requires numeric latencyMs, errorRate and load.")
        if "cause" in node and (status != "unhealthy" or not _specific_cause(node["cause"])):
            raise WatchError("Only an unhealthy node may report a specific diagnosed cause.")
        host_codes = set() if status == "healthy" else {code}
        for name, value in metrics.items():
            if not _number(value, 0, 1 if name == "errorRate" else 1e18):
                raise WatchError(f"Invalid node measurement for {name}.")
            maxima[name] = max(maxima[name], value)
            limit = config["limits"].get(name)
            if limit is not None and value > limit:
                host_codes.add(METRICS[name])
        if host_codes:
            if "cause" in node:
                causes.setdefault(node["cause"], []).append(host)
            else:
                undiagnosed.append(host)
        for issue in sorted(host_codes):
            issues.setdefault(issue, []).append(host)
    return {"healthy": not issues, "issues": issues, "maxima": maxima,
            "causes": causes, "undiagnosed": undiagnosed}


class DeploymentWatch:
    """One owned observation thread. Callbacks must bound and reap their child processes.

    sample(timeout_seconds) returns the decoded probe report. repair(named_operation, literal_hosts,
    timeout_seconds) applies only the named target-scoped repair and raises on failure.
    """

    def __init__(self, config, sample, repair, directory, expected_hosts, *, require_gate=False):
        self.config = config
        self.sample = sample
        self.repair = repair
        self.hosts = validate_hosts(expected_hosts)
        self.directory = directory
        self.require_gate = require_gate
        self._fd = None
        self._thread = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._gates = set()
        self._history = deque(maxlen=16)
        self._anomalies_printed = 0
        self._attempted = set()
        self._samples = 0
        self._incident = False
        self._fatal = None
        self._next_probe = None

    def remaining_seconds(self):
        remaining = self._deadline - time.monotonic()
        if remaining <= 0:
            raise WatchError("Deployment monitor timed out.")
        return remaining

    def _publish(self, name, value, *, exclusive=False):
        temp = f".watch-{uuid4().hex}"
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
                     dir_fd=self._fd)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(value, stream, allow_nan=False, separators=(",", ":"))
            if exclusive:
                os.link(temp, name, src_dir_fd=self._fd, dst_dir_fd=self._fd, follow_symlinks=False)
            else:
                os.replace(temp, name, src_dir_fd=self._fd, dst_dir_fd=self._fd)
        finally:
            with suppress(FileNotFoundError):
                os.unlink(temp, dir_fd=self._fd)

    def _record(self, phase, event, **facts):
        self._history.append({
            "elapsedSeconds": round(time.monotonic() - self._start, 3),
            "phase": phase, "event": event, **facts,
        })
        if event in {"failed", "accepted", "repair"} or (event == "observation"
                and not facts["healthy"] and self._anomalies_printed < 8):
            if event == "observation":
                self._anomalies_printed += 1
            print(f"Deployment watch {phase} {event}: {json.dumps(facts, separators=(',', ':'))}",
                  file=sys.stderr, flush=True)
        self._publish(STATUS, {
            "samples": self._samples, "pendingIncident": self._incident, "failure": self._fatal,
            "repairAttempts": sorted(self._attempted), "events": list(self._history),
        })

    def _fail(self, reason, phase):
        if self._fatal is None:
            self._fatal = reason
            self._record(phase, "failed", reason=reason)
        raise WatchError(self._fatal)

    def _call(self, action, phase, failure, *args):
        try:
            budget = min(self.remaining_seconds(), self.config["timeoutSeconds"])
        except WatchError as error:
            self._fail(str(error), phase)
        started = time.monotonic()
        try:
            result = action(*args, budget)
        except Exception:
            self._fail(failure, phase)
        if time.monotonic() - started > budget:
            self._fail("Deployment monitor action timed out.", phase)
        return result

    def _observe(self, phase):
        report = self._call(self.sample, phase, "Deployment monitor probe failed.")
        try:
            observed = inspect_report(report, self.hosts, self.config)
        except WatchError:
            self._fail("Invalid deployment monitor observation or inventory.", phase)
        self._samples += 1
        self._incident |= not observed["healthy"]
        self._next_probe = time.monotonic() + self.config["intervalSeconds"]
        affected = list(observed["issues"].items())[:8]
        self._record(phase, "observation", healthy=observed["healthy"], maxima=observed["maxima"],
                     examples={code: hosts[:3] for code, hosts in affected},
                     affectedNodes=len({host for hosts in observed["issues"].values() for host in hosts}))
        return observed

    def _gate(self, phase):
        if self._fatal:
            raise WatchError(self._fatal)
        observed = self._observe(phase)
        while not observed["healthy"]:
            causes = observed["causes"]
            if (observed["undiagnosed"] or self.repair is None or
                    any(cause not in self.config["repairs"] or cause in self._attempted
                        for cause in causes)):
                self._fail("Unresolved deployment incident at " + phase + ".", phase)
            confirmed = self._observe(phase)
            if confirmed["healthy"]:
                break
            if confirmed["undiagnosed"] or confirmed["causes"] != causes:
                self._fail("Deployment diagnosis or its affected hosts changed before repair.", phase)
            cause = sorted(causes)[0]
            operation = self.config["repairs"][cause]
            self._attempted.add(cause)
            self._record(phase, "repair", cause=cause, operation=operation,
                         affectedNodes=len(causes[cause]), examples=causes[cause][:8])
            self._call(self.repair, phase, "Deployment monitor repair failed.",
                       operation, list(causes[cause]))
            observed = self._observe(phase)
        if self._incident:
            # Background observations never clear an incident. An independent second sample
            # at this stable checkpoint distinguishes a sustained recovery from a transient good read.
            separation = min(1, self.config["intervalSeconds"])
            if self.remaining_seconds() <= separation:
                self._fail("Insufficient time to confirm deployment recovery.", phase)
            time.sleep(separation)
            if not self._observe(phase)["healthy"]:
                self._fail("Deployment recovery could not be confirmed at " + phase + ".", phase)
        self._incident = False
        self._gates.add(phase)
        self._record(phase, "accepted")

    def _request_pending(self):
        try:
            fd = os.open(REQUEST, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self._fd)
        except FileNotFoundError:
            return False
        with os.fdopen(fd, "rb") as stream:
            attrs = os.fstat(stream.fileno())
            if (not stat.S_ISREG(attrs.st_mode) or attrs.st_nlink != 1 or attrs.st_mode & 0o077
                    or attrs.st_uid != os.geteuid() or attrs.st_size > 128):
                raise WatchError("Unsafe deployment monitor gate request.")
            request = stream.read(129)
            if len(request) > 128:
                raise WatchError("Oversized deployment monitor gate request.")
            # The managed playbook writes this one reviewed message atomically via Ansible copy.
            try:
                # Preserve duplicates so ambiguous requests cannot collapse to an accepted phase.
                fields = json.loads(request, object_pairs_hook=list)
            except (UnicodeError, ValueError):
                raise WatchError("Invalid deployment monitor gate request.") from None
            if fields != [("phase", "preactivation")]:
                raise WatchError("Unexpected deployment monitor gate request.")
            return True

    def _release_gate(self):
        result = {"phase": "preactivation", "healthy": self._fatal is None}
        if self._fatal:
            result["reason"] = self._fatal
        self._publish(RESPONSE, result, exclusive=True)
        self._responded = True

    def _background(self):
        while not self._stop.is_set():
            delay = 1
            with self._lock:
                if self._stop.is_set() or "after" in self._gates:
                    return
                try:
                    if not self._fatal:
                        self.remaining_seconds()
                    if self.require_gate and not self._responded and self._request_pending():
                        self._gate("preactivation")
                        self._release_gate()
                    elif not self._fatal and time.monotonic() >= self._next_probe:
                        self._observe("rollout")
                    if not self._fatal:
                        delay = min(self.remaining_seconds(), max(0, self._next_probe - time.monotonic()))
                except Exception as error:
                    if self._fatal is None:
                        self._fatal = str(error) if isinstance(error, WatchError) else "Deployment monitor failed."
                        self._record("rollout", "failed", reason=self._fatal)
                    if self.require_gate and not self._responded:
                        try:
                            self._release_gate()
                        except OSError:
                            # A pre-existing or unwriteable result cannot grant observer approval.
                            # The rollout's own timeout and the caller's final gate still apply.
                            return
                if self.require_gate and not self._responded:
                    delay = min(0.1, delay)
            self._stop.wait(max(0.02, delay))

    def checkpoint(self, phase):
        if phase not in {"before", "after"}:
            raise WatchError("Only before and after are caller-owned deployment checkpoints.")
        with self._lock:
            if self._fd is None:
                raise WatchError("Deployment monitor is inactive.")
            if self._fatal:
                raise WatchError(self._fatal)
            try:
                self.remaining_seconds()
            except WatchError as error:
                self._fail(str(error), phase)
            if phase in self._gates:
                return
            if phase == "after" and self.require_gate and "preactivation" not in self._gates:
                self._fail("Managed deployment skipped its preactivation monitor gate.", phase)
            self._gate(phase)

    def __enter__(self):
        if self._fd is not None or self._thread is not None:
            raise WatchError("A deployment monitor belongs to a single apply.")
        self._fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            attrs = os.fstat(self._fd)
            if attrs.st_uid != os.geteuid() or attrs.st_mode & 0o077:
                raise WatchError("Deployment monitor needs a private owned working directory.")
            if set(os.listdir(self._fd)).intersection((REQUEST, RESPONSE, STATUS)):
                raise WatchError("Deployment monitor found an existing protocol record.")
            self._start = time.monotonic()
            self._deadline = self._start + self.config["maxDeploySeconds"]
            self._responded = False
            self.checkpoint("before")
            self._thread = threading.Thread(target=self._background, name="deployment-observer")
            self._thread.start()
            return self
        except BaseException:
            os.close(self._fd)
            self._fd = None
            raise

    def __exit__(self, error_type, error, traceback):
        try:
            if error_type is None:
                self.checkpoint("after")
        finally:
            self._stop.set()
            # The SDK callbacks reap their executable groups within the supplied timeout.
            self._thread.join()
            try:
                if error_type is not None and not self._fatal:
                    self._fatal = "Rollout command failed."
                    self._record("rollout", "failed", reason=self._fatal)
            finally:
                os.close(self._fd)
                self._fd = None
