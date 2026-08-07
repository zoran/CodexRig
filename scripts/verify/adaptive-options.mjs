import process from "node:process";
import { normalizePath, unique } from "./adaptive-state.mjs";

const modes = new Set(["repo", "full", "pre-push"]);

function usage() {
  console.log(`Usage: node scripts/verify/adaptive.mjs [options]

Options:
  --mode <repo|full|pre-push>        Verification entry point. Default: repo.
  --print-plan                       Print selected checks without running them.
  --path <path>                      Simulate a changed path for plan inspection.
  --basis-only                       Refresh only a content-identical committed Git basis.
  --force-full                       Explicitly request otherwise-uncovered full coverage.
  --force-reason <kind: id - reason> Required with --force-full. Kinds: owner-request, uncovered-risk.
  --validate-pre-push-refs           Validate clean HEAD against Git pre-push stdin.
`);
}

export function parseArgs(argv) {
  const options = {
    mode: "repo",
    basisOnly: false,
    forceFull: false,
    forceReason: "",
    printPlan: false,
    simulatedPaths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--no-cache") {
      throw new Error(
        "--no-cache is forbidden; recompute missing coverage or use --force-full with a concrete owner reason.",
      );
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--print-plan") {
      options.printPlan = true;
    } else if (arg === "--basis-only") {
      options.basisOnly = true;
    } else if (arg === "--force-full") {
      options.forceFull = true;
    } else if (arg === "--force-reason") {
      options.forceReason = argv[++index] ?? "";
    } else if (arg.startsWith("--force-reason=")) {
      options.forceReason = arg.slice("--force-reason=".length);
    } else if (arg === "--mode") {
      options.mode = argv[++index] ?? "";
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
    } else if (arg === "--path") {
      options.simulatedPaths.push(argv[++index] ?? "");
    } else if (arg.startsWith("--path=")) {
      options.simulatedPaths.push(arg.slice("--path=".length));
    } else {
      throw new Error(`Unknown adaptive verification argument: ${arg}`);
    }
  }

  if (!modes.has(options.mode)) {
    throw new Error(`Invalid adaptive verification mode: ${options.mode}`);
  }
  options.simulatedPaths = unique(options.simulatedPaths.map(normalizePath).filter(Boolean));
  if (options.simulatedPaths.length > 0 && !options.printPlan) {
    throw new Error("--path requires --print-plan and cannot execute verification commands.");
  }
  if (
    options.basisOnly &&
    (options.mode !== "repo" ||
      options.printPlan ||
      options.simulatedPaths.length > 0 ||
      options.forceFull ||
      options.forceReason)
  ) {
    throw new Error(
      "--basis-only is reserved for a commandless content-identical Git-basis refresh.",
    );
  }
  options.forceReason = options.forceReason.trim();
  if (options.forceReason && !options.forceFull) {
    throw new Error("--force-reason requires --force-full.");
  }
  if (options.forceFull) {
    if (options.mode === "pre-push") {
      throw new Error("--force-full cannot be combined with pre-push evidence validation.");
    }
    const structuredReason =
      /^(owner-request|uncovered-risk): ([a-z0-9][a-z0-9._/-]{1,63}) - ([^\0\r\n]+)$/iu.exec(
        options.forceReason,
      );
    const detail = structuredReason?.[3] ?? "";
    const words = detail.match(/[A-Za-z0-9][A-Za-z0-9_-]*/gu) ?? [];
    if (
      !structuredReason ||
      options.forceReason.length > 500 ||
      words.length < 3 ||
      detail.length < 12 ||
      /\b(?:cache(?:\s+miss)?|failed|failure|nonzero|profile\s+miss|rerun|retry|tests?\s+failed)\b/iu.test(
        detail,
      )
    ) {
      throw new Error(
        "--force-full requires `owner-request: <owner-id> - <reason>` or `uncovered-risk: <risk-id> - <reason>`; a prior failure or cache miss is not sufficient.",
      );
    }
  }
  return options;
}
