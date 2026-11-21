/** Exercises the infrastructure admin CLI and menu with project-local stand-in engines. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function operatorFixture(t, { ansiblePlaybook, timeout = 10000 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "infra operator "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name) => path.join(root, name);
  const write = (name, content) => {
    mkdirSync(path.dirname(file(name)), { recursive: true });
    writeFileSync(file(name), content);
  };
  mkdirSync(file("scripts/infrastructure"), { recursive: true });
  for (const name of [
    "admin.py",
    "deploy_watch.py",
    "monitor_operations.py",
    "fleet_profile.py",
    "ansible/deploy.yml",
    "ansible/verify_fleet.yml",
    "ansible/library/deploy_cpu_step.py",
  ]) {
    const target = file("scripts/infrastructure/" + name);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(new URL("./" + name, import.meta.url), target);
  }
  write(
    "scripts/setup/run-project.sh",
    [
      "#!/usr/bin/env bash",
      "set -eu",
      'export PATH="$PWD/fixture-bin:$PATH"',
      'export HOME="$PWD/.project-state/fixture-home" ANSIBLE_HOME="$PWD/.project-state/fixture-home/ansible"',
      'export ANSIBLE_REMOTE_TEMP="$PWD/.project-state/remote-tmp"',
      'mkdir -p "$HOME"',
      'export FIXTURE_TRACE="$PWD/trace.jsonl"',
      "unset FIXTURE_AMBIENT_ACCOUNT",
      'exec "$@"',
    ].join("\n"),
  );
  const fakeEngine = [
    "#!/usr/bin/env python3",
    "import json, os, sys",
    "from pathlib import Path",
    "args = sys.argv[1:]",
    "record = dict(engine=Path(sys.argv[0]).name, args=args, workspace=os.getenv('TF_WORKSPACE'), data=os.getenv('TF_DATA_DIR'), ssh=os.getenv('ANSIBLE_SSH_ARGS'), profile=os.getenv('TF_VAR_fleet_profile'), ambient=os.getenv('FIXTURE_AMBIENT_ACCOUNT'))",
    "with open(os.environ['FIXTURE_TRACE'], 'a') as f: f.write(json.dumps(record)+'\\n')",
    "if '--extra-vars' in args and '--check' in args:",
    "    content = Path(args[args.index('--extra-vars')+1][1:]).read_text()",
    "    if content.startswith('{'):",
    "        variables = json.loads(content); report = Path(variables['operator_watch_report'])",
    "        report.write_text(json.dumps({'nodes':{'fixture':{'code':'ok','status':'healthy','metrics':{'latencyMs':1,'errorRate':0,'load':0.1}}}})); report.chmod(0o600)",
    "    else:",
    "        record_path = next(line.split(': ',1)[1].removeprefix('!unsafe ') for line in content.splitlines() if line.startswith('operator_record_hosts:'))",
    "        Path(json.loads(record_path)).write_text(json.dumps(['fixture']))",
    "if 'plan' in args:",
    "    output = next(a[5:] for a in args if a.startswith('-out='))",
    "    Path(output).write_bytes(b'reviewed changes')",
    "if 'apply' in args and Path(args[-1]).read_bytes() != b'reviewed changes': sys.exit(23)",
    "if Path('.fail-engine').exists(): sys.exit(21)",
    "print('fixture engine output')",
  ].join("\n");
  for (const name of ["terraform", "ansible-playbook"]) {
    write("fixture-bin/" + name, fakeEngine);
    chmodSync(file("fixture-bin/" + name), 0o700);
  }
  if (ansiblePlaybook) {
    write(
      "fixture-bin/ansible-playbook",
      [
        "#!/usr/bin/env python3",
        "import json, os, sys",
        "from pathlib import Path",
        "args = sys.argv[1:]",
        "limit = args[args.index('--limit')+1] if '--limit' in args else ''",
        "hosts = Path(limit[1:]).read_text().splitlines() if limit.startswith('@') else []",
        "with open(os.environ['FIXTURE_TRACE'], 'a') as stream: stream.write(json.dumps({'args':args,'hosts':hosts})+'\\n')",
        "os.execv(" +
          JSON.stringify(ansiblePlaybook) +
          ", [" +
          JSON.stringify(ansiblePlaybook) +
          "] + args)",
      ].join("\n"),
    );
  }
  const configure = () => {
    write("infra/network/main.tf", "# synthetic module\n");
    write("infra/hosts.ini", "[web]\n");
    write("infra/roles/web/tasks/main.yml", "---\n");
    write("infra/site.yml", "---\n");
    write(
      "infra/operations.json",
      JSON.stringify({
        targets: {
          cloud: {
            operations: {
              network: { engine: "terraform", purpose: "maintenance", directory: "infra/network" },
            },
          },
          site: {
            operations: {
              hosts: {
                engine: "ansible",
                purpose: "maintenance",
                inventory: "infra/hosts.ini",
                playbook: "infra/site.yml",
              },
            },
          },
        },
      }),
    );
  };
  const run = (args, input = "") => {
    const result = spawnSync("python3", ["-B", file("scripts/infrastructure/admin.py"), ...args], {
      cwd: root,
      env: { ...process.env, FIXTURE_AMBIENT_ACCOUNT: "must-be-cleared-by-wrapper" },
      input,
      encoding: "utf8",
      timeout,
    });
    assert.ifError(result.error);
    return result;
  };
  const call = (action, target, operation, plan) =>
    run([action, "--target", target, "--operation", operation, ...(plan ? ["--plan", plan] : [])]);
  const events = () =>
    existsSync(file("trace.jsonl"))
      ? readFileSync(file("trace.jsonl"), "utf8").trim().split("\n").map(JSON.parse)
      : [];
  return { root, file, write, configure, run, call, events };
}

test("empty projects and cancelled menus do not invoke an engine or create state", (t) => {
  const f = operatorFixture(t);
  assert.match(f.run(["list"]).stdout, /No infrastructure operations/u);
  assert.match(f.run(["tui"]).stdout, /No infrastructure operations/u);
  assert.notEqual(f.run([]).status, 0);
  assert.equal(existsSync(f.file(".project-state")), false);
  f.configure();
  assert.match(f.run(["list"]).stdout, /cloud\tnetwork\tterraform/u);
  const cancel = f.run(["tui"], "1\napply\n" + "0".repeat(32) + "\n\nq\n");
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.match(cancel.stdout, /Apply cancelled/u);
  assert.equal(existsSync(f.file(".project-state")), false);
  assert.deepEqual(f.events(), []);
});

test("Terraform CLI initializes and applies exactly one saved plan for the selected root", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const init = f.call("init", "cloud", "network");
  assert.equal(init.status, 0, init.stderr);
  const planned = f.call("plan", "cloud", "network");
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stderr, /fixture engine output/u);
  const id = planned.stdout.trim();
  assert.match(id, /^[a-f0-9]{32}$/u);
  assert.notEqual(f.call("apply", "site", "hosts", id).status, 0);
  assert.equal(f.events().length, 2);
  const applied = f.call("apply", "cloud", "network", id);
  assert.equal(applied.status, 0, applied.stderr);
  assert.notEqual(f.call("apply", "cloud", "network", id).status, 0);
  const [initEvent, planEvent, applyEvent] = f.events();
  assert.deepEqual(initEvent.args, ["-chdir=" + f.file("infra/network"), "init", "-input=false"]);
  assert.equal(initEvent.workspace, "default");
  assert.equal(initEvent.ambient, null);
  assert.equal(initEvent.data, f.file(".project-state/infrastructure/targets/cloud/network"));
  assert.equal(planEvent.args.at(-1), "-out=" + applyEvent.args.at(-1));
  assert.equal(existsSync(applyEvent.args.at(-1)), false);
  assert.equal(f.events().length, 3);
  const retry = f.call("plan", "cloud", "network").stdout.trim();
  f.write(".fail-engine", "fixture");
  assert.match(f.call("apply", "cloud", "network", retry).stderr, /status 21/u);
  const before = f.events().length;
  assert.match(f.call("apply", "cloud", "network", retry).stderr, /already used/u);
  assert.equal(f.events().length, before);
});

test("the text menu runs the reviewed Ansible operation and detects changed role inputs", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const preview = f.run(["tui"], "2\nplan\nq\n");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stderr, /check mode/u);
  const id = /Plan ID: ([a-f0-9]{32})/u.exec(preview.stdout)[1];
  const first = f.events()[0];
  assert.deepEqual(first.args, [
    "-i",
    f.file("infra/hosts.ini"),
    "-M",
    f.file("scripts/infrastructure/ansible/library"),
    "--check",
    f.file("infra/site.yml"),
  ]);
  assert.match(first.ssh, /IdentityAgent=none/u);
  assert.ok(first.ssh.includes(f.file(".auth/project-tools/home/.ssh/known_hosts")));
  f.write("infra/roles/web/tasks/main.yml", "---\n# changed role\n");
  assert.match(f.call("apply", "site", "hosts", id).stderr, /does not match/u);
  const reviewed = f.call("plan", "site", "hosts").stdout.trim();
  const applied = f.run(["tui"], "2\napply\n" + reviewed + "\nsite/hosts\nq\n");
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Apply complete/u);
  assert.deepEqual(f.events().at(-1).args, [
    "-i",
    f.file("infra/hosts.ini"),
    "-M",
    f.file("scripts/infrastructure/ansible/library"),
    f.file("infra/site.yml"),
  ]);
});

test("configuration rejects foreign paths, linked state and arbitrary engine commands", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const manifest = f.file("infra/operations.json");
  const initial = readFileSync(manifest, "utf8");
  for (const directory of [
    "../outside",
    "infra/../outside",
    "infra/D:/outside",
    "infra/c:rel",
    f.root,
  ]) {
    writeFileSync(manifest, initial.replace("infra/network", directory));
    const rejected = f.call("plan", "cloud", "network");
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Expected a path inside infra\//u);
  }
  f.write("infra/Regional Services/network-01/main.tf", "# synthetic module\n");
  writeFileSync(manifest, initial.replace("infra/network", "infra/Regional Services/network-01"));
  assert.equal(f.run(["list"]).status, 0);
  writeFileSync(manifest, initial.replace('"engine":"terraform"', '"engine":"arbitrary"'));
  assert.notEqual(f.call("plan", "cloud", "network").status, 0);
  writeFileSync(manifest, initial);
  f.write("outside/keep", "unrelated");
  symlinkSync(f.file("outside"), f.file("infra/link"), "dir");
  writeFileSync(manifest, initial.replace("infra/network", "infra/link"));
  assert.notEqual(f.call("plan", "cloud", "network").status, 0);
  writeFileSync(manifest, initial);
  symlinkSync(f.file("outside"), f.file(".project-state"), "dir");
  assert.notEqual(f.call("plan", "cloud", "network").status, 0);
  assert.equal(existsSync(f.file("outside/infrastructure")), false);
  assert.deepEqual(f.events(), []);
});

test("a custom playbook or Terraform module defaults to a monitored deployment under any name", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const manifest = f.file("infra/operations.json");
  const initial = readFileSync(manifest, "utf8");
  for (const [target, name] of [
    ["cloud", "network"],
    ["site", "hosts"],
  ]) {
    for (const purpose of [undefined, "deployment", "unknown"]) {
      const document = JSON.parse(initial);
      document.targets[target].operations[name].purpose = purpose;
      writeFileSync(manifest, JSON.stringify(document));
      const preview = f.call("plan", target, name);
      assert.notEqual(preview.status, 0);
      assert.match(preview.stderr, /live monitor|may set purpose/u);
    }
  }
  assert.deepEqual(f.events(), []);
});

test("per-operation limits reach both engines and earlier target previews expire on apply", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const manifest = f.file("infra/operations.json");
  const document = JSON.parse(readFileSync(manifest, "utf8"));
  document.targets.cloud.operations.network.parallelism = 6;
  document.targets.site.operations.hosts.parallelism = 3;
  writeFileSync(manifest, JSON.stringify(document));
  const first = f.call("plan", "cloud", "network").stdout.trim();
  const second = f.call("plan", "cloud", "network").stdout.trim();
  const applied = f.call("apply", "cloud", "network", second);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(f.call("apply", "cloud", "network", first).stderr, /does not match/u);
  for (const event of f.events()) assert.ok(event.args.includes("-parallelism=6"));
  const planned = f.call("plan", "site", "hosts").stdout.trim();
  const configured = f.call("apply", "site", "hosts", planned);
  assert.equal(configured.status, 0, configured.stderr);
  for (const event of f.events().slice(-2)) {
    const forks = event.args.indexOf("--forks");
    assert.ok(forks >= 0);
    assert.equal(event.args[forks + 1], "3");
  }
  for (const bad of [0, true, 1.5, 257, "5"]) {
    document.targets.cloud.operations.network.parallelism = bad;
    writeFileSync(manifest, JSON.stringify(document));
    const rejected = f.call("plan", "cloud", "network");
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /parallelism/u);
  }
  assert.equal(f.events().length, 5);
});

function fleetProfile(f, target = {}) {
  const profile = {
    schemaVersion: 1,
    group: "web",
    distribution: "Debian",
    majorVersion: "13",
    converge: "infra/fleet/converge.yml",
    workload: "Serve the fixture release from a foreground process pool.",
    tuningDecision: "Use the vendor's defaults until this workload shows a bottleneck.",
    validation: "Measure active CPU use on both loopback aliases before activation.",
    reviewedOn: "2025-01-01",
    sources: ["https://docs.kernel.org/admin-guide/sysctl/kernel.html"],
    sysctls: {},
    ...target,
  };
  f.write("infra/fleet.json", JSON.stringify(profile));
  return profile;
}

function loopbackProfile(f, target = {}) {
  const distro = JSON.parse(
    spawnSync(
      "python3",
      [
        "-c",
        [
          "import json, platform",
          "release = platform.freedesktop_os_release()",
          "distributions = {'ubuntu':'Ubuntu','debian':'Debian','rhel':'RedHat','fedora':'Fedora','centos':'CentOS','rocky':'Rocky','almalinux':'AlmaLinux','alpine':'Alpine'}",
          "print(json.dumps({'distribution':distributions.get(release['ID'],release['NAME']),'majorVersion':release['VERSION_ID'].split('.')[0]}))",
        ].join("\n"),
      ],
      { encoding: "utf8" },
    ).stdout,
  );
  return fleetProfile(f, { ...distro, ...target });
}

function writeProbe(f, healthFile) {
  f.write(
    "infra/probe.yml",
    [
      "- name: Observe every selected fixture host",
      "  hosts: web",
      "  gather_facts: false",
      "  any_errors_fatal: true",
      "  tasks:",
      ...(healthFile
        ? [
            "    - ansible.builtin.slurp:",
            "        src: " + JSON.stringify(healthFile),
            "      register: observed",
            "    - ansible.builtin.set_fact:",
            "        health: >-",
            "          {{ {'status':'healthy','code':'ok'} if cause == 'ok' else",
            "             {'status':'unhealthy','code':'service-down','cause':cause} }}",
            "      vars:",
            `        cause: "{{ observed.content | b64decode | trim }}"`,
          ]
        : [
            "    - ansible.builtin.ping:",
            "    - ansible.builtin.set_fact:",
            "        health: {status: healthy, code: ok}",
          ]),
      "- name: Aggregate the synthetic health measurements",
      "  hosts: localhost",
      "  connection: local",
      "  gather_facts: false",
      "  tasks:",
      "    - ansible.builtin.set_fact:",
      `        nodes: "{{ nodes | default({}) | combine({item: hostvars[item].health | combine({'metrics':{'latencyMs':1,'errorRate':0,'load':0.1}})}) }}"`,
      `      loop: "{{ groups['web'] }}"`,
      "    - ansible.builtin.copy:",
      `        content: "{{ {'nodes':nodes} | to_json }}"`,
      `        dest: "{{ operator_watch_report }}"`,
      "        mode: '0600'",
      "      check_mode: false",
    ].join("\n") + "\n",
  );
}

function declaredDeployment(f) {
  f.write("infra/fleet/converge.yml", "---\n");
  fleetProfile(f);
  writeProbe(f);
  const definition = {
    engine: "ansible",
    inventory: "infra/hosts.ini",
    fleetProfile: "infra/fleet.json",
    monitor: {
      probe: "infra/probe.yml",
      intervalSeconds: 10,
      timeoutSeconds: 20,
      maxDeploySeconds: 120,
    },
    deployment: {
      prepare: "infra/stage.yml",
      activate: "infra/activate.yml",
      cpuStep: {
        argv: [
          "/usr/bin/python3",
          f.file("infra/stage.py"),
          "{workers}",
          "{{ literal }}; $(uname)",
        ],
        memoryMiBPerWorker: 32,
        minimumCpuFraction: 0.6,
        maxWorkers: 2,
      },
    },
  };
  f.write("infra/stage.yml", "---\n");
  f.write("infra/activate.yml", "---\n");
  const configure = (op = definition) =>
    f.write(
      "infra/operations.json",
      JSON.stringify({ targets: { site: { operations: { release: op } } } }),
    );
  configure();
  return { definition, configure };
}

test("managed deployments validate the CPU contract and bind the reviewed Ansible implementation", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const { definition, configure } = declaredDeployment(f);
  const preview = () => f.call("plan", "site", "release");
  for (const bad of [
    { ...definition, playbook: "infra/site.yml" },
    { ...definition, fleetProfile: undefined },
    { ...definition, monitor: undefined },
    { ...definition, deployment: undefined, playbook: "infra/site.yml" },
    { ...definition, deployment: undefined },
    { ...definition, deployment: { ...definition.deployment, group: "web" } },
    { ...definition, deployment: { ...definition.deployment, group: "web:other" } },
    { ...definition, deployment: { ...definition.deployment, activate: "../host" } },
    ...[
      { maxWorkers: true },
      { maxWorkers: 65537 },
      { minimumCpuFraction: 0 },
      { minimumCpuFraction: 1.2 },
      { memoryMiBPerWorker: 0 },
      { reserveMemoryMiB: -1 },
      { extra: true },
      { argv: ["relative", "{workers}"] },
      { argv: ["/{workers}", "{workers}"] },
      { argv: ["/bin/true"] },
      { argv: ["/bin/true", 0] },
    ].map((value) => ({
      ...definition,
      deployment: {
        ...definition.deployment,
        cpuStep: { ...definition.deployment.cpuStep, ...value },
      },
    })),
  ]) {
    configure(bad);
    assert.notEqual(preview().status, 0);
  }
  assert.equal(f.events().length, 0);
  configure();
  for (const owned of [
    "ansible/deploy.yml",
    "ansible/library/deploy_cpu_step.py",
    "ansible/verify_fleet.yml",
    "fleet_profile.py",
    "deploy_watch.py",
    "monitor_operations.py",
  ]) {
    const result = preview();
    assert.equal(result.status, 0, result.stderr);
    const before = f.events().length;
    const name = "scripts/infrastructure/" + owned;
    f.write(name, readFileSync(f.file(name), "utf8") + "\n# changed after preview\n");
    assert.match(
      f.call("apply", "site", "release", result.stdout.trim()).stderr,
      /does not match/u,
    );
    assert.equal(f.events().length, before);
  }
});

const installedAnsible =
  process.env.CODEXRIG_TEST_ANSIBLE_PLAYBOOK ||
  spawnSync("python3", ["-c", "import shutil; print(shutil.which('ansible-playbook') or '')"], {
    encoding: "utf8",
  }).stdout?.trim();

test(
  "real Ansible measures loopback staging, binds the host cohort and gates activation",
  {
    skip:
      process.platform !== "linux" || !installedAnsible
        ? "requires Linux and an installed ansible-playbook"
        : false,
  },
  (t) => {
    const f = operatorFixture(t, { ansiblePlaybook: installedAnsible, timeout: 60000 });
    f.configure();
    const { definition, configure } = declaredDeployment(f);
    loopbackProfile(f);
    const flag = (name) => f.file(".project-state/" + name);
    // Every connection in this fixture resolves to the local OS account.
    const hosts = (alias) =>
      [alias, "ansible_connection=local", "ansible_python_interpreter=/usr/bin/python3"].join(" ");
    f.write("infra/hosts.ini", "[web]\n" + hosts("fixture") + "\n");
    const markerTasks = (name) =>
      [
        "- name: Record fixture " + name,
        "  ansible.builtin.copy:",
        "    content: reached",
        "    dest: " + JSON.stringify(flag(name)),
        "    mode: '0600'",
        "  check_mode: false",
      ].join("\n") + "\n";
    f.write("infra/stage.yml", markerTasks("prepared"));
    f.write("infra/activate.yml", markerTasks("activated"));
    f.write(
      "infra/stage.py",
      [
        "import os, subprocess, sys, time",
        "from pathlib import Path",
        "n = int(sys.argv[1])",
        "assert n == 2 and sys.argv[2] == '{{ literal }}; $(uname)'",
        "work = 'import time; deadline=time.process_time()+0.5\\nwhile time.process_time()<deadline: pass'",
        "if Path(" + JSON.stringify(flag("serial")) + ").exists():",
        "    subprocess.run([sys.executable,'-c',work],check=True); time.sleep(0.25)",
        "else:",
        "    children=[subprocess.Popen([sys.executable,'-c',work]) for _ in range(n)]",
        "    assert all(child.wait() == 0 for child in children)",
      ].join("\n"),
    );
    const plan = () => f.call("plan", "site", "release");
    const apply = (id) => f.call("apply", "site", "release", id);
    const preview = plan();
    if (preview.status !== 0 && /Insufficient target capacity/u.test(preview.stderr)) {
      assert.equal(existsSync(flag("prepared")), false);
      assert.equal(existsSync(flag("activated")), false);
      t.diagnostic(
        "Loopback target has less than two usable CPUs; its capacity gate was exercised.",
      );
    } else {
      assert.equal(preview.status, 0, preview.stderr);
      assert.match(preview.stderr, /available_cpus/u);
      assert.equal(existsSync(flag("prepared")), false);
      assert.equal(existsSync(flag("activated")), false);
      const success = apply(preview.stdout.trim());
      assert.equal(success.status, 0, success.stderr);
      const measured = Number(/"average_cpus":\s*([0-9.]+)/u.exec(success.stderr)?.[1]);
      assert.ok(measured > 1.2, success.stderr);
      t.diagnostic(`Two target workers averaged ${measured.toFixed(2)} CPUs before activation.`);
      assert.equal(existsSync(flag("prepared")), true);
      assert.equal(existsSync(flag("activated")), true);
      rmSync(flag("prepared"));
      rmSync(flag("activated"));
      f.write(".project-state/serial", "1");
      const { prepare, ...withoutPreparation } = definition.deployment;
      configure({ ...definition, deployment: withoutPreparation });
      const next = plan();
      assert.equal(next.status, 0, next.stderr);
      const serial = apply(next.stdout.trim());
      assert.notEqual(serial.status, 0);
      const serialAverage = Number(/averaged ([0-9.]+) CPUs/u.exec(serial.stderr)?.[1]);
      assert.ok(serialAverage < 1.2, serial.stderr);
      t.diagnostic(
        `The serial stage averaged ${serialAverage.toFixed(2)} CPUs and did not activate.`,
      );
      assert.equal(existsSync(flag("activated")), false);
      assert.equal(existsSync(flag("prepared")), false, "the preparation task file is optional");
      configure();
      rmSync(flag("serial"));

      f.write("infra/hosts.ini", "[web]\n" + hosts("fixture") + "\n" + hosts("peer") + "\n");
      f.write(
        "infra/stage.yml",
        "- name: Stop one reviewed host after capacity check\n  ansible.builtin.meta: end_host\n  when: inventory_hostname == 'peer'\n",
      );
      const allHosts = plan();
      assert.equal(allHosts.status, 0, allHosts.stderr);
      const missed = apply(allHosts.stdout.trim());
      assert.notEqual(missed.status, 0);
      assert.match(
        missed.stderr,
        /Missing (verified fleet baseline|successful CPU measurement) for peer/u,
      );
      assert.equal(existsSync(flag("activated")), false);
      f.write("infra/hosts.ini", "[web]\n" + hosts("fixture") + "\n");
      f.write(
        "infra/stage.yml",
        "- name: Add a host after the preview\n  ansible.builtin.add_host:\n    name: unreviewed\n    groups: web\n    ansible_connection: local\n",
      );
      const beforeExpansion = plan();
      assert.equal(beforeExpansion.status, 0, beforeExpansion.stderr);
      const expanded = apply(beforeExpansion.stdout.trim());
      assert.notEqual(expanded.status, 0);
      assert.match(expanded.stderr, /membership changed during staging/u);
      assert.equal(existsSync(flag("activated")), false);
      f.write("infra/stage.yml", markerTasks("prepared"));
      f.write(
        "infra/dynamic.py",
        [
          "#!/usr/bin/env python3",
          "import json",
          "from pathlib import Path",
          "hosts = json.loads(Path(" + JSON.stringify(flag("members.json")) + ").read_text())",
          "print(json.dumps({'web': {'hosts': hosts}, '_meta':{'hostvars':{host:{'ansible_connection':'local','ansible_python_interpreter':'/usr/bin/python3'} for host in hosts}}}))",
        ].join("\n"),
      );
      chmodSync(f.file("infra/dynamic.py"), 0o700);
      configure({ ...definition, inventory: "infra/dynamic.py" });
      f.write(".project-state/members.json", '["fixture","peer"]');
      const cohort = plan();
      assert.equal(cohort.status, 0, cohort.stderr);
      f.write(".project-state/members.json", '["fixture"]');
      const changed = apply(cohort.stdout.trim());
      assert.notEqual(changed.status, 0);
      assert.match(
        changed.stderr,
        /(membership changed|[Mm]onitoring|[Hh]ost membership|[Oo]bserv)/u,
      );
      assert.equal(existsSync(flag("prepared")), false);
      assert.equal(existsSync(flag("activated")), false);
    }
    configure({
      ...definition,
      deployment: {
        ...definition.deployment,
        cpuStep: { ...definition.deployment.cpuStep, maxWorkers: 1 },
      },
    });
    const limited = plan();
    assert.notEqual(limited.status, 0);
    assert.match(limited.stderr, /Insufficient target capacity/u);
    assert.equal(existsSync(flag("prepared")), false);
    configure();
    f.write("infra/hosts.ini", "[web]\n");
    const empty = plan();
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /empty or missing/u);
    assert.equal(existsSync(flag("activated")), false);
  },
);

test("Terraform binds the exact researched fleet profile and passes the shared baseline to its module", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const profile = fleetProfile(f, { packages: { bash: "5.2.37-2" } });
  f.write(profile.converge, "---\n");
  const catalog = JSON.parse(readFileSync(f.file("infra/operations.json")));
  catalog.targets.cloud.operations.network.fleetProfile = "infra/fleet.json";
  f.write("infra/operations.json", JSON.stringify(catalog));
  const plan = () => f.call("plan", "cloud", "network");
  const reviewed = plan();
  assert.equal(reviewed.status, 0, reviewed.stderr);
  const projected = {
    distribution: "Debian",
    majorVersion: "13",
    sysctls: {},
    packages: profile.packages,
  };
  assert.deepEqual(JSON.parse(f.events().at(-1).profile), projected);
  f.write("infra/fleet.json", JSON.stringify(profile) + "\n");
  assert.match(
    f.call("apply", "cloud", "network", reviewed.stdout.trim()).stderr,
    /does not match/u,
  );
  assert.equal(f.events().length, 1);
  const fresh = plan();
  const applied = f.call("apply", "cloud", "network", fresh.stdout.trim());
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(JSON.parse(f.events().at(-1).profile), projected);
});

const usableBwrap =
  process.platform === "linux" &&
  spawnSync("bwrap", ["--ro-bind", "/", "/", "--", "/bin/true"]).status === 0;

test(
  "two real loopback targets report, repair and recheck divergent fleet configuration",
  {
    skip:
      !installedAnsible || !usableBwrap
        ? "requires ansible-playbook and unprivileged Linux mount namespaces"
        : false,
  },
  (t) => {
    const f = operatorFixture(t, { ansiblePlaybook: installedAnsible, timeout: 150000 });
    f.configure();
    const { definition } = declaredDeployment(f);
    const visible = ".project-state/web/conf";
    const privatePeer = ".project-state/peer/conf";
    const name = "service.conf";
    const digest = createHash("sha256").update("agreed\n").digest("hex");
    const profile = loopbackProfile(f, { files: { [f.file(visible + "/" + name)]: digest } });
    f.write(visible + "/" + name, "agreed\n");
    f.write(privatePeer + "/" + name, "drift\n");
    // Each target sees the same path, just as on distinct servers. Only fixture-owned files are writable.
    const shellDir = mkdtempSync("/tmp/codexrig-fleet-shell-");
    t.after(() => rmSync(shellDir, { recursive: true, force: true }));
    const shell = path.join(shellDir, "sh");
    const bwrapArgs = [
      "bwrap",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--bind",
      f.root,
      f.root,
      "--bind",
      f.file(privatePeer),
      f.file(visible),
      "--",
      "/bin/sh",
    ];
    writeFileSync(
      shell,
      "#!/usr/bin/python3\nimport os, sys\nos.execvp('bwrap', " +
        JSON.stringify(bwrapArgs) +
        " + sys.argv[1:])\n",
      { mode: 0o700 },
    );
    const ansibleVars = "ansible_connection=local ansible_python_interpreter=/usr/bin/python3";
    f.write(
      "infra/hosts.ini",
      "[web]\none " +
        ansibleVars +
        "\npeer " +
        ansibleVars +
        " ansible_shell_type=sh ansible_shell_executable=" +
        shell +
        "\n",
    );
    const healthFile = f.file(visible + "/service-health");
    for (const directory of [visible, privatePeer]) f.write(directory + "/service-health", "ok");
    writeProbe(f, healthFile);
    const repair = {
      engine: "ansible",
      inventory: definition.inventory,
      playbook: "infra/restore-listener.yml",
      remediation: {
        preconditions: "Confirm this replica's service listener has stopped.",
        impact:
          "Restart the listener on the affected replica while other replicas continue serving.",
        verification: "Probe every listener again and check the client error rate.",
        rollback: "Reapply the previous listener configuration on this replica.",
      },
    };
    f.write(
      repair.playbook,
      [
        "- name: Restore the fixture service listener",
        "  hosts: web",
        "  gather_facts: false",
        "  tasks:",
        "    - ansible.builtin.copy:",
        '        content: "ok"',
        "        dest: " + JSON.stringify(healthFile),
        "        mode: '0600'",
      ].join("\n") + "\n",
    );
    f.write(
      "infra/operations.json",
      JSON.stringify({
        targets: {
          site: {
            operations: {
              release: {
                ...definition,
                monitor: {
                  ...definition.monitor,
                  intervalSeconds: 120,
                  repairs: { "fixture-listener-stopped": "listener" },
                },
              },
              listener: repair,
              baseline: {
                engine: "ansible",
                inventory: definition.inventory,
                fleetProfile: definition.fleetProfile,
              },
            },
          },
        },
      }),
    );
    const copyTask = (label, content, destination, host) =>
      [
        "- name: " + label,
        "  ansible.builtin.copy:",
        "    content: " + JSON.stringify(content),
        "    dest: " + JSON.stringify(destination),
        "    mode: '0600'",
        "  check_mode: false",
        ...(host ? ["  when: inventory_hostname == '" + host + "'"] : []),
      ].join("\n") + "\n";
    f.write(
      profile.converge,
      copyTask("Converge common fixture baseline", "agreed\n", f.file(visible + "/" + name)),
    );
    f.write(
      "infra/stage.py",
      [
        "import subprocess, sys",
        "assert int(sys.argv[1]) == 2",
        "work = 'import time; end = time.process_time() + 0.6\\nwhile time.process_time() < end: pass'",
        "children = [subprocess.Popen([sys.executable, '-c', work]) for _ in range(2)]",
        "assert all(child.wait() == 0 for child in children)",
      ].join("\n"),
    );
    f.write(
      "infra/stage.yml",
      copyTask(
        "Record staging",
        "staged",
        f.file(".project-state/staged-{{ inventory_hostname }}"),
      ),
    );
    f.write(
      "infra/activate.yml",
      copyTask(
        "Activate only a verified cohort",
        "yes",
        f.file(".project-state/active-{{ inventory_hostname }}"),
      ),
    );
    const call = (action, op, id) => f.call(action, "site", op, id);
    const preview = call("plan", "baseline");
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stderr, /Fleet drift on peer: file /u);
    assert.doesNotMatch(preview.stderr, /Fleet drift on one: file /u);
    assert.equal(readFileSync(f.file(privatePeer + "/" + name), "utf8"), "drift\n");
    const blocked = call("plan", "release");
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Fleet drift on peer: file /u);
    assert.equal(existsSync(f.file(".project-state/staged-one")), false);
    const repaired = call("apply", "baseline", preview.stdout.trim());
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.equal(readFileSync(f.file(privatePeer + "/" + name), "utf8"), "agreed\n");

    const parity = call("plan", "release");
    if (parity.status !== 0 && /Insufficient target capacity/u.test(parity.stderr)) {
      t.diagnostic("Both targets converged; this host's CPU quota prevents release staging.");
      return;
    }
    assert.equal(parity.status, 0, parity.stderr);
    const active = call("apply", "release", parity.stdout.trim());
    assert.equal(active.status, 0, active.stderr);
    for (const host of ["one", "peer"]) {
      assert.equal(readFileSync(f.file(".project-state/active-" + host), "utf8"), "yes");
      rmSync(f.file(".project-state/active-" + host));
    }

    f.write(
      "infra/stage.yml",
      copyTask(
        "Introduce fixture drift on one prepared node",
        "changed\n",
        f.file(visible + "/" + name),
        "peer",
      ),
    );
    const last = call("plan", "release");
    assert.equal(last.status, 0, last.stderr);
    const drifted = call("apply", "release", last.stdout.trim());
    assert.notEqual(drifted.status, 0);
    assert.match(drifted.stderr, /Fleet drift on peer: file /u);
    for (const host of ["one", "peer"])
      assert.equal(existsSync(f.file(".project-state/active-" + host)), false);

    const recovery = call("plan", "baseline");
    assert.equal(recovery.status, 0, recovery.stderr);
    const converged = call("apply", "baseline", recovery.stdout.trim());
    assert.equal(converged.status, 0, converged.stderr);
    const attempts = () =>
      f.events().filter((event) => event.args.at(-1) === f.file(repair.playbook));
    // A genuinely observed incident begins after the initial healthy sample and the approved plan.
    f.write(
      "infra/stage.yml",
      copyTask("Observe an unowned failure", "cert-store-unreadable", healthFile, "peer"),
    );
    const unknown = call("plan", "release");
    assert.equal(unknown.status, 0, unknown.stderr);
    const denied = call("apply", "release", unknown.stdout.trim());
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /unresolved deployment incident at preactivation/iu);
    assert.deepEqual(attempts(), []);
    for (const host of ["one", "peer"])
      assert.equal(existsSync(f.file(".project-state/active-" + host)), false);

    f.write(privatePeer + "/service-health", "ok");
    f.write(
      "infra/stage.yml",
      copyTask("Fail the declared listener owner", "fixture-listener-stopped", healthFile, "peer"),
    );
    const known = call("plan", "release");
    assert.equal(known.status, 0, known.stderr);
    const restored = call("apply", "release", known.stdout.trim());
    assert.equal(restored.status, 0, restored.stderr);
    const runs = attempts();
    assert.deepEqual(
      runs.map((event) => event.args.includes("--check")),
      [true, false],
    );
    for (const event of runs) assert.deepEqual(event.hosts, ["peer"]);
    assert.equal(readFileSync(f.file(privatePeer + "/service-health"), "utf8"), "ok");
    const report = JSON.parse(
      readFileSync(f.file(".project-state/infrastructure/targets/site/last-watch-release.json")),
    );
    assert.deepEqual(report.repairAttempts, ["fixture-listener-stopped"]);
    const restoredAt = report.events.findIndex((event) => event.event === "repair");
    assert.ok(restoredAt >= 0);
    const fresh = report.events
      .slice(restoredAt + 1)
      .filter(
        (event) =>
          event.phase === "preactivation" && event.event === "observation" && event.healthy,
      );
    assert.ok(fresh.length >= 2, JSON.stringify(report));
    for (const host of ["one", "peer"])
      assert.equal(readFileSync(f.file(".project-state/active-" + host), "utf8"), "yes");
  },
);

test("only a documented ordinary playbook in the watched target and inventory owns a remediation", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const { definition } = declaredDeployment(f);
  const monitor = { ...definition.monitor, repairs: { "service-tls-expired": "renew" } };
  const watched = { ...definition, monitor };
  const owner = {
    engine: "ansible",
    inventory: definition.inventory,
    playbook: "infra/renew.yml",
    remediation: {
      preconditions: "Confirm the fixture service certificate has expired.",
      impact: "Rotate the key on the affected service replica during a rolling restart.",
      verification: "Probe the service endpoint and its dependent client after renewal.",
      rollback: "Restore the reviewed previous certificate and restart that service.",
    },
  };
  f.write(owner.playbook, "---\n");
  f.write("infra/other.ini", "[other]\n");
  const configure = (release, renew, other = {}) =>
    f.write(
      "infra/operations.json",
      JSON.stringify({
        targets: { site: { operations: { release, ...(renew ? { renew } : {}) } }, ...other },
      }),
    );
  // The canonical remediation is deliberately declared after its watched caller.
  configure(watched, owner);
  assert.equal(f.run(["list"]).status, 0);
  for (const invalid of [
    { ...owner, remediation: undefined },
    { ...owner, remediation: { ...owner.remediation, impact: " " } },
    { ...owner, inventory: "infra/other.ini" },
    { ...owner, monitor: definition.monitor },
    { engine: "terraform", directory: "infra/network" },
    { engine: "ansible", fleetProfile: definition.fleetProfile, inventory: definition.inventory },
  ]) {
    configure(watched, invalid);
    assert.notEqual(f.call("plan", "site", "release").status, 0);
  }
  for (const repair of ["release", "missing", "infra/renew.yml"]) {
    configure(
      { ...definition, monitor: { ...monitor, repairs: { "service-tls-expired": repair } } },
      owner,
    );
    assert.notEqual(f.call("plan", "site", "release").status, 0);
  }
  configure(watched, undefined, { other: { operations: { renew: owner } } });
  assert.notEqual(f.call("plan", "site", "release").status, 0);
  assert.equal(f.events().length, 0);
});

test("monitored Terraform binds the probe and named repair source before applying its plan", (t) => {
  const f = operatorFixture(t);
  f.configure();
  const { definition } = declaredDeployment(f);
  const monitor = {
    ...definition.monitor,
    inventory: definition.inventory,
    repairs: { "service-listener-missing": "service" },
  };
  const service = {
    engine: "ansible",
    inventory: definition.inventory,
    playbook: "infra/site.yml",
    remediation: {
      preconditions: "Observe the absent service listener.",
      impact: "Only the affected server reloads its shared listener.",
      verification: "Check the endpoint from the shared service network.",
      rollback: "Restore the saved listener configuration.",
    },
  };
  const configure = (watch) =>
    f.write(
      "infra/operations.json",
      JSON.stringify({
        targets: {
          cloud: {
            operations: {
              network: { engine: "terraform", directory: "infra/network", monitor: watch },
              service,
            },
          },
        },
      }),
    );
  configure({ ...monitor, inventory: undefined });
  assert.notEqual(f.run(["list"]).status, 0);
  configure(monitor);
  for (const file of [monitor.probe, service.playbook]) {
    const plan = f.call("plan", "cloud", "network");
    assert.equal(plan.status, 0, plan.stderr);
    const events = f.events().length;
    f.write(file, readFileSync(f.file(file), "utf8") + "\n# changed after review\n");
    assert.match(f.call("apply", "cloud", "network", plan.stdout.trim()).stderr, /does not match/u);
    assert.equal(f.events().length, events);
  }
  const fresh = f.call("plan", "cloud", "network");
  const applied = f.call("apply", "cloud", "network", fresh.stdout.trim());
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(
    existsSync(f.file(".project-state/infrastructure/targets/cloud/last-watch-network.json")),
  );
});
