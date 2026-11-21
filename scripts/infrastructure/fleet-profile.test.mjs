/** Exercises the versioned fleet policy, read-only host comparison and packaged Ansible workflow. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = path.dirname(fileURLToPath(import.meta.url));
const sha = (text) => createHash("sha256").update(text).digest("hex");
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "fleet profile "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name) => path.join(root, name);
  const write = (name, content) => {
    mkdirSync(path.dirname(file(name)), { recursive: true });
    writeFileSync(file(name), content);
  };
  return { root, file, write };
}

const base = {
  schemaVersion: 1,
  group: "web",
  distribution: "Ubuntu",
  majorVersion: "24",
  converge: "infra/role.yml",
  workload: "Serve small HTTP requests.",
  tuningDecision: "Keep distributor defaults for this network workload.",
  validation: "Compare p95 latency against the representative workload.",
  reviewedOn: "2025-01-15",
  sources: ["https://docs.kernel.org/networking/ip-sysctl.html"],
  sysctls: {},
};
function python(script, ...args) {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      `import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import fleet_profile as fleet
${script}`,
      source,
      ...args,
    ],
    { encoding: "utf8" },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("controller requires evidence, a single group, safe declarations and version 1", (t) => {
  const f = fixture(t);
  f.write("infra/role.yml", "[]\n");
  symlinkSync(f.file("infra/role.yml"), f.file("infra/link.yml"));
  const load = (document) => {
    f.write(
      "infra/profile.json",
      typeof document === "string" ? document : JSON.stringify(document),
    );
    return python(
      `from admin import declared_path, OperationError
try: result = fleet.load_fleet_profile(Path(sys.argv[2]), "infra/profile.json", declared_path)
except (ValueError, OSError, OperationError) as err: result = {"error": str(err)}
print(json.dumps(result))`,
      f.root,
    );
  };
  assert.deepEqual(load(base), base);
  const literalResearch = {
    ...base,
    workload: "Test {{ literal }}; transfer no research text to Jinja.",
  };
  assert.deepEqual(load(literalResearch), literalResearch);
  const complete = {
    ...base,
    packages: { bash: "5.2:4-1" },
    files: { "/etc/app.conf": sha("x") },
    sysctls: { "net.ipv4.ip_forward": "0", "net.ipv4.ip_local_port_range": "32768\t60999" },
  };
  assert.deepEqual(load(complete), complete);
  const incomplete = { ...base };
  delete incomplete.validation;
  for (const bad of [
    incomplete,
    { ...base, extra: "field" },
    { ...base, schemaVersion: true },
    { ...base, group: "web:!unstable" },
    { ...base, majorVersion: 24 },
    { ...base, workload: "  " },
    { ...base, tuningDecision: "TBD" },
    { ...base, reviewedOn: "2999-01-01" },
    { ...base, reviewedOn: "2025-02-31" },
    { ...base, sources: [] },
    { ...base, sources: ["https://"] },
    { ...base, sources: ["http://example.test/doc"] },
    { ...base, sources: ["https://user:pass@example.test/"] },
    { ...base, converge: "infra/../other.yml" },
    { ...base, converge: "infra/link.yml" },
    { ...base, sysctls: { "net/unsafe": "1" } },
    { ...base, sysctls: { "net.test": 1 } },
    { ...base, files: { "/etc/../x": sha("x") } },
    { ...base, files: { "/etc/x": "00" } },
    { ...base, packages: { bash: "{{ unsafe }}" } },
    { ...base, packages: { bash: ">=5.2" } },
    JSON.stringify(base).replace('"sysctls":{}', '"sysctls":{"net.x":"1","net.x":"2"}'),
  ])
    assert.ok(load(bad).error, JSON.stringify(bad));
});

test("observe actual bytes, normalized kernel values and every declared package version", (t) => {
  const f = fixture(t);
  const contents = "private fixture configuration bytes\n";
  f.write("app.conf", contents);
  f.write("sys/net/test/value", "1\t2\n");
  const profile = {
    distribution: "Debian",
    majorVersion: "12",
    sysctls: { "net.test.value": "1 2" },
    files: { [f.file("app.conf")]: sha(contents) },
    packages: { hello: "1:2.3-4.el9", bash: "5.2-3+deb12" },
  };
  const records = {
    hello: [{ source: "rpm", version: "2.3", release: "4.el9", epoch: 1 }],
    bash: [{ source: "apt", version: "5.2-3+deb12" }],
  };
  const observe = (contract) =>
    python(
      `profile, records = json.loads(sys.argv[2])
print(json.dumps(fleet.host_drift(profile, "Debian", "12", records, Path(sys.argv[3]))))`,
      JSON.stringify([contract, records]),
      f.file("sys"),
    );
  assert.deepEqual(observe(profile), []);
  records.hello.push({ source: "rpm", version: "2.3", release: "4.el9", epoch: 0 });
  const wrong = {
    ...profile,
    distribution: "Ubuntu",
    majorVersion: "24",
    files: { [f.file("missing.conf")]: sha(contents) },
    sysctls: { "net.test.absent": "1" },
  };
  assert.deepEqual(observe(wrong), [
    "distribution",
    "majorVersion",
    "package hello",
    "sysctl net.test.absent",
    "file " + f.file("missing.conf"),
  ]);
});

const ansible =
  process.env.CODEXRIG_TEST_ANSIBLE_PLAYBOOK ||
  spawnSync(
    "python3",
    ["-B", "-c", "import shutil; print(shutil.which('ansible-playbook') or '')"],
    { encoding: "utf8" },
  ).stdout?.trim();
test(
  "real Ansible flags one drifting local alias and preserves technical failures in repair previews",
  {
    skip:
      !ansible || process.platform !== "linux"
        ? "requires Linux and installed ansible-playbook"
        : false,
  },
  (t) => {
    const f = fixture(t);
    for (const name of ["fleet_profile.py", "ansible/verify_fleet.yml"]) {
      const target = f.file("scripts/infrastructure/" + name);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(source, name), target);
    }
    const marker = "private-file-content-must-not-appear";
    const config = f.file("target.conf");
    f.write("target.conf", marker);
    f.write("ansible.cfg", "[defaults]\n");
    symlinkSync(f.file("loop"), f.file("loop"));
    f.write(
      "hosts.ini",
      "[web]\nalpha ansible_connection=local\nbeta ansible_connection=local\n[web:vars]\nansible_python_interpreter=/usr/bin/python3\n",
    );
    f.write(
      "test.yml",
      `---
- hosts: web
  serial: 1
  gather_subset: ["!all", "!min", distribution]
  vars:
    operator_fleet_profile:
      distribution: "{{ ansible_facts.distribution }}"
      majorVersion: "{{ ansible_facts.distribution_major_version }}"
      sysctls: "{{ fixture_sysctls }}"
      files: "{{ fixture_files }}"
      packages: "{{ fixture_packages }}"
  tasks:
    - ansible.builtin.include_tasks: scripts/infrastructure/ansible/verify_fleet.yml
    - ansible.builtin.debug:
        msg: "fixture host={{ inventory_hostname }} verified={{ operator_fleet_verified }}"
    - name: Model the second node's different bytes in the disposable loopback fixture
      ansible.builtin.copy:
        dest: "{{ fixture_path }}"
        content: other-fixture-content
        mode: '0600'
      check_mode: false
      when: fixture_flip and inventory_hostname == 'alpha'
`,
    );
    const invoke = (options, args) => {
      f.write(
        "params.json",
        JSON.stringify({
          fixture_sysctls: {},
          fixture_files: {},
          fixture_packages: {},
          fixture_flip: false,
          fixture_path: config,
          ...options,
        }),
      );
      const result = spawnSync(
        ansible,
        ["-i", "hosts.ini", "test.yml", "-e", "@params.json", ...args],
        {
          cwd: f.root,
          timeout: 60000,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            HOME: f.root,
            ANSIBLE_HOME: f.file("ansible-home"),
            ANSIBLE_CONFIG: f.file("ansible.cfg"),
            LC_ALL: "C.UTF-8",
            PYTHONDONTWRITEBYTECODE: "1",
          },
        },
      );
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const vanilla = invoke({}, ["--limit", "alpha", "--check"]);
    assert.equal(vanilla.status, 0, vanilla.output);
    assert.match(vanilla.output, /host=alpha verified=True/iu);
    const apt = spawnSync("/usr/bin/python3", ["-B", "-c", "import apt"], { cwd: f.root });
    const installed = spawnSync("dpkg-query", ["-W", "-f", "${Version}", "bash"], {
      cwd: f.root,
      encoding: "utf8",
    });
    const nativePackages =
      apt.status === 0 && installed.status === 0 ? { bash: installed.stdout } : {};
    const mixed = invoke(
      {
        fixture_flip: true,
        fixture_files: { [config]: sha(marker) },
        fixture_sysctls: { "kernel.ostype": "Linux" },
        fixture_packages: nativePackages,
      },
      [],
    );
    assert.notEqual(mixed.status, 0);
    assert.match(mixed.output, /Fleet drift on beta: file /u);
    assert.doesNotMatch(mixed.output, /Fleet drift on alpha|private-file-content-must-not-appear/u);
    if (nativePackages.bash)
      t.diagnostic("Ansible verified the locally installed Debian-format bash version.");
    const report = invoke(
      { fixture_files: { [f.file("missing")]: sha(marker) }, operator_fleet_report_only: true },
      ["--limit", "beta", "--check"],
    );
    assert.equal(report.status, 0, report.output);
    assert.match(report.output, /Fleet drift on beta: file /u);
    assert.match(report.output, /host=beta verified=False/iu);
    const technical = invoke(
      { fixture_files: { [f.file("loop")]: sha(marker) }, operator_fleet_report_only: true },
      ["--limit", "beta", "--check"],
    );
    assert.notEqual(technical.status, 0);
    assert.match(technical.output, /Fleet observation failed on beta.*Cannot read fleet file/su);
  },
);
