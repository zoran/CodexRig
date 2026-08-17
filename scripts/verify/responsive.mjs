/** Owns responsive behavior for the repository verification boundary. */
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  failMessage,
  reportResult,
  styleExtensions,
  webSurfaceSummary,
} from "../web/web-quality-scan.mjs";

export function responsiveFailures({ files, hasWebSurface }) {
  const failures = [];
  if (!hasWebSurface) return failures;

  const styleFiles = files.filter((file) => styleExtensions.has(file.extension));
  const combinedStyles = styleFiles.map((file) => file.content).join("\n");
  const contentDrivenStyles = combinedStyles.replace(
    /@media\s*\([^)]*\bdevice-(?:height|width)\b[^)]*\)/giu,
    "",
  );
  const hasLayoutBehavior =
    /\b(?:display\s*:\s*(?:flex|grid)|grid-template|position\s*:\s*(?:fixed|sticky)|columns?\s*:)/iu.test(
      combinedStyles,
    );
  const hasAdaptiveLayoutEvidence =
    /@(?:container|media)\b|\b(?:auto-fit|auto-fill|minmax|clamp)\s*\(|\bflex-wrap\s*:\s*(?:wrap|wrap-reverse)\b/iu.test(
      contentDrivenStyles,
    );
  if (hasLayoutBehavior && !hasAdaptiveLayoutEvidence) {
    failures.push(
      "web surface defines layout behavior without content-driven responsive evidence such as container/media adaptation, fluid grid sizing, clamp(), or wrapping",
    );
  }

  for (const file of files) {
    const content = file.content;

    if (
      /(?:\b(?:navigator\.userAgent|userAgentData)\b[\s\S]{0,160}\b(?:android|ipad|iphone|mobile|tablet)\b|\b(?:android|ipad|iphone|mobile|tablet)\b[\s\S]{0,160}\b(?:navigator\.userAgent|userAgentData)\b)/iu.test(
        content,
      )
    ) {
      failures.push(
        failMessage(
          file,
          "layout must respond to available space and capabilities rather than user-agent device classes",
        ),
      );
    }

    if (/<html\b/i.test(content)) {
      const viewportMatch = /<meta\s+[^>]*name=["']viewport["'][^>]*>/i.exec(content);
      if (!viewportMatch) {
        failures.push(failMessage(file, "document shell must include a viewport meta tag"));
      } else if (/user-scalable\s*=\s*no/i.test(viewportMatch[0])) {
        failures.push(
          failMessage(file, "viewport meta tag must not disable user zoom", viewportMatch.index),
        );
      }
    }

    if (!styleExtensions.has(file.extension)) continue;

    const deviceMediaPattern = /@media\s*\([^)]*\bdevice-(?:height|width)\b[^)]*\)/giu;
    for (const match of content.matchAll(deviceMediaPattern)) {
      failures.push(
        failMessage(
          file,
          "responsive breakpoints must use content/viewport needs rather than physical device dimensions",
          match.index ?? 0,
        ),
      );
    }

    const hiddenOverflowPattern =
      /(?:^|[}\n])\s*(?:html|body|main|#root|#app)\b[^{]*\{[^}]*\boverflow-x\s*:\s*hidden\b/giu;
    for (const match of content.matchAll(hiddenOverflowPattern)) {
      failures.push(
        failMessage(
          file,
          "root horizontal overflow must be fixed at its owner rather than hidden across viewports",
          match.index ?? 0,
        ),
      );
    }

    const fixedViewportHeightPattern =
      /(?:^|[}\n])\s*(?:body|main|#root|#app|\.app|\.page|\.shell)\b[^{]*\{[^}]*\bheight\s*:\s*100vh\b/giu;
    for (const match of content.matchAll(fixedViewportHeightPattern)) {
      failures.push(
        failMessage(
          file,
          "full-height roots must account for dynamic mobile browser and virtual-keyboard viewports instead of fixed 100vh",
          match.index ?? 0,
        ),
      );
    }

    const layoutWidthPattern =
      /(?:^|[}\n])\s*(?:body|main|#root|#app|\.app|\.page|\.layout|\.container|\.content|\.shell)\b[^{]*\{[^}]*\b(?:width|min-width)\s*:\s*(\d{3,})px/gi;
    for (const match of content.matchAll(layoutWidthPattern)) {
      const width = Number.parseInt(match[1], 10);
      if (Number.isFinite(width) && width > 480) {
        failures.push(
          failMessage(
            file,
            `layout root uses fixed ${width}px width; use responsive constraints instead`,
            match.index ?? 0,
          ),
        );
      }
    }

    const mediaPattern =
      /<(?:img|video|canvas|iframe)\b(?![^>]*\b(?:width|height|style|className|class)=)[^>]*>/gi;
    for (const match of content.matchAll(mediaPattern)) {
      failures.push(
        failMessage(
          file,
          "media elements need responsive sizing through dimensions, class, or style constraints",
          match.index ?? 0,
        ),
      );
    }

    const undersizedTargetPattern =
      /(?:^|[}\n])\s*(?:button|a(?:\[[^\]]+\])?|input\[(?:type=["']?(?:button|checkbox|radio|submit)["']?)\]|\.[A-Za-z0-9_-]*(?:button|control|icon-btn|tap-target)[A-Za-z0-9_-]*)\b[^{]*\{[^}]*(?:\bheight|\bmin-height)\s*:\s*(\d{1,2})px/giu;
    for (const match of content.matchAll(undersizedTargetPattern)) {
      const size = Number.parseInt(match[1], 10);
      if (Number.isFinite(size) && size < 40) {
        failures.push(
          failMessage(
            file,
            `interactive target declares only ${size}px height; provide a touch-usable target across mobile, tablet, and desktop`,
            match.index ?? 0,
          ),
        );
      }
    }
  }

  return failures;
}

export function runResponsive(summary = webSurfaceSummary()) {
  const failures = responsiveFailures(summary);
  reportResult(
    "Responsive verification",
    failures,
    summary.hasWebSurface ? undefined : "Responsive verification skipped; no web surface detected.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runResponsive();
}
