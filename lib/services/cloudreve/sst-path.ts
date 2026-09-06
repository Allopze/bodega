/**
 * Mapeo entre el path lógico de los documentos SST (la clave que se guarda en
 * `sstDocumentVersions.filePath`) y la carpeta real en Cloudreve.
 *
 * El path lógico es `storage/sst-documents/<segmento>/.../<storageName>`: los
 * segmentos materializan el árbol de carpetas de la plataforma (nombre saneado,
 * ver remoteSegment). La carpeta remota base es configurable
 * (`storage.cloudreve.sst_path`) para apuntar a la subcarpeta propia de la
 * plataforma dentro de la carpeta compartida de Prevención en el drive de
 * Chome. Cambiar la carpeta remota no toca la BD: el mapeo se resuelve en
 * runtime.
 *
 * Funciones puras (sin DB ni red) para poder probarlas sin mocks.
 */

export const DEFAULT_SST_PATH = "storage/sst-documents"

const LOGICAL_PREFIX = "storage/sst-documents/"

export const ARCHIVED_PREFIX = "Archivados"

/**
 * `storage/sst-documents/<seg1>/.../<file>` → segmentos sin el archivo.
 * Valida cada segmento (anti-traversal): el último es el nombre de archivo,
 * que puede contener solo una extensión segura; el resto son nombres de
 * carpeta ya saneados.
 */
export function sstLogicalSegments(filePath: string): string[] {
  if (!filePath.startsWith(LOGICAL_PREFIX)) {
    throw new Error("Ruta fuera del espacio de documentos SST")
  }
  const rest = filePath.slice(LOGICAL_PREFIX.length)
  if (!rest) throw new Error("Nombre de archivo inválido")

  const segments = rest.split("/")
  for (const segment of segments) {
    if (
      !segment
      || segment === "."
      || segment === ".."
      || segment.includes("\\")
      || /[\u0000-\u001f]/.test(segment)
    ) {
      throw new Error("Segmento inválido")
    }
  }
  return segments
}

/**
 * Nombre de archivo del path lógico (último segmento).
 */
export function sstLogicalName(filePath: string): string {
  const segments = sstLogicalSegments(filePath)
  return segments[segments.length - 1]!
}

/**
 * Sanea un nombre de carpeta para usarlo como segmento físico. El slug en BD
 * ya garantiza unicidad entre hermanos; acá solo se neutralizan los caracteres
 * que romperían una ruta.
 */
export function remoteSegment(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[\u0000-\u001f]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!sanitized) return "carpeta"
  return sanitized
}

/**
 * Normaliza la carpeta remota configurada: quita slashes de los bordes y
 * valida cada segmento. Lanza si el valor a mano no es una ruta segura
 * (traversal, backslashes o caracteres de control).
 *
 * Semántica:
 * - `undefined` → DEFAULT_SST_PATH (cuenta WebDAV sin acotar: namespace seguro).
 * - `"/"` → `""` (la raíz de la cuenta WebDAV ES la carpeta de la plataforma:
 *   cuenta acotada con `uri` apuntando a la subcarpeta).
 * - `""` → `""` (solo legible desde system_settings: un "/" guardado).
 */
export function normalizeCloudreveSstPath(raw: string | null | undefined): string {
  if (raw === undefined || raw === null) return DEFAULT_SST_PATH
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "")
  if (!trimmed) return ""

  const segments = trimmed.split("/")
  for (const segment of segments) {
    if (
      !segment
      || segment === "."
      || segment === ".."
      || segment.includes("\\")
      || /[\u0000-\u001f]/.test(segment)
    ) {
      throw new Error("Ruta de carpeta Cloudreve inválida")
    }
  }
  return segments.join("/")
}

/**
 * Clave remota para una operación WebDAV. Acepta el path lógico de un archivo
 * (`storage/sst-documents/<seg>/.../<name>`) o el directorio raíz del espacio
 * (`storage/sst-documents`). Con `sstPath === ""` (cuenta acotada) la clave es
 * la ruta relativa sin prefijo.
 */
export function remoteSstKey(sstPath: string, logicalPath: string): string {
  const relative = logicalPath === "storage/sst-documents"
    ? ""
    : sstLogicalSegments(logicalPath).join("/")
  return sstPath === "" ? relative : `${sstPath}${relative ? `/${relative}` : ""}`
}

/**
 * Ruta relativa al espacio SST de una cadena de segmentos de carpeta
 * (sin el prefijo `storage/sst-documents/`).
 */
export function sstRelativePath(segments: readonly string[]): string {
  if (segments.length === 0) return ""
  return segments.map(remoteSegment).join("/")
}

/**
 * Prefix-replace de un `file_path`. `oldPrefix`/`newPrefix` son rutas relativas
 * al espacio (`segmento/...`; `""` = la raíz del espacio). Devuelve null si la
 * ruta no cae bajo el prefijo viejo. Los cambios estructurales (rename, move,
 * archivar) la usan para reescribir las rutas guardadas tras el MOVE físico.
 */
export function sstPrefixReplace(
  filePath: string,
  oldPrefix: string,
  newPrefix: string,
): string | null {
  const relative = sstLogicalSegments(filePath).join("/")
  const needle = oldPrefix === "" ? "" : `${oldPrefix}/`
  if (needle !== "" && !relative.startsWith(needle)) return null
  const suffix = needle === "" ? relative : relative.slice(needle.length)
  if (!suffix) return null
  return `storage/sst-documents/${newPrefix === "" ? suffix : `${newPrefix}/${suffix}`}`
}
