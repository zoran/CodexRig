/** Carries Mise's integrity-bound portable pnpm graph through transactional maintenance. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readRepositoryFile } from "../filesystem/repository-files.mjs";
import { miseLockBlocks } from "../contracts/mise-toolchain-configuration.mjs";

export const pnpmGraphPaths = Object.freeze([
  ".codex/.mise/locks/pnpm/current/package.json",
  ".codex/.mise/locks/pnpm/current/aube-lock.yaml",
]);

function graphReference(lock, version) {
  const entries = miseLockBlocks(lock).filter((entry) => entry.tool === "pnpm");
  if (entries.length !== 1 || entries[0].version !== version)
    throw new Error("Portable pnpm requires one primary version and one locked npm graph.");
  const fields = [...entries[0].block.matchAll(/^aube\s*=.*$/gmu)];
  const reference =
    fields.length === 1 &&
    /^aube = \{ path = "(\.mise\/locks\/pnpm\/[0-9A-Za-z.+_-]+)", digest = "sha256:([a-f0-9]{64})" \}$/u.exec(
      fields[0][0],
    );
  if (!reference)
    throw new Error("Portable pnpm requires a contained, integrity-bound Mise graph.");
  if (![".mise/locks/pnpm/current", `.mise/locks/pnpm/${version}`].includes(reference[1]))
    throw new Error("Portable pnpm graph must belong to its selected version.");
  return { field: fields[0][0], directory: reference[1], digest: reference[2] };
}

/** Native Mise validates the graph on install; this gate also binds all publication inputs. */
export function readPnpmToolchainGraph(root, lock, version, { allowNativePath = false } = {}) {
  const reference = graphReference(lock, version);
  if (!allowNativePath && reference.directory !== ".mise/locks/pnpm/current")
    throw new Error("Portable pnpm graph must use its canonical pnpm graph location.");
  const read = (name) => readRepositoryFile(root, `.codex/${reference.directory}/${name}`);
  const manifest = read("package.json");
  const graph = read("aube-lock.yaml");
  const digest = createHash("sha256").update(graph.replaceAll("\r\n", "\n")).digest("hex");
  if (digest !== reference.digest)
    throw new Error("Portable pnpm graph integrity differs from mise.lock.");
  const parsed = JSON.parse(manifest);
  if (
    parsed.private !== true ||
    JSON.stringify(parsed.dependencies) !== JSON.stringify({ pnpm: version }) ||
    Object.keys(parsed).some((key) => !["name", "private", "dependencies"].includes(key))
  )
    throw new Error(
      "Portable pnpm graph manifest must declare only the exact reviewed pnpm release.",
    );
  return { ...reference, manifest, graph };
}

/** Normalize native sidecar paths once so every transaction and generator selects the same files. */
export function projectPnpmToolchainGraph(root, version) {
  const lock = readRepositoryFile(root, ".codex/mise.lock");
  const graph = readPnpmToolchainGraph(root, lock, version, { allowNativePath: true });
  if (graph.directory === ".mise/locks/pnpm/current") return;
  mkdirSync(path.join(root, ".codex/.mise/locks/pnpm/current"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(root, pnpmGraphPaths[0]), graph.manifest, { mode: 0o600 });
  writeFileSync(path.join(root, pnpmGraphPaths[1]), graph.graph, { mode: 0o600 });
  writeFileSync(
    path.join(root, ".codex/mise.lock"),
    lock.replace(
      graph.field,
      `aube = { path = ".mise/locks/pnpm/current", digest = "sha256:${graph.digest}" }`,
    ),
    { mode: 0o600 },
  );
}
