import { re20PublicDataSchema } from "@/lib/services/prevention-incident-re20-schema"
import { RE20_TASK_DEFINITIONS } from "@/lib/prevention/incidents"
import { RE20_ATTACHMENT_LIMITS } from "@/lib/prevention/re20-attachment-limits"
import type { Re20Conflict, Re20Data, Re20Sensitive, Re20Task } from "./types"

/* Funciones puras del expediente: normalización, rutas de edición, tareas,
 * fusión de tres vías y detección del tipo real de un anexo. Sin React. */

/**
 * JSON con claves ordenadas y sin vacíos (`undefined`, `null`, `""`): compara
 * dos versiones del expediente por contenido. Postgres (`jsonb`) reordena las
 * claves y un campo escrito y luego borrado no es un cambio.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(stabilize(value)) ?? ""
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilize)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry === undefined || entry === null || entry === "") continue
      out[key] = stabilize(entry)
    }
    return out
  }
  return value
}

export function copyJson<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function newRe20Id(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

/**
 * Lleva cualquier forma guardada (servidor, borrador antiguo de la bóveda) a la
 * forma vigente con sus valores por defecto. Un árbol estructuralmente inválido
 * —un borrador a medias— no impide abrir el expediente: se conserva tal cual.
 */
export function normalizeRe20Data(raw: unknown): Re20Data {
  const parsed = re20PublicDataSchema.safeParse(raw ?? {})
  if (parsed.success) return parsed.data
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const withoutTree = re20PublicDataSchema.safeParse({ ...source, causalTree: undefined })
  if (withoutTree.success) {
    return { ...withoutTree.data, causalTree: (source.causalTree as Re20Data["causalTree"] | undefined) ?? { events: [], relations: [] } }
  }
  return { ...re20PublicDataSchema.parse({}), ...source } as Re20Data
}

/** Postgres entrega `2026-10-20 21:35:00+00`; el esquema reservado exige ISO 8601. */
function toIsoTimestamp(value?: string | null) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

export function emptyRe20Sensitive(knownAt?: string | null): Re20Sensitive {
  return {
    declarations: [],
    injuredInterview: { attachmentReferences: [] },
    injuryClinical: {},
    diat: { form: {}, status: "draft", knownAt: toIsoTimestamp(knownAt) },
  }
}

export function normalizeRe20Sensitive(raw: unknown, knownAt?: string | null): Re20Sensitive {
  const empty = emptyRe20Sensitive(knownAt)
  if (!raw || typeof raw !== "object") return empty
  const source = raw as Partial<Re20Sensitive> & { purpose?: unknown; historicalStatements?: unknown }
  return {
    declarations: Array.isArray(source.declarations) ? source.declarations : [],
    injuredInterview: { ...empty.injuredInterview, ...(source.injuredInterview ?? {}) },
    injuryClinical: { ...(source.injuryClinical ?? {}) },
    diat: { ...empty.diat, ...(source.diat ?? {}) },
  }
}

export type Re20Path = string | ReadonlyArray<string | number>

function pathParts(path: Re20Path): Array<string | number> {
  return typeof path === "string" ? path.split(".").filter(Boolean) : [...path]
}

/** Lee un valor anidado: `getIn(data, "preliminary.temperature")`. */
export function getIn(target: unknown, path: Re20Path): unknown {
  let current = target
  for (const part of pathParts(path)) {
    if (current == null || typeof current !== "object") return undefined
    current = (current as Record<string | number, unknown>)[part]
  }
  return current
}

/** Copia inmutable con `value` en `path`; crea los objetos intermedios que falten. */
export function setIn<T>(target: T, path: Re20Path, value: unknown): T {
  const parts = pathParts(path)
  if (parts.length === 0) return value as T
  const head = parts[0] as string | number
  const rest = parts.slice(1)
  const source = (target ?? (typeof head === "number" ? [] : {})) as Record<string | number, unknown> | unknown[]
  const clone = (Array.isArray(source) ? [...source] : { ...source }) as Record<string | number, unknown>
  clone[head] = setIn(clone[head], rest, value)
  return clone as T
}

/** Tarea guardada o, si nunca se tocó, la definida por el protocolo (sin escribirla). */
export function re20TaskOf(data: Pick<Re20Data, "tasks">, taskId: string): Re20Task {
  const stored = data.tasks.find((task) => task.id === taskId)
  if (stored) return stored
  const definition = RE20_TASK_DEFINITIONS.find((task) => task.id === taskId)
  return {
    id: taskId,
    sheet: definition?.sheet ?? "PASO A PASO",
    label: definition?.label ?? taskId,
    status: "pending",
    responsibleRole: definition?.role ?? null,
    responsibleUserId: null,
    dueAt: null,
    completedAt: null,
    note: null,
  }
}

/** Cambia el estado de una tarea; la materializa en `data.tasks` sólo cuando alguien la mueve. */
export function withRe20TaskStatus(data: Re20Data, taskId: string, status: Re20Task["status"], at = new Date().toISOString()): Re20Data {
  const next = { ...re20TaskOf(data, taskId), status, completedAt: status === "completed" ? at : null }
  const exists = data.tasks.some((task) => task.id === taskId)
  return { ...data, tasks: exists ? data.tasks.map((task) => task.id === taskId ? next : task) : [...data.tasks, next] }
}

/**
 * Fusión de tres vías por sección de primer nivel: lo que sólo cambió aquí se
 * conserva, lo que sólo cambió en el servidor se adopta, y lo que cambió en
 * ambos lados de forma distinta queda como conflicto (se muestra la versión del
 * servidor hasta que la persona elija).
 */
export function mergeWorkspaceDraft(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>) {
  const merged: Record<string, unknown> = {}
  const conflicts: Re20Conflict[] = []
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const before = base[key]
    const localValue = local[key]
    const remoteValue = remote[key]
    const localChanged = stableJson(localValue) !== stableJson(before)
    const remoteChanged = stableJson(remoteValue) !== stableJson(before)
    if (!localChanged) merged[key] = copyJson(remoteValue)
    else if (!remoteChanged || stableJson(localValue) === stableJson(remoteValue)) merged[key] = copyJson(localValue)
    else {
      merged[key] = copyJson(remoteValue)
      conflicts.push({ section: key, base: before, local: localValue, remote: remoteValue })
    }
  }
  return { merged, conflicts }
}

/* ── Anexos ──────────────────────────────────────────────────────────────── */

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

export function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const ALLOWED = new Set<string>(RE20_ATTACHMENT_LIMITS.allowedMimeTypes)

/**
 * Tipo real por contenido, con las mismas firmas que acepta el servidor
 * (`detectRe20AttachmentMime`): el navegador declara el tipo por la extensión,
 * y una foto renombrada o un archivo sin tipo terminaba rechazado tras subirse.
 */
export function sniffRe20MimeType(bytes: Uint8Array): string | null {
  const at = (index: number) => bytes[index]
  if (bytes.length >= 4 && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return "application/pdf"
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg"
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "image/png"
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp"
  if (bytes.length >= 1) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return "text/plain"
    } catch {
      return null
    }
  }
  return null
}

export function isAllowedRe20MimeType(mimeType: string | null): mimeType is string {
  return mimeType !== null && ALLOWED.has(mimeType)
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
}

/* ── Etiquetas humanas de las secciones (conflictos, faltantes) ──────────── */

export const RE20_SECTION_LABELS: Record<string, string> = {
  methodology: "Método de análisis",
  methodologyNote: "Nota sobre el método",
  tasks: "Avance de las etapas",
  team: "Equipo investigador",
  conflictOfInterestNotes: "Conflictos de interés",
  preliminary: "Informe preliminar",
  affectedPerson: "Persona afectada",
  evidences: "Evidencias",
  definitive: "Informe definitivo",
  causalTree: "Árbol de causas",
  measures: "Medidas",
  nearMiss: "Cuasi accidente",
  attachmentIds: "Anexos",
  legacy: "Datos anteriores",
}

export function re20SectionLabel(section: string) {
  return RE20_SECTION_LABELS[section] ?? "Otros datos del expediente"
}
