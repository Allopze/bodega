/**
 * A dónde lleva una referencia de evidencia PDTP (PREV-I05, D12).
 *
 * Pura y sin dependencias de servidor: la usan las miniaturas de la planilla,
 * la cola de aprobaciones y el historial de envíos.
 *
 * Una ejecución guarda en `evidence_url` rutas de varios directorios: las que
 * sube el formulario PDTP viven en `storage/pdtp-evidence/`, pero las que llegan
 * por integración (capacitación, alcotest, simulacros) apuntan al directorio de
 * su módulo. La ruta de descarga PDTP sólo sirve el primero, así que enlazarlas
 * todas a ella producía 404. D12: la evidencia de integración se abre en el
 * módulo de origen, con sus permisos, y aquí se muestra como un chip sin
 * enlace.
 */

export const PDTP_EVIDENCE_PATH_PREFIX = "storage/pdtp-evidence/"

export type PdtpEvidenceLink =
  /** Archivo del directorio PDTP: se descarga por `/api/prevencion/pdtp/evidence/[name]`. */
  | { kind: "pdtp"; name: string; href: string }
  /** Archivo de otro módulo con ruta de descarga propia, que aplica sus permisos y su alcance. */
  | { kind: "module_file"; name: string; href: string }
  /** Archivo de otro módulo: se abre allá, no aquí (D12). */
  | { kind: "source_module"; path: string }
  /** Enlace http(s) declarado como evidencia. */
  | { kind: "external"; href: string }
  /** Texto: un rótulo de integración o una observación, no un archivo. */
  | { kind: "note"; text: string }

/**
 * PRV-21 (auditoría 2026-09-28): directorios de otros módulos que tienen su
 * propia ruta de descarga. Se enlazan a ella —que exige el permiso del módulo y
 * la faena— en vez de dejar un chip sin salida.
 */
const MODULE_DOWNLOAD_ROUTES: ReadonlyArray<{ prefix: string; route: string }> = [
  { prefix: "storage/hygiene-evidence/", route: "/api/prevencion/higiene/evidence/" },
  { prefix: "storage/cgrd-evidence/", route: "/api/prevencion/cgrd/evidence/" },
  { prefix: "storage/campaign-evidence/", route: "/api/prevencion/campanas/evidence/" },
]

/** Nombre generado por la subida: `nanoid` más una extensión corta. */
const SAFE_EVIDENCE_NAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]{1,8})?$/

export function pdtpEvidenceHref(value: string | null | undefined): PdtpEvidenceLink | null {
  const reference = value?.trim()
  if (!reference) return null

  if (reference.startsWith(PDTP_EVIDENCE_PATH_PREFIX)) {
    const name = reference.slice(PDTP_EVIDENCE_PATH_PREFIX.length)
    if (!SAFE_EVIDENCE_NAME.test(name)) return { kind: "note", text: reference }
    return { kind: "pdtp", name, href: `/api/prevencion/pdtp/evidence/${encodeURIComponent(name)}` }
  }
  for (const { prefix, route } of MODULE_DOWNLOAD_ROUTES) {
    if (!reference.startsWith(prefix)) continue
    const name = reference.slice(prefix.length)
    if (SAFE_EVIDENCE_NAME.test(name)) return { kind: "module_file", name, href: `${route}${encodeURIComponent(name)}` }
  }
  if (reference.startsWith("storage/")) return { kind: "source_module", path: reference }
  // Sólo http(s): otro esquema (`javascript:`, `data:`) en un `href` es un XSS.
  if (/^https?:\/\//i.test(reference) && URL.canParse(reference)) {
    return { kind: "external", href: reference }
  }
  return { kind: "note", text: reference }
}

/** Nombre final de una ruta de storage, para mostrarlo o compararlo. */
export function pdtpEvidenceFileName(path: string): string {
  const index = path.lastIndexOf("/")
  return index >= 0 ? path.slice(index + 1) : path
}
