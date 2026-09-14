import { isIP } from "node:net"

/**
 * Valor centinela cuando el origen no se puede establecer con confianza. Se
 * exporta porque la auditoría (HALLAZGO AUD-001) necesita distinguirlo de una
 * IP real: en la bitácora "unresolved" sería una mentira con forma de dato, y
 * se guarda `null`.
 */
export const UNRESOLVED_RATE_LIMIT_IP = "unresolved"
const CLOUDFLARE_CROSS_ZONE_WORKER_IP = "2a06:98c0:3600::103"

function isCloudflarePseudoIpv4(ipAddress: string): boolean {
  return isIP(ipAddress) === 4 && Number(ipAddress.split(".", 1)[0]) >= 240
}

/**
 * Resolve a public rate-limit identity from Cloudflare Tunnel's original
 * client-IP header. The application listens only on loopback in production,
 * so Cloudflare is the public ingress; X-Forwarded-For remains attacker input
 * and must never determine this key.
 */
export function resolveTrustedClientIp(requestHeaders: Pick<Headers, "get">): string {
  // Cloudflare strips this header from normal requests. Its presence identifies
  // a same-zone Worker subrequest, where Worker code can set x-real-ip and
  // thereby alter CF-Connecting-IP; use the shared limit rather than trust it.
  if (requestHeaders.get("x-real-ip") !== null) return UNRESOLVED_RATE_LIMIT_IP

  const cloudflareClientIp = requestHeaders.get("cf-connecting-ip")?.trim()
  if (
    !cloudflareClientIp ||
    isIP(cloudflareClientIp) === 0 ||
    cloudflareClientIp.toLowerCase() === CLOUDFLARE_CROSS_ZONE_WORKER_IP
  ) {
    return UNRESOLVED_RATE_LIMIT_IP
  }

  // Pseudo IPv4 overwrite mode substitutes CF-Connecting-IP with a Class-E
  // value while preserving the real IPv6 in this header. That companion header
  // is not part of the identity unless the primary header proves this mode.
  const cloudflareClientIpv6 = requestHeaders.get("cf-connecting-ipv6")?.trim()
  if (isCloudflarePseudoIpv4(cloudflareClientIp)) {
    return cloudflareClientIpv6 && isIP(cloudflareClientIpv6) === 6
      ? cloudflareClientIpv6
      : UNRESOLVED_RATE_LIMIT_IP
  }

  return cloudflareClientIp
}
