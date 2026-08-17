/** Verifies terminal output behavior for the safe terminal diagnostics boundary. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatContextError,
  sanitizeCommandForTerminal,
  sanitizeMultilineForTerminal,
} from "./terminal-output.mjs";

function privateKeyBoundary(kind, phase) {
  return ["-----", phase, " ", kind, " KEY-----"].join("");
}

test("terminal output redacts unknown absolute paths with spaces through the end of the line", () => {
  const value = "failure at /tmp/private workspace/secret-name/file.txt\nnext line";
  const sanitized = sanitizeMultilineForTerminal(value, "/different/root");
  assert.equal(sanitized, "failure at <local-path>\nnext line");
  assert.equal(sanitized.includes("workspace"), false);
  assert.equal(sanitized.includes("secret-name"), false);
});

test("formatted errors redact quoted POSIX, Windows, and file URL paths containing spaces", () => {
  for (const value of [
    'failed at "/tmp/private workspace/secret-name/file.txt"',
    'failed at "C:\\private workspace\\secret-name\\file.txt"',
    'failed at "file:///tmp/private workspace/secret-name/file.txt"',
  ]) {
    const sanitized = formatContextError(value, "/different/root");
    assert.equal(sanitized.includes("private workspace"), false);
    assert.equal(sanitized.includes("secret-name"), false);
    assert.match(sanitized, /<local-path>/);
  }
});

test("path redaction handles root-prefix collisions, punctuation boundaries, and UNC paths", () => {
  const tick = String.fromCharCode(96);
  const value = [
    "collision /tmp/project-private/secret-name/file.txt",
    "colon:/tmp/private workspace/secret-name/file.txt",
    "tick " + tick + "/tmp/private workspace/secret-name/file.txt" + tick,
    "bracket [/tmp/private workspace/secret-name/file.txt]",
    "hyphen-/tmp/private workspace/secret-name/file.txt",
    "hyphen-C:\\private workspace\\secret-name\\file.txt",
    "unc \\\\server\\private workspace\\secret-name\\file.txt",
  ].join("\n");
  const sanitized = sanitizeMultilineForTerminal(value, "/tmp/project");
  assert.equal(sanitized.includes("/tmp/"), false);
  assert.equal(sanitized.includes("private workspace"), false);
  assert.equal(sanitized.includes("secret-name"), false);
  assert.equal(sanitized.includes("\\\\server"), false);
  assert.equal(sanitized.match(/<local-path>/g)?.length, 7);
});

test("known project-root paths stay useful and require left and right boundaries", () => {
  assert.equal(
    sanitizeMultilineForTerminal(
      "project /tmp/project/src/file.mjs\nother /tmp/project-other/private.txt",
      "/tmp/project",
    ),
    "project ./src/file.mjs\nother <local-path>",
  );
  assert.equal(
    sanitizeMultilineForTerminal("docs https://example.invalid/tmp/project/api", "/tmp/project"),
    "docs https://example.invalid/tmp/project/api",
  );
  assert.equal(
    sanitizeMultilineForTerminal(
      "prefix/tmp/project/secret-name.txt\nnotfile:///tmp/project/secret-name.txt",
      "/tmp/project",
    ),
    "prefix/tmp/project/secret-name.txt\nnotfile:<local-path>",
  );
});

test("unknown paths redact legal punctuation inside path segments conservatively", () => {
  for (const value of [
    "at /tmp/private[secret-name]/token.txt then continue",
    "at /tmp/private(secret-name)/token.txt then continue",
    "at C:\\private{secret-name}\\token.txt then continue",
  ]) {
    const sanitized = sanitizeMultilineForTerminal(value, "/different/root");
    assert.equal(sanitized, "at <local-path>");
    assert.equal(sanitized.includes("secret-name"), false);
  }
});

test("control sequences cannot conceal paths or rewrite terminal lines", () => {
  for (const value of [
    "failure at \u001b[31m/tmp/private workspace/secret-name/file.txt\u001b[0m",
    "failure at \u202e/tmp/private workspace/secret-name/file.txt",
    "failure at \u001b[31mC:\\private workspace\\secret-name\\file.txt\u001b[0m",
    "failure at \u001b[31m\\\\server\\private workspace\\secret-name\\file.txt\u001b[0m",
    "prefix\u001b[0m/tmp/private workspace/secret-name/file.txt",
    "prefix\u202e/tmp/private workspace/secret-name/file.txt",
    "prefix\u001b[0mC:\\private workspace\\secret-name\\file.txt",
  ]) {
    const sanitized = sanitizeMultilineForTerminal(value, "/different/root");
    assert.equal(sanitized.includes("secret-name"), false);
    assert.match(sanitized, /<local-path>/);

    const formatted = formatContextError(value, "/different/root");
    assert.equal(formatted.includes("secret-name"), false);
    assert.match(formatted, /<local-path>/);
  }

  assert.equal(
    sanitizeMultilineForTerminal("visible\r\nhidden\rlast", "/different/root"),
    "visible\nhidden\nlast",
  );
});

test("context output redacts recognized secrets after removing control sequences", () => {
  const openAiToken = `sk-${"z".repeat(32)}`;
  const githubToken = `ghp_${"a".repeat(36)}`;
  const gitlabToken = `glpat-${"g".repeat(20)}`;
  const value = [
    `native failure token=${openAiToken}`,
    `split control token=sk-${"y".repeat(10)}\u001b[31m${"y".repeat(22)}`,
    `github=${githubToken}`,
    `gitlab=${gitlabToken}`,
  ].join("\n");
  const sanitized = sanitizeMultilineForTerminal(value, "/different/root");

  assert.equal(sanitized.includes(openAiToken), false);
  assert.equal(sanitized.includes(githubToken), false);
  assert.equal(sanitized.includes(gitlabToken), false);
  assert.equal(sanitized.includes("sk-"), false);
  assert.equal(sanitized.includes("ghp_"), false);
  assert.equal(sanitized.includes("glpat-"), false);
  assert.equal(sanitized.match(/<redacted-secret>/g)?.length, 4);
});

test("terminal diagnostics redact opaque named credentials and authorization headers", () => {
  const sanitized = sanitizeMultilineForTerminal(
    [
      ["DATABASE_PASSWORD=correct-horse", "-battery-staple trailing"].join(""),
      "Authorization: Bearer opaque-access-token",
      "Proxy-Authorization: Basic opaque-basic-value",
      "Cookie: session=opaque-cookie; theme=dark",
      "Set-Cookie: session=opaque-response-cookie; Secure",
      "--api-key=opaque\u001b[31m-split-value trailing",
      "clientSecret=opaque-client-secret",
      "sessionToken=opaque-session-token",
      "credentialSecret=opaque-credential-secret",
      "databasePassword=opaque-database-password",
      "passwordHash=opaque-password-hash",
      "secretAccessKey=opaque-secret-access-key",
      "Authori\u001b[31mzation: Bearer opaque-split-header",
      "client_se\u001b[31mcret=opaque-split-client-secret",
      "DATABASE_PASS\u001b[0mWORD=opaque-split-database-password",
      "status\u001b[0mtoken=opaque-status-token",
      "log:\u001b[0mtoken=opaque-log-token",
      "prefix\u202etoken=opaque-format-token",
      "(ctx)\u001b[0mAuthorization: Bearer opaque-prefixed-header",
      "log:token=opaque-nested-token",
      "outer=public:token=opaque-after-value",
      "[public]token=opaque-bracket-token",
      "(public)token=opaque-paren-token",
      "[token]: opaque-bracket-label",
      "password hash: opaque-spaced-label",
      "client credential value: opaque-credential-value",
      'details {"refresh_token":"opaque-json-value","safe":"hidden with line"}',
      "ordinary=value remains visible",
    ].join("\n"),
    "/different/root",
  );

  for (const secret of [
    "correct-horse",
    "opaque-access",
    "opaque-basic",
    "opaque-cookie",
    "opaque-response-cookie",
    "opaque -split-value",
    "opaque-json-value",
    "opaque-client-secret",
    "opaque-session-token",
    "opaque-credential-secret",
    "opaque-database-password",
    "opaque-password-hash",
    "opaque-secret-access-key",
    "opaque-split-header",
    "opaque-split-client-secret",
    "opaque-split-database-password",
    "opaque-status-token",
    "opaque-log-token",
    "opaque-format-token",
    "opaque-prefixed-header",
    "opaque-nested-token",
    "opaque-after-value",
    "opaque-bracket-token",
    "opaque-paren-token",
    "opaque-bracket-label",
    "opaque-spaced-label",
    "opaque-credential-value",
  ]) {
    assert.equal(sanitized.includes(secret), false);
  }
  assert.match(sanitized, /DATABASE_PASSWORD=<redacted-secret>/u);
  assert.match(sanitized, /Authorization:<redacted-secret>/u);
  assert.match(sanitized, /Cookie:<redacted-secret>/u);
  assert.match(sanitized, /--api-key=<redacted-secret>/u);
  assert.match(sanitized, /ordinary=value remains visible/u);
});

test("credential diagnostics fail closed across a line boundary", () => {
  const sanitized = sanitizeMultilineForTerminal(
    [
      "Authorization:",
      " Bearer opaque-folded-header",
      " opaque-folded-header-part-two",
      "token=",
      "opaque-next-line-token",
      "opaque-next-line-token-part-two",
      "ordinary=value remains visible",
    ].join("\n"),
    "/different/root",
  );
  assert.equal(sanitized.includes("opaque-folded-header"), false);
  assert.equal(sanitized.includes("opaque-next-line-token"), false);
  assert.equal(
    sanitized,
    [
      "Authorization:<redacted-secret>",
      " <redacted-secret>",
      " <redacted-secret>",
      "token=<redacted-secret>",
      "<redacted-secret>",
      "<redacted-secret>",
      "ordinary=value remains visible",
    ].join("\n"),
  );
});

test("terminal diagnostics redact complete and truncated multiline credential bodies", () => {
  const sanitized = sanitizeMultilineForTerminal(
    [
      "key follows",
      privateKeyBoundary("PRIVATE", "BEGIN"),
      "opaque-pem-body-one",
      "opaque-pem-body-two",
      privateKeyBoundary("PRIVATE", "END"),
      "private_key: |",
      "  opaque-yaml-body",
      "ordinary=value remains visible",
      'token = """',
      "opaque-toml-body",
      '"""',
      privateKeyBoundary("OPENSSH PRIVATE", "BEGIN"),
      "opaque-truncated-pem-body",
    ].join("\n"),
    "/different/root",
  );

  for (const secret of [
    "opaque-pem-body",
    "opaque-yaml-body",
    "opaque-toml-body",
    "opaque-truncated-pem-body",
    ["END", "PRIVATE", "KEY"].join(" "),
  ]) {
    assert.equal(sanitized.includes(secret), false);
  }
  assert.match(sanitized, /ordinary=value remains visible/u);
  assert.ok((sanitized.match(/<redacted-secret>/gu)?.length ?? 0) >= 6);
});

test("control sequences cannot split sensitive URL parameter names", () => {
  const sanitized = sanitizeMultilineForTerminal(
    [
      "token https://example.invalid/?access_to\u001b[31mken=opaque-url-token&view=public",
      "signature https://example.invalid/?signa\u001b[0mture=opaque-url-signature",
      "boundary https://example.invalid/?status\u001b[0mtoken=opaque-prefixed-url-token",
    ].join("\n"),
    "/different/root",
  );
  assert.equal(sanitized.includes("opaque-url-token"), false);
  assert.equal(sanitized.includes("opaque-url-signature"), false);
  assert.equal(sanitized.includes("opaque-prefixed-url-token"), false);
  assert.equal(
    sanitized,
    "token <redacted-url>\nsignature <redacted-url>\nboundary <redacted-url>",
  );
});

test("printed command arguments redact values owned by long sensitive options", () => {
  const sanitized = sanitizeCommandForTerminal(
    "node",
    [
      "deploy.mjs",
      "--token",
      "opaque-cli-token",
      "--client-secret",
      "opaque-client-secret",
      "--target",
      "dev",
      "--to\u001b[31mken",
      "opaque-control-cli-secret",
      "--client\u202e-secret",
      "opaque-format-cli-secret",
      "--pass\u0000word",
      "opaque-null-cli-secret",
    ],
    "/different/root",
  );
  assert.equal(sanitized.includes("opaque-cli-token"), false);
  assert.equal(sanitized.includes("opaque-client-secret"), false);
  assert.equal(sanitized.includes("opaque-control-cli-secret"), false);
  assert.equal(sanitized.includes("opaque-format-cli-secret"), false);
  assert.equal(sanitized.includes("opaque-null-cli-secret"), false);
  assert.match(sanitized, /--target dev/u);
  assert.equal(sanitized.match(/<redacted-secret>/gu)?.length, 5);
});

test("web diagnostics remove URL credentials and redact sensitive query values", () => {
  const value = [
    "userinfo https://alice:plainpass@example.invalid/model",
    "signed https://storage.example.invalid/object?X-Amz-Credential=opaque-user&X-Amz-Signature=opaque-signature&part=2",
    "oauth https://api.example.invalid/callback?access_token=opaque-access&code=opaque-code&view=compact",
  ].join("\n");
  const sanitized = sanitizeMultilineForTerminal(value, "/different/root");

  for (const secret of [
    "alice",
    "plainpass",
    "opaque-user",
    "opaque-signature",
    "opaque-access",
    "opaque-code",
  ]) {
    assert.equal(sanitized.includes(secret), false);
  }
  assert.match(sanitized, /https:\/\/example\.invalid\/model/u);
  assert.match(sanitized, /X-Amz-Credential=%3Credacted-secret%3E/u);
  assert.match(sanitized, /X-Amz-Signature=%3Credacted-secret%3E/u);
  assert.match(sanitized, /access_token=%3Credacted-secret%3E/u);
  assert.match(sanitized, /code=%3Credacted-secret%3E/u);
  assert.match(sanitized, /part=2/u);
  assert.match(sanitized, /view=compact/u);
});

test("web diagnostics redact Azure SAS signatures and OAuth fragment credentials", () => {
  const value = [
    "azure https://storage.example.invalid/blob?sv=2025-01-05&sp=r&sig=opaque-sas-secret",
    "oauth https://app.example.invalid/callback#access_token=opaque-fragment-token&state=public-state",
    "spa https://app.example.invalid/#/callback?id_token=opaque-id-token&view=compact",
    "anchor https://docs.example.invalid/guide#safe-anchor",
  ].join("\n");
  const sanitized = sanitizeMultilineForTerminal(value, "/different/root");

  for (const secret of ["opaque-sas-secret", "opaque-fragment-token", "opaque-id-token"]) {
    assert.equal(sanitized.includes(secret), false);
  }
  assert.match(sanitized, /sig=%3Credacted-secret%3E/u);
  assert.match(sanitized, /#access_token=%3Credacted-secret%3E&state=public-state/u);
  assert.match(sanitized, /#\/callback\?id_token=%3Credacted-secret%3E&view=compact/u);
  assert.match(sanitized, /#safe-anchor/u);
});

test("malformed URL-like diagnostics never preserve credentials behind failed parsing", () => {
  const sanitized = sanitizeMultilineForTerminal(
    [
      "userinfo https://alice:plainpass@example.invalid:bad/path",
      "query https://example.invalid:bad/path?access_token=opaque-malformed-token",
    ].join("\n"),
    "/different/root",
  );

  assert.equal(sanitized, "userinfo <redacted-url>\nquery <redacted-url>");
  assert.equal(sanitized.includes("plainpass"), false);
  assert.equal(sanitized.includes("opaque-malformed-token"), false);
});

test("URL diagnostics fail closed when raw whitespace makes credential boundaries ambiguous", () => {
  const sanitized = sanitizeMultilineForTerminal(
    [
      "userinfo https://alice:plain pass@example.invalid/path trailing diagnostics",
      "query https://example.invalid/callback?access_token=opaque token-suffix trailing diagnostics",
      "tab https://alice:plain\tpass@example.invalid/path trailing diagnostics",
      "next line remains visible",
    ].join("\n"),
    "/different/root",
  );

  assert.equal(
    sanitized,
    [
      "userinfo <redacted-url>",
      "query https://example.invalid/callback?access_token=%3Credacted-secret%3E",
      "tab <redacted-url>",
      "next line remains visible",
    ].join("\n"),
  );
  for (const secret of ["plain", "pass@example", "opaque", "token-suffix"]) {
    assert.equal(sanitized.includes(secret), false);
  }
});
