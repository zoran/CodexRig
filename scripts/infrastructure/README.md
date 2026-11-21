# Infrastructure administration

Start the text menu from the repository root. Use Python 3 and the project wrapper so the selected
operation runs with the project's account configuration.

```sh
python3 -B scripts/infrastructure/admin.py tui
```

Inside the project environment, `pnpm infra:admin list` shows the configured targets and operations.
A fresh project has an empty catalog. To add a recurring task, check its Terraform configuration or
Ansible inventory and playbook into the project, then name the operation in `infra/operations.json`.
For example, a staging environment could declare these two operations.

```json
{
  "targets": {
    "staging": {
      "operations": {
        "network": {
          "engine": "terraform",
          "purpose": "maintenance",
          "directory": "infra/staging/network",
          "parallelism": 4
        },
        "patch-hosts": {
          "engine": "ansible",
          "purpose": "maintenance",
          "inventory": "infra/staging/hosts.yml",
          "playbook": "infra/patch.yml",
          "parallelism": 8
        }
      }
    }
  }
}
```

Install the project's selected engine and configure its target account before running an operation.
For a Terraform operation, initialize the working directory and preview the change. The plan command
prints the plan ID on standard output and sends engine output to standard error.

```sh
pnpm infra:admin init --target staging --operation network
pnpm infra:admin plan --target staging --operation network
```

After reviewing an authorized plan, set the shell variable `plan_id` to its returned ID and pass it
to the same operation. The text menu and scripted interface use the same Python implementation.

```sh
pnpm infra:admin apply --target staging --operation network --plan "$plan_id"
```

Terraform applies the saved plan. Ansible runs the selected playbook in check mode for the preview
and executes it on apply. Tasks with `check_mode: false` can execute during preview, and modules
without check-mode support may skip work. Review those tasks. Give each Terraform operation its own
root module and state backend in the default workspace. Store plans and local engine data under
`.project-state/infrastructure/` and configure a private state backend. Extend the shared Python
`execute(root, target, operation, action, plan_id=None)` operation when a recurring task needs more
than a catalog entry.

An operation may set `parallelism` from 1 through 256. Terraform uses it to schedule independent
resources. Ansible uses it as the fork limit across inventory hosts. Omitting it uses the engine
default.

## CPU-intensive work on each deployment host

For a Linux rollout with substantial, partitionable staging work, declare a `deployment` operation
in the same catalog. This example verifies independent shards of a locally built release on every
host in the `web` inventory group before activating it.

```json
{
  "converge-web": {
    "engine": "ansible",
    "inventory": "infra/staging/hosts.yml",
    "fleetProfile": "infra/staging/web.json"
  },
  "deploy-release": {
    "engine": "ansible",
    "inventory": "infra/staging/hosts.yml",
    "parallelism": 8,
    "fleetProfile": "infra/staging/web.json",
    "monitor": {
      "probe": "infra/staging/health.yml",
      "intervalSeconds": 10,
      "timeoutSeconds": 30,
      "maxDeploySeconds": 900,
      "limits": { "latencyMs": 300, "errorRate": 0.01, "load": 1.5 }
    },
    "deployment": {
      "prepare": "infra/staging/stage-release.yml",
      "cpuStep": {
        "argv": ["/usr/local/libexec/verify-release-shards", "--jobs", "{workers}"],
        "memoryMiBPerWorker": 128,
        "reserveMemoryMiB": 512,
        "maxWorkers": 4,
        "minimumCpuFraction": 0.6
      },
      "activate": "infra/staging/activate-release.yml"
    }
  }
}
```

The project supplies the foreground command and the Ansible task lists for optional preparation and
required activation. Prepare the inactive release and its inputs before measurement. The command
must accept the selected worker count, finish its own threads or child processes, and return a
successful exit status. Keep artifact builds on the local build host.

Use `pnpm infra:admin plan --target staging --operation deploy-release` to record the target group
and inspect capacity on each host. This preview skips the preparation, workload and activation.
Apply the returned plan with
`pnpm infra:admin apply --target staging --operation deploy-release --plan "$plan_id"`. Each host
sizes its workers from process CPU affinity, Linux cgroup CPU and memory limits, available RAM and
the declared memory per worker. The optional reserve defaults to zero, and `maxWorkers` can further
cap concurrency.

Apply measures the foreground command's CPU seconds divided by elapsed seconds on each host. For
example, 1.8 means that the command averaged 1.8 logical CPUs. Activation requires the reviewed host
group, a successful command on every host, an average strictly above one CPU and at least the
configured fraction of each host's allocated CPU budget. A serial command, insufficient capacity or
a changed group stops the rollout before activation. Use a representative staging workload to choose
the per-worker memory, reserve and utilization threshold. I/O-bound transfers, ordered migrations
and service starts have different bottlenecks and can use ordinary Ansible playbooks.

## Comparable servers and workload-specific tuning

Provision equivalent machines from the same pinned image and Terraform module, using `for_each` with
stable instance names. Declare the corresponding Ansible group and common convergence tasks once in
a versioned profile. Server-provisioning Terraform operations can reference the same `fleetProfile`;
their root may declare `var.fleet_profile` to consume its distribution, major version, sysctls and
optional package versions and file hashes. Terraform applies its saved plan. Feed its actual host
identities into the project's inventory. Keep identity and region in host variables and document
intentional differences.
[Terraform module instances](https://developer.hashicorp.com/terraform/language/block/module) and
[Ansible inventory groups](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html).

Example profile `infra/staging/web.json`, to adapt to the real OS and application:

```json
{
  "schemaVersion": 1,
  "group": "web",
  "distribution": "Debian",
  "majorVersion": "13",
  "converge": "infra/staging/configure-web.yml",
  "workload": "HTTPS application servers accepting short concurrent connections.",
  "tuningDecision": "Start with the image defaults. Tune the listen backlog only if load tests show accept queue overflow.",
  "validation": "Replay a representative traffic peak and compare overflow counters, latency and request errors against the current release.",
  "reviewedOn": "2026-11-21",
  "sources": ["https://docs.kernel.org/networking/ip-sysctl.html"],
  "sysctls": {}
}
```

Research current distribution, provider, kernel and application guidance for every change. Record
the date, applicable versions, local evidence and how to verify or revert the choice. For a tuned
key declare its live value in `sysctls`; use the existing convergence role to install the persistent
configuration and apply it. Validate precedence and persistence after a qualification restart. A
profile can also pin native package versions in `packages` and SHA-256 digests of managed
configuration in `files`. The verifier reads the actual values on each node. The runtime validates
the profile structure; reviewing the technical sources and benchmarking the decision are engineering
work. [Linux network sysctls](https://docs.kernel.org/networking/ip-sysctl.html),
[systemd boot-time sysctls](https://www.freedesktop.org/software/systemd/man/latest/sysctl.d.html)
and
[Red Hat workload profiles](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/getting-started-with-tuned_monitoring-and-managing-system-status-and-performance).

Use `plan` on `converge-web` to report each divergent host and key. Its reviewed `apply` runs the
common tasks and verifies the group again. A managed deployment requires that group to match the
profile before staging and activation. Use the plan's inventory and input digests when diagnosing a
different result on a particular host.

## Deployment monitoring and repair

Declare a `monitor` for deployments. The operator also treats a Terraform module or custom Ansible
playbook as a deployment by default. For work outside delivery, such as network maintenance or
routine patching, record `"purpose": "maintenance"` to run it without a deployment monitor. The
dedicated worker observes the reviewed nodes or cluster before the change, while the apply runs, and
at completion. Managed Ansible deployments also wait for an affirmative response immediately before
activation. Terraform and ordinary playbooks get preflight, concurrent observation and final health
checks; internal provider activation boundaries belong to the provider. A Terraform monitor
specifies its Ansible `inventory` explicitly. Measure application errors, request latency and
resource saturation against thresholds suitable for that workload.
[Google SRE monitoring guidance](https://sre.google/sre-book/monitoring-distributed-systems/).

The project supplies one read-only Ansible probe. It receives `operator_watch_hosts` (the reviewed
aliases, or an empty list during initial discovery) and `operator_watch_report` (a private path on
the controller). Gather actual signals from the hosts or monitoring API. Aggregate them on
`localhost` and write the JSON with mode `0600`. The probe runs in Ansible check mode; use
`check_mode: false` only for read-only observations and the local report write. Report every
reviewed member. `errorRate` ranges from zero to one. Define the unit of `load` alongside its
threshold, such as runnable tasks per available CPU. One example observation is:

```json
{
  "nodes": {
    "web-01": {
      "status": "unhealthy",
      "code": "backlog-growing",
      "cause": "queue-worker-config-drift",
      "metrics": { "latencyMs": 850, "errorRate": 0.034, "load": 1.3 }
    }
  }
}
```

Emit `cause` only when the probe verified the specific defect. For a confirmed cause a monitor may
declare `"repairs": {"queue-worker-config-drift": "configure-queue-workers"}`. This names an
existing Ansible playbook operation on the same target and inventory. Put its reviewed
`preconditions`, `impact`, `verification` and `rollback` in that operation's `remediation` object.
Review the entire project, including other consumers of its shared role, before enabling this
mapping. At a stable checkpoint the worker can preview and run the bounded idempotent correction on
the affected aliases, then measure the whole group again. Unknown failures, missing nodes, timeouts
and unconfirmed high load stop acceptance. Fix defects in the shared runbook, module or main script
responsible for the bad state and verify the original failure plus its consumers. The latest private
result is in the target's `last-watch-<operation>.json`.
