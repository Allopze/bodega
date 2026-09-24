/**
 * Dónde queda en Cloudreve cada documento generado. Funciones puras (sin BD ni
 * red) para poder probarlas sin mocks.
 *
 * Los nombres que llegan acá vienen de datos de negocio —el nombre de una
 * faena, el código de una inspección, el nombre de un trabajador—, así que cada
 * segmento se sanea antes de tocar el WebDAV. `remoteSegment()` del espacio SST
 * no alcanza: deja pasar `..`, y `new URL()` resuelve ese segmento hacia arriba,
 * de modo que una faena llamada `..` sacaría el archivo de la carpeta base.
 */

export const GENERATED_ARCHIVE_LAYOUTS = ["faena", "anio_faena_modulo"] as const
export type GeneratedArchiveLayout = (typeof GENERATED_ARCHIVE_LAYOUTS)[number]

export const GENERATED_ARCHIVE_LAYOUT_LABELS: Record<GeneratedArchiveLayout, string> = {
  faena: "Por faena",
  anio_faena_modulo: "Año › faena › módulo",
}

export const DEFAULT_GENERATED_ARCHIVE_BASE_PATH = "Documentos generados"
/** Carpeta de los documentos que no pertenecen a una faena. */
export const CORPORATE_FOLDER = "Corporativo"

const MAX_SEGMENT_LENGTH = 120
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function parseGeneratedArchiveLayout(value: string | null | undefined): GeneratedArchiveLayout | null {
  return GENERATED_ARCHIVE_LAYOUTS.find((layout) => layout === value) ?? null
}

function truncateCodePoints(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : value
}

/**
 * Un segmento de carpeta seguro. Nunca devuelve `""`, `.` ni `..`: lo que queda
 * vacío tras sanear toma `fallback`. Reemplaza en vez de rechazar porque el
 * origen es un dato de negocio que el usuario no puede corregir en el momento.
 */
export function sanitizeRemoteSegment(raw: string | null | undefined, fallback = "sin-nombre"): string {
  let value = (raw ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    // Los caracteres que Windows prohíbe: los clientes de escritorio de
    // Cloudreve no podrían sincronizar el archivo.
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
  // Puntos y espacios en los bordes: `..` es un segmento de retroceso y un
  // punto final no existe en Windows.
  value = value.replace(/^[.\s]+|[.\s]+$/g, "")
  value = truncateCodePoints(value, MAX_SEGMENT_LENGTH).replace(/[.\s]+$/g, "")
  if (!value) return fallback
  if (WINDOWS_RESERVED.test(value)) return `_${value}`
  return value
}

/** Un nombre de archivo seguro que conserva su extensión (en minúsculas). */
export function sanitizeRemoteFileName(raw: string, extension: string): string {
  const ext = extension.replace(/^\./, "").toLowerCase()
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error("Extensión de archivo inválida")
  const base = raw.replace(new RegExp(`\\.${ext}$`, "i"), "")
  const safeBase = sanitizeRemoteSegment(truncateCodePoints(base, MAX_SEGMENT_LENGTH - ext.length - 1), "documento")
  return `${safeBase}.${ext}`
}

/**
 * La carpeta base configurada. A diferencia de los segmentos de negocio, acá se
 * rechaza en vez de sanear: la escribe un administrador y un valor raro es un
 * error que debe ver, no algo que la plataforma deba reinterpretar en silencio.
 * La raíz de la cuenta no se admite: suele ser el propio espacio SST.
 */
export function normalizeGeneratedArchiveBasePath(raw: string | null | undefined): string {
  if (raw === undefined || raw === null) return DEFAULT_GENERATED_ARCHIVE_BASE_PATH
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "")
  if (!trimmed) throw new Error("La carpeta de documentos generados no puede ser la raíz de la cuenta.")
  const segments = trimmed.split("/")
  for (const segment of segments) {
    if (!segment || sanitizeRemoteSegment(segment, "") !== segment) {
      throw new Error(`La carpeta «${trimmed}» tiene un tramo inválido: usa nombres sin \\ : * ? " < > | ni puntos en los bordes.`)
    }
  }
  return segments.join("/")
}

/**
 * ¿Una carpeta contiene a la otra? Sin distinguir mayúsculas, porque los
 * clientes de sincronización tampoco lo hacen. `""` (la raíz) contiene a todas.
 */
export function remoteFoldersOverlap(a: string, b: string): boolean {
  const left = a.replace(/^\/+|\/+$/g, "").toLowerCase()
  const right = b.replace(/^\/+|\/+$/g, "").toLowerCase()
  if (!left || !right) return true
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

export interface GeneratedDocumentKeyInput {
  basePath: string
  layout: GeneratedArchiveLayout
  year: number
  /** Nombre de la faena; nulo o vacío = documento corporativo. */
  worksiteLabel: string | null
  moduleLabel: string
  /** Nombre ya saneado con `sanitizeRemoteFileName`. */
  fileName: string
}

export function generatedDocumentRemoteKey(input: GeneratedDocumentKeyInput): string {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2999) {
    throw new Error("Año del documento inválido")
  }
  const basePath = normalizeGeneratedArchiveBasePath(input.basePath)
  const faena = sanitizeRemoteSegment(input.worksiteLabel, CORPORATE_FOLDER)
  const folders = input.layout === "anio_faena_modulo"
    ? [String(input.year), faena, sanitizeRemoteSegment(input.moduleLabel, "Documentos")]
    : [faena]
  const fileName = input.fileName
  if (!fileName || sanitizeRemoteSegment(fileName, "") !== fileName) {
    throw new Error("Nombre de archivo inválido")
  }
  const key = [basePath, ...folders, fileName].join("/")
  assertKeyUnderBase(key, basePath)
  return key
}

/** Última defensa: la clave final no puede salir de la carpeta base. */
export function assertKeyUnderBase(key: string, basePath: string): void {
  const segments = key.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Ruta de documento generado inválida")
  }
  if (!key.startsWith(`${basePath}/`)) throw new Error("La ruta del documento sale de la carpeta base")
}

/** `…/Nombre.pdf` → `…/Nombre (2).pdf`. Para no pisar un archivo que ya estaba. */
export function withCollisionSuffix(key: string, attempt: number): string {
  if (attempt < 2) return key
  const slash = key.lastIndexOf("/")
  const folder = key.slice(0, slash + 1)
  const name = key.slice(slash + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0
    ? `${folder}${name.slice(0, dot)} (${attempt})${name.slice(dot)}`
    : `${folder}${name} (${attempt})`
}
