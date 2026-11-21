/** Tests remote Linux CPU discovery and measures actual foreground worker utilization. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(new URL("./ansible/library/deploy_cpu_step.py", import.meta.url));
const onLinux = { skip: process.platform !== "linux" && "target CPU accounting requires Linux" };
const mib = 1024 * 1024;

function python(source, ...args) {
  const script = [
    "import importlib.util, json, os, sys",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('deploy_cpu_step', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "def run(**params):",
    "    try: return module.deploy_cpu_step(**params)",
    "    except module.StepError as error: return dict(error=str(error), **error.result)",
    source,
  ].join("\n");
  const result = spawnSync("python3", ["-B", "-c", script, modulePath, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "cpu deploy "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (relative) => path.join(root, relative);
  const write = (relative, content) => {
    mkdirSync(path.dirname(file(relative)), { recursive: true });
    writeFileSync(file(relative), String(content));
  };
  const mount = (directory, cgroupRoot, kind, options = "rw") => {
    mkdirSync(file(directory), { recursive: true });
    return `41 1 0:12 ${cgroupRoot} ${file(directory).replaceAll(" ", "\\040")} rw - ${kind} cgroup ${options}`;
  };
  const capacity = (options = {}, cpus = 8) =>
    python(
      `probe = module.target_capacity
module.os.getpid = lambda: 4242  # PID in the synthetic target's controller membership files
module.target_capacity = lambda: probe(Path(sys.argv[2]) / "proc", int(sys.argv[3]))
params = dict(argv=[sys.executable, "-c", "Path is never used", "--workers={workers}"],
              memory_mib_per_worker=64, minimum_cpu_fraction=0.8, capacity_only=True)
params.update(json.loads(sys.argv[4]))
print(json.dumps(run(**params)))`,
      root,
      String(cpus),
      JSON.stringify(options),
    );
  return { file, write, mount, capacity };
}

test(
  "v2 capacity honors bind-root mapping, inherited fractional quotas, affinity and memory headroom",
  onLinux,
  (t) => {
    const f = fixture(t);
    f.write("proc/meminfo", `MemAvailable: ${1024 * 1024} kB\n`);
    f.write("proc/self/cgroup", "0::/delegated/service/step\n");
    f.write(
      "proc/self/mountinfo",
      [
        f.mount("unified mount", "/delegated", "cgroup2"),
        f.mount("other bind", "/foreign", "cgroup2"),
      ].join("\n"),
    );
    f.write("unified mount/service/step/cgroup.procs", "4242\n");
    f.write("other bind/delegated/service/step/cgroup.procs", "3131\n");
    f.write("other bind/cpu.max", "100000 100000");
    f.write("unified mount/service/step/cpu.max", "400000 100000");
    f.write("unified mount/service/cpu.max", "150000 100000");
    f.write("unified mount/service/memory.max", 600 * mib);
    f.write("unified mount/service/memory.high", 500 * mib);
    f.write("unified mount/service/memory.current", 180 * mib);
    f.write("unified mount/service/step/memory.max", "max");
    f.write("unified mount/cpu.max", "max 100000");
    const capacity = f.capacity();
    assert.equal(capacity.cgroup_quota_cpus, 1.5);
    assert.equal(capacity.affinity_cpus, 8);
    assert.equal(capacity.workers, 2);
    assert.equal(capacity.cpu_budget, 1.5);
    assert.equal(capacity.cgroup_available_mib, 320);
    assert.equal(capacity.executed, false);
    assert.equal(capacity.changed, false);
    assert.equal("cpu_seconds" in capacity, false);
    const noMemory = f.capacity({ reserve_memory_mib: 280 });
    assert.equal(noMemory.workers, 0);
    assert.match(noMemory.error, /Insufficient target capacity/u);
    assert.equal(f.capacity({}, 1).workers, 1);
    assert.equal(f.capacity({ max_workers: 1 }).executed, false);
    f.write("unified mount/cpu.max", "75000 100000");
    assert.equal(f.capacity().available_cpus, 0.75);
    assert.match(f.capacity().error, /requires more than one CPU/u);
    f.write("unified mount/cgroup.procs", "4242\n");
    f.write("proc/self/cgroup", "0::/../../host/namespace-leaf\n");
    assert.equal(f.capacity().cgroup_quota_cpus, 0.75);
  },
);

test(
  "v1 capacity maps namespace-relative memberships and separate legacy controller mounts",
  onLinux,
  (t) => {
    const f = fixture(t);
    f.write("proc/meminfo", `MemAvailable: ${2000 * 1024} kB\n`);
    f.write("proc/self/cgroup", "2:cpu,cpuacct:/service/step\n3:memory:/service/step\n");
    f.write(
      "proc/self/mountinfo",
      [
        f.mount("cpu", "/host/scope", "cgroup", "rw,cpuacct,cpu"),
        f.mount("memory", "/host/scope", "cgroup", "rw,memory"),
      ].join("\n"),
    );
    f.write("cpu/service/step/tasks", "4242\n");
    f.write("memory/service/step/cgroup.procs", "4242\n");
    f.write("cpu/service/step/cpu.cfs_quota_us", -1);
    f.write("cpu/cpu.cfs_quota_us", 350000);
    f.write("cpu/cpu.cfs_period_us", 100000);
    f.write("memory/service/step/memory.limit_in_bytes", 1000 * mib);
    f.write("memory/service/step/memory.usage_in_bytes", 2 * mib);
    f.write("memory/service/memory.limit_in_bytes", 800 * mib);
    f.write("memory/service/memory.usage_in_bytes", 500 * mib);
    const result = f.capacity({ reserve_memory_mib: 80 });
    assert.equal(result.available_cpus, 3.5);
    assert.equal(result.available_memory_mib, 300);
    assert.equal(result.workers, 3);
    assert.equal(result.cpu_budget, 3);
    f.write("proc/meminfo", `MemAvailable: ${191 * 1024} kB\n`);
    assert.equal(f.capacity().workers, 2);
    f.write("proc/self/cgroup", "2:cpu,cpuacct:/missing\n");
    assert.match(f.capacity().error, /Cannot locate the target cgroup mount/u);
  },
);

test(
  "check mode and parameter bounds reject invalid or unmeasured work before execution",
  onLinux,
  (t) => {
    const f = fixture(t);
    f.write("proc/meminfo", "MemAvailable: 2097152 kB\n");
    f.write("proc/self/cgroup", "");
    f.write("proc/self/mountinfo", "");
    const marker = f.file("launched");
    const argv = ["/usr/bin/touch", marker, "--{workers}"];
    for (const options of [
      { argv: ["relative", "{workers}"] },
      { argv: ["/{workers}/tool", "{workers}"] },
      { argv: ["/bin/true", "missing"] },
      { memory_mib_per_worker: 0 },
      { memory_mib_per_worker: 2 ** 31 },
      { reserve_memory_mib: -1 },
      { reserve_memory_mib: 2 ** 31 },
      { max_workers: 65537 },
      { minimum_cpu_fraction: 0 },
      { minimum_cpu_fraction: 1.1 },
    ])
      assert.ok(f.capacity({ argv, ...options }).error);
    const checked = f.capacity({ argv, capacity_only: false, check_mode: true });
    assert.equal(checked.executed, false);
    assert.equal(checked.workers, 8);
    assert.equal(existsSync(marker), false);
  },
);

test(
  "literal worker arguments, failed foreground exit and measured thresholds are retained",
  onLinux,
  () => {
    const results =
      python(`module.target_capacity = lambda: {"available_cpus": 4, "available_memory_mib": 256}
params = dict(argv=[sys.executable, "-c", "import sys; sys.stderr.write(sys.argv[1]); sys.exit(17)", "--w={workers};$HOME"],
              memory_mib_per_worker=64, minimum_cpu_fraction=0.9)
failed = run(**params)
missing = run(**{**params, "argv": ["/no-such-fixture-dir/stage", "{workers}"]})
module.measure = lambda cmd: (dict(rc=0, cpu_seconds=2.0, wall_seconds=1.0, average_cpus=2.0), "")
below = run(**params)
params["minimum_cpu_fraction"] = 0.5
accepted = run(**params)
params["minimum_cpu_fraction"] = float("nan")
invalid = run(**params)
print(json.dumps([failed, below, accepted, invalid, missing]))`);
    assert.equal(results[0].rc, 17);
    assert.equal(results[0].stderr, "--w=4;$HOME");
    assert.equal(results[0].changed, true);
    assert.equal(results[0].executed, true);
    assert.match(results[1].error, /averaged 2/u);
    assert.equal(results[2].average_cpus, 2);
    assert.equal(results[2].error, undefined);
    assert.match(results[3].error, /finite/u);
    assert.equal(results[4].executed, false);
    assert.equal(results[4].changed, false);
    assert.match(results[4].error, /Cannot execute/u);
  },
);

const nativeWork = `import os, sys, time
def busy():
    end = time.process_time() + 0.40
    while time.process_time() < end: pass
if sys.argv[1] == "serial":
    os.sched_setaffinity(0, {min(os.sched_getaffinity(0))})
    busy()
    time.sleep(0.08)
else:
    children = []
    for _ in range(int(sys.argv[2])):
        child = os.fork()
        if not child:
            busy()
            os._exit(0)
        children.append(child)
    for child in children:
        assert os.waitpid(child, 0)[1] == 0
`;

test("real one-CPU staging fails the utilization gate", onLinux, () => {
  const result = python(
    `module.target_capacity = lambda: {"available_cpus": 2, "available_memory_mib": 128}
print(json.dumps(run(argv=[sys.executable, "-c", sys.argv[2], "serial", "{workers}"],
                     memory_mib_per_worker=16, minimum_cpu_fraction=0.5)))`,
    nativeWork,
  );
  assert.equal(result.rc, 0);
  assert.equal(result.executed, true);
  assert.ok(result.cpu_seconds >= 0.39);
  assert.ok(result.average_cpus <= 1);
  assert.match(result.error, /must exceed 1/u);
});

test(
  "real multiprocess staging counts completed descendants on the current Linux target",
  onLinux,
  (t) => {
    const result = python(
      `import resource
before = resource.getrusage(resource.RUSAGE_CHILDREN)
stage = run(argv=[sys.executable, "-c", sys.argv[2], "parallel", "{workers}"],
            memory_mib_per_worker=16, minimum_cpu_fraction=0.55, max_workers=2)
after = resource.getrusage(resource.RUSAGE_CHILDREN)
stage["independent_cpu"] = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
print(json.dumps(stage))`,
      nativeWork,
    );
    if (!result.executed) {
      assert.match(result.error, /Insufficient target capacity/u);
      return t.skip(result.error);
    }
    assert.equal(result.rc, 0);
    assert.ok(result.cpu_seconds >= 0.79);
    assert.ok(Math.abs(result.independent_cpu - result.cpu_seconds) < 0.01);
    assert.equal(result.workers, 2);
    if (result.average_cpus <= 1 || result.average_cpus < result.minimum_average_cpus) {
      assert.match(result.error, /must exceed 1/u);
      return t.skip(
        `Linux scheduled the two real workers at only ${result.average_cpus.toFixed(3)} CPUs`,
      );
    }
    assert.equal(result.error, undefined);
    t.diagnostic(
      `${result.workers} workers used ${result.cpu_seconds.toFixed(3)} CPU s in ${result.wall_seconds.toFixed(3)} wall s (${result.average_cpus.toFixed(3)} CPUs)`,
    );
  },
);
