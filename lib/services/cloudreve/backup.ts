/**
 * Paths del respaldo en Cloudreve, separados del espacio SST.
 *
 * El espacio SST mapea cada archivo bajo la carpeta configurada `sstPath`
 * (`remoteSstKey`/`sstLogicalSegments` en `./sst-path`). Los snapshots de
 * respaldo viven en OTRA carpeta (por defecto `backups/plataforma`) y no deben
 * pasar por ese mapeo, pero sí respetar las mismas reglas anti-traversal.
 *
 * Funciones puras (sin DB ni red) para poder probarlas sin mocks.
 */

export const DEFAULT_BACKUP_CLOUDREVE_PATH = "backups/plataforma"

/** Nombres permitidos para un artefacto de snapshot (evita traversal por nombre). */
const BACKUP_ARTIFACT_NAMES = new Set([
  "postgres.dump",
  "storage.tar.gz",
  "env-config.tar.gz",
  "manifest.json",
  "postgres.dump.gpg",
  "storage.tar.gz.gpg",
  "env-config.tar.gz.gpg",
])

/**
 * Normaliza la carpeta remota de respaldos: quita slashes de los bordes y
 * valida cada segmento. Semántica idéntica a `normalizeCloudreveSstPath`, pero
 * con su propio default (`backups/plataforma`) y sin la noción de "raíz de la
 * cuenta WebDAV": `""` (cuenta acotada) es válido, no el default.
 */
export function normalizeBackupCloudrevePath(raw: string | null | undefined): string {
  if (raw === undefined || raw === null) return DEFAULT_BACKUP_CLOUDREVE_PATH
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
      throw new Error("Ruta de carpeta de respaldo Cloudreve inválida")
    }
  }
  return segments.join("/")
}

/**
 * Clave remota de un artefacto de snapshot: `<basePath>/<fecha>/<nombre>`.
 * La fecha debe ser YYYY-MM-DD y el nombre uno de los artefactos conocidos;
 * cualquier otra cosa lanza (el nombre nunca viene de una enumeración libre del
 * filesystem sin validar).
 */
export function backupRemoteKey(basePath: string, dateStr: string, fileName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("Fecha de snapshot inválida")
  }
  if (!BACKUP_ARTIFACT_NAMES.has(fileName)) {
    throw new Error(`Artefacto de respaldo inválido: ${fileName}`)
  }
  const prefix = basePath ? `${basePath}/` : ""
  return `${prefix}${dateStr}/${fileName}`
}
