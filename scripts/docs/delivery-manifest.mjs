/** Owns delivery manifest behavior for the durable documentation contract boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  deliveryConfigurationFindings,
  deliveryConfigurationPath,
  effectiveDeliveryTargets,
  initialDeliveryConfiguration,
  parseDeliveryConfiguration,
  reconcileDetectedDeliveryTargets,
} from "../contracts/delivery-configuration.mjs";
import { isReusableFrameworkSource } from "../contracts/framework-contract.mjs";
import { discoverDeliveryEnvironmentEvidence } from "../repository/delivery-environment-discovery.mjs";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";

export const deliveryManifestStartMarker = "<!-- codexrig:delivery-inventory:start -->";
export const deliveryManifestEndMarker = "<!-- codexrig:delivery-inventory:end -->";

function readRegularText(root, relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  if (!existsSync(target)) return { content: null, finding: null };
  try {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return { content: null, finding: `${relativePath} must be a non-symlink regular file` };
    }
    return { content: readFileSync(target, "utf8"), finding: null };
  } catch {
    return { content: null, finding: `${relativePath} could not be read safely` };
  }
}

export function renderDeliveryManifestProjection({ configuration, sourceFramework = false }) {
  const lines = [deliveryManifestStartMarker, ""];
  if (sourceFramework) {
    lines.push(
      "- Product delivery inventory: this neutral framework source has no integrated product environment.",
    );
  } else {
    const effectiveTargets = effectiveDeliveryTargets(configuration);
    lines.push(`- Configured delivery default: \`${configuration.defaultTarget}\`.`);
    lines.push(
      effectiveTargets.length === 0
        ? "- Integrated delivery environments: none."
        : `- Integrated delivery environments: ${effectiveTargets.map((target) => `\`${target}\``).join(", ")}.`,
    );
    lines.push(`- Delivery inventory owner: \`${deliveryConfigurationPath}\`.`);
  }
  lines.push("", deliveryManifestEndMarker);
  return lines.join("\n");
}

function markerOccurrences(content, marker) {
  return String(content).split(marker).length - 1;
}

function replaceOrInsertProjection(content, projection) {
  const startCount = markerOccurrences(content, deliveryManifestStartMarker);
  const endCount = markerOccurrences(content, deliveryManifestEndMarker);
  if (startCount > 1 || endCount > 1 || startCount !== endCount) {
    return { content, finding: "docs/project.md has malformed delivery inventory markers" };
  }
  if (startCount === 1) {
    const start = content.indexOf(deliveryManifestStartMarker);
    const end = content.indexOf(deliveryManifestEndMarker, start);
    if (end < start) {
      return { content, finding: "docs/project.md has malformed delivery inventory markers" };
    }
    const after = end + deliveryManifestEndMarker.length;
    return {
      content: `${content.slice(0, start)}${projection}${content.slice(after)}`,
      finding: null,
    };
  }

  const heading = /^## System Shape\s*$/mu.exec(content);
  if (!heading) {
    return {
      content,
      finding: "docs/project.md needs ## System Shape before delivery reconciliation",
    };
  }
  const sectionStart = heading.index + heading[0].length;
  const remainder = content.slice(sectionStart);
  const nextHeading = /^##\s+/mu.exec(remainder);
  const insertion = nextHeading ? sectionStart + nextHeading.index : content.length;
  const before = content.slice(0, insertion).trimEnd();
  const after = content.slice(insertion).trimStart();
  return {
    content: `${before}\n\n${projection}\n\n${after}`.replace(/\n{3,}$/u, "\n"),
    finding: null,
  };
}

export function deliveryReconciliationPlan({
  root = repositoryRoot,
  manifestContent,
  relativePaths,
} = {}) {
  const sourceFramework = isReusableFrameworkSource(root);
  const activeFiles = relativePaths ?? listActiveFiles({ root });
  const blockingFindings = [];
  const driftFindings = [];
  const writes = [];
  const deliveryFile = readRegularText(root, deliveryConfigurationPath);
  if (deliveryFile.finding) blockingFindings.push(deliveryFile.finding);

  let configuration;
  let expectedDeliveryContent = null;
  if (sourceFramework) {
    if (deliveryFile.content !== null) {
      blockingFindings.push(
        `the neutral source framework must not own generated ${deliveryConfigurationPath}`,
      );
    }
  } else {
    const currentContent = deliveryFile.content;
    const configurationContent = currentContent ?? initialDeliveryConfiguration();
    const configurationFindings = deliveryConfigurationFindings(configurationContent);
    if (configurationFindings.length > 0) blockingFindings.push(...configurationFindings);
    else {
      configuration = parseDeliveryConfiguration(configurationContent);
      const discovery = discoverDeliveryEnvironmentEvidence({ root, relativePaths: activeFiles });
      expectedDeliveryContent = reconcileDetectedDeliveryTargets(
        configuration,
        discovery.detectedTargets,
      );
      const expectedConfiguration = parseDeliveryConfiguration(expectedDeliveryContent);
      const effective = new Set(effectiveDeliveryTargets(expectedConfiguration));
      for (const hint of discovery.ambiguousHints) {
        if (!effective.has(hint.target)) {
          blockingFindings.push(
            `${hint.path} may describe ${hint.target} delivery but is not in a recognized environment boundary; declare the target in ${deliveryConfigurationPath} or move the adapter into a typed delivery path`,
          );
        }
      }
      // The delivery owner compares validated state; the repository formatter owns whitespace.
      if (currentContent === null || !isDeepStrictEqual(configuration, expectedConfiguration)) {
        driftFindings.push(
          currentContent === null
            ? `missing generated delivery owner: ${deliveryConfigurationPath}`
            : `${deliveryConfigurationPath} does not match current repository delivery evidence`,
        );
        writes.push({
          after: expectedDeliveryContent,
          before: currentContent,
          relativePath: deliveryConfigurationPath,
        });
      }
      configuration = expectedConfiguration;
    }
  }

  const manifestFile =
    manifestContent === undefined
      ? readRegularText(root, "docs/project.md")
      : { content: String(manifestContent), finding: null };
  if (manifestFile.finding) blockingFindings.push(manifestFile.finding);
  if (manifestFile.content === null) {
    blockingFindings.push("docs/project.md is required before delivery reconciliation");
  } else if (sourceFramework || configuration) {
    const projection = renderDeliveryManifestProjection({ configuration, sourceFramework });
    const reconciled = replaceOrInsertProjection(manifestFile.content, projection);
    if (reconciled.finding) blockingFindings.push(reconciled.finding);
    else if (reconciled.content !== manifestFile.content) {
      driftFindings.push("docs/project.md delivery inventory projection is stale");
      if (manifestContent === undefined) {
        writes.push({
          after: reconciled.content,
          before: manifestFile.content,
          relativePath: "docs/project.md",
        });
      }
    }
  }

  return {
    blockingFindings: [...new Set(blockingFindings)].sort(),
    driftFindings: [...new Set(driftFindings)].sort(),
    sourceFramework,
    writes,
  };
}

export function deliveryManifestFindings({ content, root, relativePaths } = {}) {
  const plan = deliveryReconciliationPlan({ manifestContent: content, relativePaths, root });
  return [...plan.blockingFindings, ...plan.driftFindings].sort();
}
