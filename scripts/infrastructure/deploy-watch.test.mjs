/** Exercises the real deployment observer and activation handshake with local measurement callbacks. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const prelude = `
import json, os, sys, threading, time
from pathlib import Path
from tempfile import TemporaryDirectory
sys.path.insert(0, "scripts/infrastructure")
from deploy_watch import DeploymentWatch, REQUEST, RESPONSE, STATUS, WatchError, inspect_report, validate_hosts, validate_monitor

hosts = ["web-1.example", "web-2.example"]
cause = "queue-worker-config-drift"
canonical = "converge-queue-workers"
def config(**overrides):
    raw = dict(probe="infra/probe.yml", intervalSeconds=0.1, timeoutSeconds=2, maxDeploySeconds=5,
               limits={"load": 4}, repairs={cause: canonical})
    return validate_monitor(Path("."), {**raw, **overrides}, lambda root, name: root / name)
def node(status="healthy", code="ok", load=1, diagnosis=None):
    data = {"status": status, "code": code, "metrics": {"latencyMs": 7, "errorRate": 0, "load": load}}
    if diagnosis is not None:
        data["cause"] = diagnosis
    return data
def sample_report(first=None):
    return {"nodes": {hosts[0]: first or node(), hosts[1]: node()}}
def expect_error(action, text=None):
    try:
        action()
    except WatchError as err:
        if text:
            assert text.lower() in str(err).lower(), str(err)
        return
    raise AssertionError("Expected deployment watch error")
def request_gate(directory, content=None):
    incoming = directory / "incoming"
    incoming.write_text(content or json.dumps({"phase": "preactivation"}))
    incoming.chmod(0o600)
    incoming.replace(directory / REQUEST)
def response_gate(directory):
    response = directory / RESPONSE
    deadline = time.monotonic() + 4
    while not response.exists():
        assert time.monotonic() < deadline, "activation handshake did not complete"
        time.sleep(0.01)
    assert response.stat().st_mode & 0o077 == 0
    return json.loads(response.read_text())
def no_repair(*args):
    raise AssertionError("Unexpected repair")
`;

function python(body) {
  const result = spawnSync("python3", ["-B", "-c", prelude + "\n" + body], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 256 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stderr;
}

test("monitor configuration and reports bind specific causes, metrics and exact inventory", () => {
  python(`
settings = config()
healthy = inspect_report(sample_report(), hosts, settings)
assert healthy["healthy"] and healthy["maxima"]["latencyMs"] == 7
for generic in ["latency-limit", "error-limit", "load-limit", "timeout", "unreachable", "probe-failed"]:
    expect_error(lambda: config(repairs={generic: canonical}))
    expect_error(lambda: inspect_report(sample_report(node("unhealthy", "backlog", diagnosis=generic)), hosts, settings))
expect_error(lambda: config(repairs={cause: "infra/one-off.yml"}))
expect_error(lambda: config(timeoutSeconds=False))
expect_error(lambda: config(intervalSeconds=0.01))
expect_error(lambda: config(limits={"load": float("inf")}))
for names in [[hosts[0], hosts[0]], ["all"], ["web:unreviewed"], ["!excluded"], []]:
    expect_error(lambda: validate_hosts(names))
for malformed in [{"nodes": {}}, {"nodes": {"extra": node()}}, sample_report(node(load=float("nan"))),
                  sample_report(node(diagnosis=cause)), sample_report(node("unhealthy", "ok"))]:
    expect_error(lambda: inspect_report(malformed, hosts, settings))
assert inspect_report(sample_report(node(load=8)), hosts, settings)["undiagnosed"] == [hosts[0]]
`);
});

test("a dedicated worker observes staging and repairs only a diagnosed node at the stable gate", () => {
  const stderr = python(`
with TemporaryDirectory() as tmp:
    directory = Path(tmp)
    staging = threading.Event()
    observed_during_staging = threading.Event()
    repairs = []
    observations = []
    root_cause_present = True
    def sample(timeout):
        assert 0 < timeout <= 2
        observations.append(threading.get_ident())
        if staging.is_set() and root_cause_present:
            observed_during_staging.set()
            return sample_report(node("unhealthy", "queue-backlog", 8, cause))
        return sample_report()
    def repair(operation, affected, timeout):
        global root_cause_present
        assert operation == canonical and affected == [hosts[0]] and 0 < timeout <= 2
        assert not staging.is_set() or (directory / REQUEST).exists()
        repairs.append((operation, affected))
        root_cause_present = False
    with DeploymentWatch(config(), sample, repair, directory, hosts, require_gate=True) as watch:
        watch.checkpoint("before")
        staging.set()
        assert observed_during_staging.wait(2), "no concurrent observation during blocking rollout"
        time.sleep(0.15)
        assert repairs == [], "repair ran concurrently with mutable staging"
        request_gate(directory)
        accepted = response_gate(directory)
        assert accepted == {"phase": "preactivation", "healthy": True}
        assert repairs == [(canonical, [hosts[0]])]
        staging.clear()
        watch.checkpoint("after")
    assert len(set(observations)) == 2
    audit = json.loads((directory / STATUS).read_text())
    assert audit["failure"] is None and audit["repairAttempts"] == [cause]
    repair_index = next(i for i, e in enumerate(audit["events"]) if e["event"] == "repair")
    verified = [e for e in audit["events"][repair_index + 1:] if e["phase"] == "preactivation" and e["event"] == "observation"]
    assert len(verified) == 2 and all(e["healthy"] for e in verified)
    assert not any(t.name == "deployment-observer" for t in threading.enumerate())
`);
  assert.match(stderr, /queue-backlog/u);
  assert.match(stderr, /converge-queue-workers/u);
});

test("a load alarm cannot authorize a symptom patch and a persistent root cause gets one attempt", () => {
  python(`
for confirmed in [False, True]:
    with TemporaryDirectory() as tmp:
        directory = Path(tmp)
        bad, seen = threading.Event(), threading.Event()
        repairs = []
        def sample(timeout):
            if not bad.is_set():
                return sample_report()
            seen.set()
            return sample_report(node("unhealthy", "queue-backlog", 8, cause) if confirmed else node(load=8))
        def repair(operation, affected, timeout):
            repairs.append((operation, affected))
        try:
            with DeploymentWatch(config(), sample, repair, directory, hosts, require_gate=True):
                bad.set()
                assert seen.wait(2) and not repairs
                request_gate(directory)
                assert not response_gate(directory)["healthy"]
        except WatchError as err:
            assert "Unresolved" in str(err)
        else:
            raise AssertionError("Failed gate allowed successful deployment")
        assert repairs == ([(canonical, [hosts[0]])] if confirmed else [])
`);
});

test("an unhealthy staging observation cannot be erased by one transient healthy result", () => {
  python(`
with TemporaryDirectory() as tmp:
    directory = Path(tmp)
    started, observed = threading.Event(), threading.Event()
    gate_samples = 0
    def sample(timeout):
        global gate_samples
        if (directory / REQUEST).exists():
            gate_samples += 1
            return sample_report(node(load=8) if gate_samples == 2 else node())
        if started.is_set() and not observed.is_set():
            observed.set()
            return sample_report(node(load=8))
        return sample_report()
    try:
        with DeploymentWatch(config(), sample, no_repair, directory, hosts, require_gate=True):
            started.set()
            assert observed.wait(2)
            time.sleep(0.15)
            request_gate(directory)
            assert not response_gate(directory)["healthy"]
    except WatchError as err:
        assert "could not be confirmed" in str(err), str(err)
    else:
        raise AssertionError("Transient sample erased the staging incident")
`);
});

test("a diagnosis that moves to a different host before repair causes zero changes", () => {
  python(`
with TemporaryDirectory() as tmp:
    directory = Path(tmp)
    observations = 0
    repairs = []
    def sample(timeout):
        global observations
        observations += 1
        observed = sample_report()
        host = hosts[0] if observations == 1 else hosts[1]
        observed["nodes"][host] = node("unhealthy", "queue-backlog", diagnosis=cause)
        return observed
    def repair(*args):
        repairs.append(args)
    expect_error(lambda: DeploymentWatch(config(), sample, repair, directory, hosts).__enter__(),
                 "affected hosts changed")
    assert observations == 2 and not repairs
`);
});

test("probe failures and deployment deadlines fail closed and reap the observing thread", () => {
  python(`
for failure in ["invalid", "unreachable", "late", "deadline"]:
    with TemporaryDirectory() as tmp:
        directory = Path(tmp)
        started = False
        def sample(timeout):
            if started:
                if failure == "invalid":
                    return {"nodes": {}}
                if failure == "unreachable":
                    raise OSError("raw sensitive provider detail")
                if failure == "late":
                    time.sleep(timeout + 0.04)
            return sample_report()
        try:
            with DeploymentWatch(config(maxDeploySeconds=1 if failure == "deadline" else 4,
                                        timeoutSeconds=0.15), sample, no_repair,
                                 directory, hosts, require_gate=True):
                started = True
                denied = response_gate(directory)
                assert denied["healthy"] is False and "sensitive" not in str(denied)
        except WatchError:
            pass
        else:
            raise AssertionError("Observed failure yielded a successful apply")
        audit = json.loads((directory / STATUS).read_text())
        assert audit["failure"] and "sensitive" not in str(audit)
        assert not any(t.name == "deployment-observer" for t in threading.enumerate())
`);
});

test("a missing, malformed or reused managed checkpoint cannot authorize activation", () => {
  python(`
def sample(timeout):
    return sample_report()
with TemporaryDirectory() as tmp:
    directory = Path(tmp)
    (directory / RESPONSE).write_text('{"healthy":true}')
    expect_error(lambda: DeploymentWatch(config(), sample, no_repair, directory, hosts).__enter__(), "existing")
for request in [None, '{"phase":"preactivation","phase":"preactivation"}', '{"phase":"after"}']:
    with TemporaryDirectory() as tmp:
        directory = Path(tmp)
        try:
            with DeploymentWatch(config(intervalSeconds=30), sample, no_repair, directory, hosts, require_gate=True):
                if request:
                    request_gate(directory, request)
                    assert not response_gate(directory)["healthy"]
        except WatchError:
            pass
        else:
            raise AssertionError("Unreviewed checkpoint succeeded")
`);
});
