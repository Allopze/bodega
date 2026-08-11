/** Canonical, closed origin used by the legacy FacturaEnLínea portal. */

export const DTE_PORTAL_BASE_URL = "https://clientes.dtefacturaenlinea.cl/facturaenlinea"

const DTE_PORTAL_HOST = "clientes.dtefacturaenlinea.cl"
const DTE_PORTAL_PATH = "/facturaenlinea"

export class DtePortalOriginError extends Error {
  constructor(readonly code: "DTE_PORTAL_ORIGIN_INVALID" | "DTE_PORTAL_RESOURCE_INVALID") {
    super(code)
    this.name = "DtePortalOriginError"
  }
}

/**
 * The portal is deliberately not configurable at runtime. We accept one
 * legacy spelling with a trailing slash solely so a compatible release can
 * start, then normalize it to the one canonical origin.
 */
export function assertDtePortalBaseUrl(value: string | undefined): string {
  if (!value?.trim()) return DTE_PORTAL_BASE_URL
  const raw = value.trim()
  const url = parseUrl(raw, "DTE_PORTAL_ORIGIN_INVALID")
  if (
    hasExplicitPortOrCredentials(raw) ||
    url.protocol !== "https:" ||
    url.hostname !== DTE_PORTAL_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== DTE_PORTAL_PATH && url.pathname !== `${DTE_PORTAL_PATH}/`) ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new DtePortalOriginError("DTE_PORTAL_ORIGIN_INVALID")
  }
  return DTE_PORTAL_BASE_URL
}

/**
 * Resolves a portal endpoint, XML or PDF link without allowing the scraped
 * HTML to redirect this server toward another origin or path tree.
 */
export function resolveDtePortalResourceUrl(value: string, baseUrl = DTE_PORTAL_BASE_URL): string {
  assertDtePortalBaseUrl(baseUrl)
  const raw = value.trim()
  if (!raw || raw !== value || raw.startsWith("//") || raw.includes("\\")) {
    throw new DtePortalOriginError("DTE_PORTAL_RESOURCE_INVALID")
  }

  const rawPath = raw.split(/[?#]/, 1)[0] ?? ""
  if (containsTraversal(rawPath)) {
    throw new DtePortalOriginError("DTE_PORTAL_RESOURCE_INVALID")
  }

  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw)
  const url = absolute
    ? parseUrl(raw, "DTE_PORTAL_RESOURCE_INVALID")
    : parseUrl(raw, "DTE_PORTAL_RESOURCE_INVALID", `${DTE_PORTAL_BASE_URL}/`)
  if (
    (absolute && hasExplicitPortOrCredentials(raw)) ||
    url.protocol !== "https:" ||
    url.hostname !== DTE_PORTAL_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== DTE_PORTAL_PATH && !url.pathname.startsWith(`${DTE_PORTAL_PATH}/`))
  ) {
    throw new DtePortalOriginError("DTE_PORTAL_RESOURCE_INVALID")
  }

  return url.toString()
}

function parseUrl(raw: string, code: DtePortalOriginError["code"], base?: string): URL {
  try {
    return base ? new URL(raw, base) : new URL(raw)
  } catch {
    throw new DtePortalOriginError(code)
  }
}

/** URL normalizes :443 away, therefore inspect the original authority too. */
function hasExplicitPortOrCredentials(raw: string): boolean {
  const authority = raw.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1]
  return !authority || authority.includes("@") || authority !== DTE_PORTAL_HOST
}

function containsTraversal(rawPath: string): boolean {
  let candidate = rawPath
  // A legacy server may decode a path more than once. Inspect a few decoded
  // representations so `%252e%252e` cannot become a traversal after this
  // boundary has approved it. Invalid escaping is also not a valid resource.
  for (let pass = 0; pass < 3; pass++) {
    if (/(^|\/)\.{1,2}(?:\/|$)/.test(candidate) || /%(?:2e|2f|5c)/i.test(candidate)) {
      return true
    }
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return true
    }
  }
  return /(^|\/)\.{1,2}(?:\/|$)/.test(candidate) || /%(?:2e|2f|5c)/i.test(candidate)
}
