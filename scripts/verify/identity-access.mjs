/** Owns identity access behavior for the repository verification boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalArchitectureSegment,
  discoverProductLayout,
  isProductImplementationPath,
} from "../repository/product-roots.mjs";
import {
  createLocalImportResolver,
  importSpecifiersForFile,
} from "../repository/local-import-resolution.mjs";
import {
  architecturalSourceExtensions,
  embeddedScriptSourceExtensions,
} from "../repository/source-import-specifiers.mjs";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";
import { executableSource } from "./source-evidence.mjs";

const sourceExtensions = new Set([
  ...architecturalSourceExtensions,
  ...embeddedScriptSourceExtensions,
]);
const identityBoundaryNames = new Set([
  "access-control",
  "access_control",
  "auth",
  "authentication",
  "authorization",
  "iam",
  "identity",
  "identity-access",
  "identity_access",
]);
const umbrellaBoundaryNames = new Set([
  "auth",
  "iam",
  "identity",
  "identity-access",
  "identity_access",
]);
const moduleWrapperNames = new Set(["capabilities", "domains", "features", "modules"]);
const publicBoundaryNames = new Set([
  "client",
  "clients",
  "contract",
  "contracts",
  "index",
  "port",
  "ports",
  "public",
]);
const identityConcernNames = new Set([
  "accounts",
  "adapters",
  "application",
  "audit",
  "authentication",
  "authenticators",
  "authorization",
  "authn",
  "authz",
  "commands",
  "composition",
  "contracts",
  "credentials",
  "events",
  "grants",
  "identities",
  "lifecycle",
  "mfa",
  "passkeys",
  "permissions",
  "persistence",
  "policies",
  "policy",
  "ports",
  "profiles",
  "providers",
  "public",
  "queries",
  "repositories",
  "roles",
  "sessions",
  "tokens",
  "use-cases",
  "users",
]);
const providerAdapterNames = new Set(["adapter", "adapters", "provider", "providers"]);
const authenticationMechanismNames = new Set([
  "authentication",
  "authenticators",
  "authn",
  "credentials",
  "mfa",
  "passkeys",
]);
const sessionMechanismNames = new Set([
  "adapter",
  "adapters",
  "provider",
  "providers",
  "sessions",
  "tokens",
]);
const testFilePattern = /(?:^|\/)(?:[^/]+\.)?(?:source\.)?(?:spec|test)\.[^/]+$/iu;
const directIdentityFilePattern =
  /^(?:access[-_]control|auth|authentication|authorization|iam|identity|identity[-_]access|permissions?|roles?|sessions?|tokens?|user[-_]management)$/iu;
const knownIdentityProviderPattern =
  /^(?:@auth0\/|auth0(?:\/|$)|@auth\/core(?:\/|$)|@clerk\/|clerk(?:\/|$)|@descope\/|@okta\/|okta(?:\/|$)|@stytch\/|stytch(?:\/|$)|@supertokens\/|supertokens(?:\/|$)|@workos-inc\/|@azure\/msal|@aws-sdk\/client-cognito-identity-provider|amazon-cognito|better-auth(?:\/|$)|firebase\/auth$|firebase-admin\/auth$|fusionauth(?:\/|$)|keycloak(?:-|\/|$)|lucia(?:\/|$)|next-auth(?:\/|$)|oidc-client(?:-|\/|$)|openid-client(?:\/|$)|passport(?:-|\/|$))/iu;
const credentialMechanismPattern =
  /^(?:@node-rs\/argon2|argon2|bcrypt|bcryptjs|otplib|speakeasy|@simplewebauthn\/)/iu;
const sessionMechanismPattern = /^(?:iron-session|jose|jsonwebtoken)(?:\/|$)/iu;
const sensitiveIdentityLogPattern =
  /\b(?:console|log(?:ger)?)\.(?:debug|error|info|log|trace|warn)\s*\([^\n)]*\b(?:accessToken|access_token|authorizationHeader|authorization_header|credentialSecret|credential_secret|idToken|id_token|password(?:Hash)?|password_hash|refreshToken|refresh_token|sessionSecret|session_secret|sessionToken|session_token)\b/iu;
const identityImplementationPatterns = Object.freeze([
  /\b(?:async\s+)?(?:def|fn|func|function|fun)\s+(?:authenticate|authorize|checkPassword|createSession|enforcePermission|hasPermission|issueToken|login|requirePermission|rotateToken|signIn|validateSession|validateToken|verifyCredential|verifyMfa|verifyPassword|verifyPermission|verifyRole|verifyToken|verifyWebAuthn)\b/iu,
  /(?<![.\w])(?:async\s+)?(?:authenticate|authorize|checkPassword|createSession|enforcePermission|hasPermission|issueToken|login|requirePermission|rotateToken|signIn|validateSession|validateToken|verifyCredential|verifyMfa|verifyPassword|verifyPermission|verifyRole|verifyToken|verifyWebAuthn)\s*\([^;{}]{0,500}\)\s*(?:=>|\{|throws\b)/iu,
  /\b(?:crypto\.subtle\.verify|passwordHasher\.(?:compare|verify)|verifyPasswordHash)\s*\([^;]{0,500}\b(?:credential|password|passwordHash|password_hash)\b/iu,
  /\b(?:return|if)\b[^;{}]{0,500}\b(?:permission|role)\w*\b[^;{}]{0,500}(?:===?|==|\.contains\s*\(|\.has\s*\(|\bin\b)/iu,
  /\b(?:navigator\.credentials|PublicKeyCredential|WebAuthn|webauthn)\b[^;{}]{0,700}\b(?:authenticate|create|get|verify)\b/iu,
]);

function ownsIdentityImplementation(descriptor) {
  return descriptor !== null;
}

function productRootFor(relativePath, productLayout) {
  return [...productLayout.sourceRoots]
    .sort((left, right) => right.length - left.length)
    .find((sourceRoot) => relativePath === sourceRoot || relativePath.startsWith(`${sourceRoot}/`));
}

function boundaryDescriptor(relativePath, productLayout) {
  const sourceRoot = productRootFor(relativePath, productLayout);
  if (!sourceRoot) return null;
  const tail = relativePath.slice(sourceRoot.length).replace(/^\//u, "").split("/");
  if (tail.length === 0) return null;
  let boundaryIndex = 0;
  if (moduleWrapperNames.has(canonicalArchitectureSegment(tail[0]))) boundaryIndex = 1;
  const boundaryName = canonicalArchitectureSegment(tail[boundaryIndex]);
  if (!identityBoundaryNames.has(boundaryName)) return null;
  return {
    boundaryIndex,
    boundaryName,
    remainder: tail.slice(boundaryIndex + 1),
    sourceRoot,
    tail,
  };
}

function targetUsesPublicIdentityContract(targetDescriptor) {
  if (!targetDescriptor) return true;
  const [first] = targetDescriptor.remainder;
  if (!first) return false;
  const basename = path.posix.basename(first, path.posix.extname(first));
  return (
    publicBoundaryNames.has(canonicalArchitectureSegment(first)) ||
    publicBoundaryNames.has(canonicalArchitectureSegment(basename))
  );
}

function directorySegments(descriptor) {
  return descriptor.remainder.slice(0, -1);
}

function hasDirectory(descriptor, allowed) {
  return [descriptor.boundaryName, ...directorySegments(descriptor)].some((segment) =>
    allowed.has(canonicalArchitectureSegment(segment)),
  );
}

function boundaryLayoutFindings(file, descriptor) {
  if (!descriptor || !umbrellaBoundaryNames.has(descriptor.boundaryName)) return [];
  const directories = directorySegments(descriptor);
  if (
    directories.length > 0 &&
    identityConcernNames.has(canonicalArchitectureSegment(directories[0]))
  ) {
    return [];
  }
  const filename = descriptor.remainder.at(-1) ?? "";
  const basename = path.posix.basename(filename, path.posix.extname(filename));
  if (directories.length === 0 && publicBoundaryNames.has(canonicalArchitectureSegment(basename))) {
    return [];
  }
  return [
    `${file.relativePath}: umbrella Identity and Access roots must put implementation in an explicit authentication, authorization/policy, users/accounts, sessions/tokens, provider-adapter, audit, application, or public-contract subdirectory`,
  ];
}

export function identityAccessFileFindings(file, { importResolver, productLayout }) {
  const findings = [];
  const descriptor = boundaryDescriptor(file.relativePath, productLayout);
  const executable = executableSource(file.content);
  const sourceRoot = productRootFor(file.relativePath, productLayout);
  const relativeToSource = sourceRoot
    ? file.relativePath.slice(sourceRoot.length).replace(/^\//u, "")
    : file.relativePath;
  const firstRelativeFile = relativeToSource.split("/");
  if (
    (firstRelativeFile.length === 1 ||
      (firstRelativeFile.length === 2 && moduleWrapperNames.has(firstRelativeFile[0]))) &&
    directIdentityFilePattern.test(
      canonicalArchitectureSegment(
        path.posix.basename(file.relativePath, path.posix.extname(file.relativePath)),
      ),
    )
  ) {
    findings.push(
      `${file.relativePath}: Identity and Access implementation needs a dedicated directory instead of a Product Root-level mixed file`,
    );
  }

  findings.push(...boundaryLayoutFindings(file, descriptor));

  for (const specifier of importSpecifiersForFile(file)) {
    if (knownIdentityProviderPattern.test(specifier)) {
      if (!descriptor || !hasDirectory(descriptor, providerAdapterNames)) {
        findings.push(
          `${file.relativePath}: identity-provider dependency ${specifier} must stay behind a dedicated Identity and Access provider-adapter directory`,
        );
      }
      continue;
    }
    if (credentialMechanismPattern.test(specifier)) {
      if (!descriptor || !hasDirectory(descriptor, authenticationMechanismNames)) {
        findings.push(
          `${file.relativePath}: credential mechanism ${specifier} belongs only in the Identity and Access authentication/credential boundary`,
        );
      }
      continue;
    }
    if (sessionMechanismPattern.test(specifier)) {
      if (!descriptor || !hasDirectory(descriptor, sessionMechanismNames)) {
        findings.push(
          `${file.relativePath}: session/token mechanism ${specifier} belongs only in a dedicated Identity and Access session/token or provider-adapter boundary`,
        );
      }
      continue;
    }
    const resolution = importResolver?.resolve(file.relativePath, specifier) ?? {
      targets: [],
      unresolvedAlias: false,
    };
    if (resolution.unresolvedAlias) {
      findings.push(
        `${file.relativePath}: repository-local import alias ${specifier} cannot be resolved; declare its tsconfig/jsconfig path mapping before architectural verification`,
      );
      continue;
    }
    for (const target of resolution.targets) {
      const targetDescriptor = boundaryDescriptor(target, productLayout);
      if (!descriptor && targetDescriptor && !targetUsesPublicIdentityContract(targetDescriptor)) {
        findings.push(
          `${file.relativePath}: consumers outside Identity and Access may import only its public contract, port, or client boundary, not ${specifier}`,
        );
        break;
      }
    }
  }

  if (sensitiveIdentityLogPattern.test(executable)) {
    findings.push(
      `${file.relativePath}: Identity and Access code must not log credential, token, authorization-header, or session-secret values`,
    );
  }
  if (
    !ownsIdentityImplementation(descriptor) &&
    identityImplementationPatterns.some((pattern) => pattern.test(executable))
  ) {
    findings.push(
      `${file.relativePath}: sensitive authentication, authorization, credential, session/token, MFA, or identity-policy implementation must live inside the dedicated Identity and Access boundary`,
    );
  }
  return findings;
}

export function readIdentityAccessFiles({ root = repositoryRoot, files, productLayout } = {}) {
  const inventory = files ?? listActiveFiles({ root });
  const layout =
    productLayout ?? discoverProductLayout({ repositoryRoot: root, relativePaths: inventory });
  const importResolver = createLocalImportResolver({
    root,
    relativePaths: inventory,
    productLayout: layout,
  });
  return {
    files: inventory
      .filter(
        (relativePath) =>
          sourceExtensions.has(path.posix.extname(relativePath).toLowerCase()) &&
          isProductImplementationPath(relativePath, layout) &&
          !testFilePattern.test(relativePath),
      )
      .filter((relativePath) => {
        const absolutePath = path.join(root, ...relativePath.split("/"));
        return (
          existsSync(absolutePath) &&
          !lstatSync(absolutePath).isSymbolicLink() &&
          lstatSync(absolutePath).isFile()
        );
      })
      .map((relativePath) => ({
        content: readFileSync(path.join(root, ...relativePath.split("/")), "utf8"),
        relativePath,
      })),
    importResolver,
    productLayout: layout,
  };
}

export function identityAccessProjectFindings(options = {}) {
  const snapshot = readIdentityAccessFiles(options);
  return [
    ...new Set([
      ...snapshot.importResolver.findings,
      ...snapshot.files.flatMap((file) =>
        identityAccessFileFindings(file, {
          importResolver: snapshot.importResolver,
          productLayout: snapshot.productLayout,
        }),
      ),
    ]),
  ].sort();
}

function main() {
  const findings = identityAccessProjectFindings();
  if (findings.length > 0) {
    console.error("Identity and Access boundary verification failed:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Identity and Access boundaries passed (authentication, authorization, identity lifecycle, sessions/tokens, and provider adapters).",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
