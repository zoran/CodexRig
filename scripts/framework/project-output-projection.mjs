/** Owns the generated installation's independent protocol namespace and output attribution boundary. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listStagedTransferFiles } from "../repository/source-inventory.mjs";

/** New installations use one neutral protocol; source sessions keep their own current namespace. */
export function projectOutputText(content) {
  return content
    .replaceAll("CODEXRIG", "PROJECT")
    .replaceAll("CodexRig", "Project")
    .replaceAll("codexrig", "project");
}

export function projectOutputProjection(root) {
  for (const file of listStagedTransferFiles({ root })) {
    const target = path.join(root, file);
    const before = readFileSync(target, "utf8");
    const after = projectOutputText(before);
    if (before !== after) writeFileSync(target, after);
  }
}

/** Additional output evidence; positive capability selection and executable tests own acceptance. */
export function assertIndependentProjectOutput(root) {
  for (const file of listStagedTransferFiles({ root })) {
    if (
      /codexrig|zoran[ /-]kikic|github\.com\/zoran/iu.test(
        file + "\n" + readFileSync(path.join(root, file), "utf8"),
      )
    ) {
      throw new Error(`Generated file contains source attribution or identity: ${file}.`);
    }
  }
}
