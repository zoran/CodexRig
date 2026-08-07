import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function markdown(lines) {
  return `${lines.join("\n")}\n`;
}

export function adaptContextIndexDocForGeneratedProject(targetRoot) {
  const contextIndexPath = path.join(targetRoot, "docs", "context-index.md");
  const source = readFileSync(contextIndexPath, "utf8");
  const resetOverview = /Every framework reset removes[\s\S]*?bootstrap their own index\.\n\n/;
  const cleanupDetails =
    /`context:clean` is the explicit standalone operation[\s\S]*?optional pinned-model integration test\.\n/;
  if (!resetOverview.test(source) || !cleanupDetails.test(source)) {
    throw new Error(
      "Source context-index documentation is missing the generated-project reset boundary.",
    );
  }
  const generated = source
    .replace(
      resetOverview,
      markdown([
        "Use `context:clean` when complete index deletion is intentional. The next `pnpm setup`,",
        "`pnpm context:index`, or semantic search rebuilds it and may need to download the pinned model",
        "again. Generated projects and portable exports exclude all vector and model state and bootstrap",
        "their own index.",
        "",
      ]),
    )
    .replace(
      cleanupDetails,
      markdown([
        "`context:clean` is the explicit standalone operation that removes the complete project-owned",
        "index after acquiring the maintenance lock. It is intentionally broader than opportunistic",
        "maintenance and still requires the ownership marker and safe fixed project path. There is",
        "currently no separate production retrieval-evaluation command; deterministic quality evaluation",
        "remains in the hermetic regression suite and the optional pinned-model integration test.",
      ]),
    );
  writeFileSync(contextIndexPath, generated, "utf8");
}
