/** Owns api security behavior for the repository verification boundary. */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  discoverProductLayout,
  isProductImplementationPath,
} from "../repository/product-roots.mjs";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";
import { executableSource } from "./source-evidence.mjs";

const sourceExtensions = new Set([
  ".cjs",
  ".cs",
  ".cts",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".ts",
  ".tsx",
]);

const apiPathPattern = /(?:^|\/)(?:api|apis|controllers?|endpoints?|handlers?|routes?)(?:\/|$)/i;
const apiContentPatterns = [
  /\b(?:app|router|server)\.(?:get|post|put|patch|delete|options|head)\s*\(/,
  /\b(?:fastify|hono)\.(?:get|post|put|patch|delete|route)\s*\(/,
  /\bexport\s+async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/,
  /@\w*route\s*\(|@(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/,
  /@(?:RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\b/,
  /\b(?:http\.HandleFunc|HandleFunc|ServeHTTP)\b/,
  /\bRouter::new\(\)|\.route\s*\(/,
  /\b(?:get|post|put|patch|delete)\s+["'][^"']+["']\s+do\b/,
];

const authenticationEvidencePatterns = Object.freeze([
  /\b(?:authenticate|requireAuth|requireAuthentication|requireUser|validateBearer|validateCredential|validateSession|validateToken|verifyJwt|verifyOidc|verifySignedRequest|verifyWorkloadIdentity)\s*\(/iu,
  /@(?:Authenticated|AuthenticationPrincipal|RequireAuth|UseGuards)\b/iu,
  /\b(?:beforeHandle|middleware|onRequest|preHandler)\s*:\s*(?:\[[^\]]{0,240})?\s*(?:authenticate|requireAuth|requireUser|validateSession|verifyToken)\b/iu,
]);
const authorizationEvidencePatterns = Object.freeze([
  /\b(?:assertAuthorized|authorize|canAccess|checkEntitlement|checkPermission|enforcePolicy|hasPermission|requirePermission|verifyOwnership)\s*\(/iu,
  /@(?:Authorize|PreAuthorize|RequirePermission|RolesAllowed|Secured)\b/iu,
  /\b(?:authorization|permission|policy)\s*:\s*(?:\[[^\]]{0,240})?\s*(?:authorize|check|enforce|guard|require|verify)\b/iu,
]);
const explicitAnonymousPolicyPatterns = Object.freeze([
  /\ballowAnonymous\s*\(/iu,
  /@(?:AllowAnonymous|PermitAll|PublicEndpoint)\b/iu,
  /\b(?:accessPolicy|auth)\s*:\s*(?:false|allowAnonymous)\b/iu,
]);
const absentSecurityPattern =
  /\b(?:(?:no|without|missing|lacks?)\s+(?:auth|authentication|authorization)|(?:auth|authentication|authorization)\s+(?:is\s+)?(?:absent|disabled|omitted|bypassed|not\s+required|intentionally\s+absent)|unauthenticated)\b/i;
const publicApiPattern =
  /\b(?:public api|public-api|external api|external-api|internet-facing|anonymous|unauthenticated|guest access|no auth|noauth)\b/i;
const rateLimitEvidencePatterns = Object.freeze([
  /\b(?:applyQuota|enforceQuota|rateLimit|throttle)\s*\(/iu,
  /@(?:RateLimit|Throttle)\b/iu,
  /\b(?:rateLimit|rate_limit|throttle|quota)\s*:\s*(?:\{|\[|\d|[A-Za-z_$][\w$]*\b)/iu,
  /\.status\s*\(\s*429\s*\)|\bRetry-After\b\s*:/iu,
]);

function isProductSource(relativePath, productLayout) {
  const basename = path.posix.basename(relativePath);
  return (
    sourceExtensions.has(path.posix.extname(relativePath).toLowerCase()) &&
    isProductImplementationPath(relativePath, productLayout) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(basename)
  );
}

export function isApiSource(file) {
  if (apiPathPattern.test(file.relativePath)) return true;
  return apiContentPatterns.some((pattern) => pattern.test(file.content));
}

export function apiSecurityFindings(file) {
  const findings = [];
  const executable = executableSource(file.content);
  const explicitlyAbsent = absentSecurityPattern.test(file.content);
  const explicitAnonymousPolicy = explicitAnonymousPolicyPatterns.some((pattern) =>
    pattern.test(executable),
  );
  const hasAuthenticationBoundary =
    !explicitlyAbsent &&
    (authenticationEvidencePatterns.some((pattern) => pattern.test(executable)) ||
      explicitAnonymousPolicy);
  const hasAuthorizationBoundary =
    !explicitlyAbsent &&
    (authorizationEvidencePatterns.some((pattern) => pattern.test(executable)) ||
      explicitAnonymousPolicy);
  if (explicitlyAbsent) {
    findings.push(
      `${file.relativePath}: explicitly absent, disabled, or bypassed authentication/authorization requires security review; the static boundary heuristic cannot accept positive keywords elsewhere`,
    );
  }
  if (!hasAuthenticationBoundary) {
    findings.push(
      `${file.relativePath}: API handlers need authentication evidence, workload/service identity, or an explicit anonymous-access policy`,
    );
  }
  if (!hasAuthorizationBoundary) {
    findings.push(
      `${file.relativePath}: API handlers need a separate server-side authorization/policy decision for the requested action and resource`,
    );
  }

  if (
    (publicApiPattern.test(file.content) || explicitAnonymousPolicy) &&
    !rateLimitEvidencePatterns.some((pattern) => pattern.test(executable))
  ) {
    findings.push(
      `${file.relativePath}: public API handlers need rate-limit evidence such as throttling, quota, 429, or Retry-After handling`,
    );
  }
  return findings;
}

export function readApiFiles({ root = repositoryRoot, files, productLayout } = {}) {
  const inventory = files ?? listActiveFiles({ root });
  const layout =
    productLayout ?? discoverProductLayout({ repositoryRoot: root, relativePaths: inventory });
  return inventory
    .filter((relativePath) => isProductSource(relativePath, layout))
    .map((relativePath) => ({
      fullPath: path.join(root, relativePath),
      relativePath,
      content: readFileSync(path.join(root, relativePath), "utf8"),
    }))
    .filter(isApiSource);
}

function main() {
  const apiFiles = readApiFiles();
  const failures = apiFiles.flatMap(apiSecurityFindings);

  if (failures.length > 0) {
    console.error("API static boundary heuristic failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  if (apiFiles.length === 0) {
    console.log("API static boundary heuristic skipped; no API-like source files detected.");
  } else {
    console.log(`API static boundary heuristic passed (${apiFiles.length} API-like file(s)).`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
