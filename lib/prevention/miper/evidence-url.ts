/**
 * URL de la evidencia de una ocurrencia del Programa de Trabajo. Es puro (sin
 * `node:*` ni base) para poder usarlo en componentes de cliente; la ruta que la
 * sirve está en `app/api/prevencion/miper/evidence/[name]/route.ts`.
 */
export const MIPER_EVIDENCE_PATH_PREFIX = "storage/miper-evidence/"

const EVIDENCE_ROUTE = "/api/prevencion/miper/evidence"

/**
 * Enlace a la evidencia, o `null` si la ruta guardada no es de la carpeta de
 * MIPER (una subida de otro dominio nunca se sirve por esta ruta). Con
 * `download` fuerza la descarga; sin él, PDF e imágenes se abren en el navegador.
 */
export function miperEvidenceHref(evidenceUploadId: string, options: { download?: boolean } = {}): string | null {
  if (!evidenceUploadId.startsWith(MIPER_EVIDENCE_PATH_PREFIX)) return null
  const name = evidenceUploadId.slice(MIPER_EVIDENCE_PATH_PREFIX.length)
  if (name.length === 0) return null
  return `${EVIDENCE_ROUTE}/${encodeURIComponent(name)}${options.download ? "?descargar=1" : ""}`
}
