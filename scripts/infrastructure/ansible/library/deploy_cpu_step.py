#!/usr/bin/python
"""Size and measure one foreground CPU-bound staging task on its actual Linux deploy target."""

import errno
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time


MIB = 1024 * 1024


class StepError(Exception):
    """Carry the failed staging step's measured capacity and execution evidence to Ansible."""

    def __init__(self, message, **result):
        super().__init__(message)
        self.result = result


def mount_path(field):
    return Path(re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), field))


def contains_process(directory):
    # A namespace and an unrelated mounted subtree can expose the same relative names.
    pid = str(os.getpid())
    for name in ("cgroup.procs", "cgroup.threads", "tasks"):
        try:
            with (directory / name).open() as members:
                if any(member.strip() == pid for member in members):
                    return True
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.EACCES, errno.EPERM, errno.EOPNOTSUPP):
                raise
    return False


def cgroup_ancestors(proc):
    """Map membership to visible controller mounts, including bind mounts and cgroup namespaces."""
    memberships = {}
    for line in (proc / "self/cgroup").read_text().splitlines():
        hierarchy, controllers, raw = line.split(":", 2)
        # A namespace may describe membership using leading /../ components.
        group = Path(os.path.normpath(raw))
        if not group.is_absolute():
            raise StepError("Cannot resolve the target's cgroup membership within its namespace.")
        if hierarchy == "0" and not controllers:
            memberships["unified"] = group
        for controller in {"cpu", "memory"}.intersection(controllers.split(",")):
            memberships[controller] = group

    directories = set()
    mapped = set()
    for line in (proc / "self/mountinfo").read_text().splitlines():
        fields, filesystem = line.split(" - ", 1)
        kind, _, flags = filesystem.split(maxsplit=2)
        if kind not in {"cgroup", "cgroup2"}:
            continue
        root, mount = map(mount_path, fields.split()[3:5])
        controllers = {"unified"} if kind == "cgroup2" else set(flags.split(","))
        for controller in controllers.intersection(memberships):
            group = memberships[controller]
            # The bind's root may be host-relative while membership is namespace-relative.
            candidates = [mount / group.relative_to("/"), mount]
            try:
                candidates.insert(0, mount / group.relative_to(root))
            except ValueError:
                pass
            directory = next(
                (candidate for candidate in dict.fromkeys(candidates)
                 if candidate.is_dir() and contains_process(candidate)),
                None,
            )
            if directory is None:
                continue
            mapped.add(controller)
            while True:
                directories.add((controller, directory))
                if directory == mount:
                    break
                directory = directory.parent
    missing = memberships.keys() - mapped
    if missing:
        raise StepError(f"Cannot locate the target cgroup mount for {', '.join(sorted(missing))}.")
    return directories


def control(directory, name):
    try:
        return (directory / name).read_text().strip()
    except FileNotFoundError:
        return None


def target_capacity(proc=Path("/proc"), affinity_cpus=None):
    if sys.platform != "linux":
        raise StepError("CPU-measured deploy staging requires a Linux target.")
    if affinity_cpus is None:
        affinity_cpus = len(os.sched_getaffinity(0))
    meminfo = (proc / "meminfo").read_text()
    available = re.search(r"^MemAvailable:\s+(\d+)\s+kB$", meminfo, re.MULTILINE)
    if not available:
        raise StepError("Linux MemAvailable is missing; cannot size deploy memory safely.")
    host_bytes = int(available[1]) * 1024
    quotas = []
    headroom = []
    v1_unlimited = sys.maxsize - sys.maxsize % os.sysconf("SC_PAGE_SIZE")
    for controller, directory in cgroup_ancestors(proc):
        if controller == "unified":
            cpu_max = control(directory, "cpu.max")
            if cpu_max is not None:
                quota, period = cpu_max.split()
                if quota != "max":
                    quotas.append(int(quota) / int(period))
        if controller == "cpu":
            quota = control(directory, "cpu.cfs_quota_us")
            if quota not in (None, "-1"):
                period = (directory / "cpu.cfs_period_us").read_text()
                quotas.append(int(quota) / int(period))
        if controller in {"unified", "memory"}:
            unified = controller == "unified"
            limits = ("memory.high", "memory.max") if unified else ("memory.limit_in_bytes",)
            finite = []
            for name in limits:
                raw = control(directory, name)
                if raw not in (None, "max"):
                    limit = int(raw)
                    # v1 represents "unlimited" as the largest page-aligned signed long.
                    if unified or limit < v1_unlimited:
                        finite.append(limit)
            if finite:
                usage = directory / ("memory.current" if unified else "memory.usage_in_bytes")
                used = int(usage.read_text())
                headroom.append(max(0, min(finite) - used))
    quota = min(quotas, default=None)
    cgroup_memory = min(headroom, default=None)
    return {
        "affinity_cpus": affinity_cpus,
        "cgroup_quota_cpus": quota,
        "available_cpus": min(affinity_cpus, quota) if quota is not None else affinity_cpus,
        "host_available_mib": host_bytes // MIB,
        "cgroup_available_mib": cgroup_memory // MIB if cgroup_memory is not None else None,
        "available_memory_mib": min([host_bytes, *headroom]) // MIB,
    }


def bounded_integer(name, value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise StepError(f"{name} must be an integer from {minimum} to {maximum}.")


def measure(argv):
    # Linux charges this PID's threads and any descendants it waited for.
    started = time.monotonic()
    try:
        child = subprocess.Popen(
            argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
    except OSError as error:
        raise StepError(f"Cannot execute foreground stage: {error}") from error
    try:
        with child:
            tail = b""
            for chunk in iter(lambda: child.stderr.read(16384), b""):
                tail = (tail + chunk)[-4096:]
            _, status, usage = os.wait4(child.pid, 0)
            child.returncode = os.waitstatus_to_exitcode(status)
    except OSError as error:
        raise StepError(f"Foreground staging started but CPU accounting failed: {error}",
                        executed=True, changed=True) from error
    seconds = time.monotonic() - started
    cpu = usage.ru_utime + usage.ru_stime
    return {
        "rc": child.returncode,
        "cpu_seconds": cpu,
        "wall_seconds": seconds,
        "average_cpus": cpu / seconds if seconds > 0 else 0.0,
    }, tail.decode("utf-8", errors="replace").strip()


def deploy_cpu_step(
    argv, memory_mib_per_worker, minimum_cpu_fraction, max_workers=None,
    reserve_memory_mib=0, capacity_only=False, check_mode=False,
):
    if (
        not isinstance(argv, list) or not argv
        or any(not isinstance(arg, str) or "\0" in arg for arg in argv)
        or not os.path.isabs(argv[0]) or "{workers}" in argv[0]
        or not any("{workers}" in arg for arg in argv[1:])
    ):
        raise StepError("argv requires an absolute executable and a {workers} argument placeholder.")
    bounded_integer("memory_mib_per_worker", memory_mib_per_worker, 1, 2**31 - 1)
    bounded_integer("reserve_memory_mib", reserve_memory_mib, 0, 2**31 - 1)
    if max_workers is not None:
        bounded_integer("max_workers", max_workers, 1, 65536)
    if type(minimum_cpu_fraction) not in (float, int) or not 0 < minimum_cpu_fraction <= 1:
        raise StepError("minimum_cpu_fraction must be finite and greater than 0 through 1.")
    try:
        result = target_capacity()
    except (OSError, ValueError, ZeroDivisionError) as error:
        raise StepError(f"Cannot read Linux CPU or memory capacity: {error}") from error
    cpus = result["available_cpus"]
    usable_memory = max(0, result["available_memory_mib"] - reserve_memory_mib)
    memory_workers = usable_memory // memory_mib_per_worker
    workers = min(math.ceil(cpus), memory_workers)
    if max_workers is not None:
        workers = min(workers, max_workers)
    budget = min(cpus, workers)
    result.update(
        changed=False, executed=False, workers=workers, cpu_budget=budget,
        memory_workers=memory_workers, minimum_average_cpus=budget * minimum_cpu_fraction,
    )
    if cpus <= 1 or workers <= 1:
        raise StepError(
            f"Insufficient target capacity: {cpus:g} CPUs, memory for {memory_workers} workers, "
            f"configured max_workers={max_workers}, selected {workers}. "
            "This stage requires more than one CPU and worker.",
            **result,
        )
    if capacity_only or check_mode:
        return result
    command = [argv[0], *(arg.replace("{workers}", str(workers)) for arg in argv[1:])]
    try:
        metrics, stderr = measure(command)
    except StepError as error:
        raise StepError(str(error), **{**result, **error.result}) from error
    result.update(metrics, executed=True, changed=True)
    if result["rc"] != 0:
        rc = result["rc"]
        reason = f"exited with status {rc}" if rc > 0 else f"was terminated by signal {-rc}"
        raise StepError(f"Foreground staging {reason}.", stderr=stderr, **result)
    if result["average_cpus"] <= 1 or result["average_cpus"] < result["minimum_average_cpus"]:
        raise StepError(
            f"Foreground staging averaged {result['average_cpus']:.3f} CPUs. It must exceed 1 "
            f"and reach {result['minimum_average_cpus']:.3f} CPUs (budget {budget:g}).",
            **result,
        )
    return result


def main():
    from ansible.module_utils.basic import AnsibleModule

    module = AnsibleModule(argument_spec={
        "argv": {"type": "list", "elements": "str", "required": True},
        "memory_mib_per_worker": {"type": "int", "required": True},
        "max_workers": {"type": "int"},
        "reserve_memory_mib": {"type": "int", "default": 0},
        "minimum_cpu_fraction": {"type": "float", "required": True},
        "capacity_only": {"type": "bool", "default": False},
    }, supports_check_mode=True)
    try:
        result = deploy_cpu_step(check_mode=module.check_mode, **module.params)
    except StepError as error:
        module.fail_json(msg=str(error), **{"changed": False, "executed": False, **error.result})
    else:
        module.exit_json(**result)


if __name__ == "__main__":
    main()
