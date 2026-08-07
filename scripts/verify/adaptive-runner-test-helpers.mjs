import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPlan } from "./adaptive-runner.mjs";

export function writeManifest(directory, pkg) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(pkg)}\n`, "utf8");
}

export function internalDependencies(dependencies = []) {
  return {
    dependencies,
    devDependencies: [],
    optionalDependencies: [],
    peerDependencies: [],
  };
}

function rootProductLayout() {
  return {
    findings: [],
    sourceRoots: ["src"],
    units: [
      {
        root: ".",
        sourceRoots: ["src"],
        surfaceRoot: "src",
        kind: "default",
        declaredBy: "fixture",
      },
    ],
  };
}

export function route(relativePaths, overrides = {}) {
  return buildPlan(
    {
      forceFull: false,
      forceReason: "",
      mode: "full",
      printPlan: true,
      simulatedPaths: [],
    },
    {
      basis: { reason: "", trusted: true },
      changedPaths: relativePaths,
      gitAvailable: true,
      productLayout: rootProductLayout(),
      workspaceManifests: [],
      ...overrides,
    },
  );
}
