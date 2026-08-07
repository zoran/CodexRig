export class PlatformApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PlatformApiError";
    this.status = status;
  }
}

const maximumResponseBytes = 1024 * 1024;
const maximumPages = 100;
const pageSize = 100;

function requestIdentity(url, { method, provider, token }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new PlatformApiError("Platform API request URL is invalid.", 0);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !["github", "gitlab"].includes(provider) ||
    !["DELETE", "GET", "PATCH", "POST", "PUT"].includes(method) ||
    typeof token !== "string" ||
    !token ||
    token.length > 16_384 ||
    /[\0\r\n]/u.test(token)
  ) {
    throw new PlatformApiError("Platform API request identity is invalid.", 0);
  }
  return parsed.href;
}

async function boundedResponseText(response, provider) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    let text;
    try {
      text = await response.text();
    } catch {
      throw new PlatformApiError(`${provider} API response could not be read.`, response.status);
    }
    if (Buffer.byteLength(text, "utf8") > maximumResponseBytes) {
      throw new PlatformApiError(
        `${provider} API response exceeded the size limit.`,
        response.status,
      );
    }
    return text;
  }
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      bytes += chunk.length;
      if (bytes > maximumResponseBytes) {
        await reader.cancel().catch(() => {});
        throw new PlatformApiError(
          `${provider} API response exceeded the size limit.`,
          response.status,
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof PlatformApiError) throw error;
    throw new PlatformApiError(`${provider} API response could not be read.`, response.status);
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // A canceled provider stream may already have released its lock.
    }
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export async function platformApiRequest(
  fetchImpl,
  url,
  { token, provider, method = "GET", body } = {},
) {
  const requestUrl = requestIdentity(url, { method, provider, token });
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "CodexRig-platform-configurator",
  };
  if (provider === "github") {
    headers.Authorization = `Bearer ${token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  } else {
    headers["PRIVATE-TOKEN"] = token;
  }
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PlatformApiError(`${provider} API request could not be completed.`, 0);
  }
  if (!response.ok) {
    throw new PlatformApiError(
      `${provider} API returned HTTP ${response.status}.`,
      response.status,
    );
  }
  if (response.status === 204) return null;
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
    throw new PlatformApiError(
      `${provider} API response exceeded the size limit.`,
      response.status,
    );
  }
  const text = await boundedResponseText(response, provider);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new PlatformApiError(`${provider} API returned invalid JSON.`, response.status);
  }
}

export async function paginatedPlatformApiRequest(fetchImpl, baseUrl, { token, provider } = {}) {
  const items = [];
  for (let page = 1; page <= maximumPages; page += 1) {
    const url = new URL(baseUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(pageSize));
    const result = await platformApiRequest(fetchImpl, url.href, { provider, token });
    if (!Array.isArray(result)) {
      throw new Error(`${provider} API paginated inventory is invalid.`);
    }
    if (result.length > pageSize) {
      throw new Error(`${provider} API page exceeded the requested item bound.`);
    }
    items.push(...result);
    if (result.length < pageSize) return items;
  }
  throw new Error(`${provider} API pagination exceeded ${maximumPages} pages.`);
}

export function providerApiBase(contract, provider, hostname) {
  const value = contract.platform.apiBaseUrls?.[provider]?.[hostname];
  if (typeof value !== "string" || !value) {
    throw new Error("Detected Git platform has no owned API base URL in the framework contract.");
  }
  return value;
}
