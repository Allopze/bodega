/**
 * Allowlist de hosts para evidencia TAE servida como URL externa (CO-040).
 *
 * Antes la única validación era el protocolo (http/https): cualquier host
 * pasaba, así que una URL maliciosa importada como "evidencia histórica"
 * convertía el endpoint en un redirect abierto. No hay ningún proveedor
 * externo real en uso — la plataforma es su propio origen de evidencia —
 * así que la lista es, en la práctica, el dominio de producción más el host
 * configurado en `APP_URL` (cubre dev/staging sin mantener dos listas).
 */
import { env } from "@/lib/env"

const KNOWN_HOSTS = ["plataforma.portalchome.cl"] as const

function appUrlHost(): string | null {
  if (!env.appUrl) return null
  try { return new URL(env.appUrl).hostname }
  catch { return null }
}

export function allowedTaeEvidenceHosts(): readonly string[] {
  const configured = appUrlHost()
  return configured && !KNOWN_HOSTS.includes(configured as (typeof KNOWN_HOSTS)[number])
    ? [...KNOWN_HOSTS, configured]
    : KNOWN_HOSTS
}

export function isAllowedTaeEvidenceHost(url: URL): boolean {
  return allowedTaeEvidenceHosts().includes(url.hostname)
}
