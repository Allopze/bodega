import { nameKey } from "@/lib/mantencion/normalize"
import { chileLocalDateTimeToUtc } from "@/lib/utils"
import type { ErpNote, ExclusionRule, ImportedNoteStatus } from "./types"

/**
 * Normalización pura de lo que trae CHOME ERP: claves de comparación, fecha, estado y regla de notas de prueba.
 * Nada aquí toca la base.
 */

/** Clave para comparar cargos, patentes y códigos: «KA 115», «KA115» y «ka-115» dan `KA115`. */
export function compactKey(value: string | null | undefined): string {
  return nameKey(value ?? "").replace(/[^a-z0-9]/g, "").toUpperCase()
}

/**
 * Forma canónica de un código de equipo escrito suelto: letras y número, con guion («KA 115» → «KA-115»).
 * `null` si no tiene esa forma (un texto libre, una lista de equipos…).
 */
export function normalizeChargeCode(value: string | null | undefined): string | null {
  const match = /^([A-Za-z]{1,4})[\s._-]*(\d{1,5})$/.exec((value ?? "").trim())
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : null
}

/** RUT sin puntos ni guion y en mayúsculas (`76.000.444-4` → `760004444`); `null` si no parece un RUT. */
export function rutKey(value: string | null | undefined): string | null {
  const compact = (value ?? "").replace(/[^0-9kK]/g, "").toUpperCase()
  return /^\d{6,9}[0-9K]$/.test(compact) ? compact : null
}

const ERP_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/

/**
 * La fecha de una nota de CHOME ERP es hora de Chile SIN zona (`2026-05-02T10:15:00`). Se convierte con el helper del
 * repo (`chileLocalDateTimeToUtc`), que respeta el horario de verano. Sólo fecha = medianoche. `null` si no es una fecha
 * y hora reales (mes 13, 30 de febrero, 25:00) o si trae zona: el origen no la trae y no se adivina.
 */
export function parseErpDate(value: string): string | null {
  const match = ERP_DATE.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4] ?? 0)
  const minute = Number(match[5] ?? 0)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null
  if (hour > 23 || minute > 59) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  return chileLocalDateTimeToUtc(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`)
}

const STATUS_BY_KEY: Record<string, ImportedNoteStatus> = {
  enviada: "enviada",
  aceptada: "aceptada",
  "en espera": "en_espera",
  rechazada: "rechazada",
  cerrada: "cerrada",
}

/** `Enviada | Aceptada | En espera | Rechazada | Cerrada` (sin importar mayúsculas ni tildes) → estado de la plataforma. */
export function mapErpStatus(value: string): ImportedNoteStatus | null {
  return STATUS_BY_KEY[nameKey(value).replace(/_/g, " ")] ?? null
}

/** Texto de usuario limpio: espacios simples y sin bordes; vacío es `null`. */
export function cleanText(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  return text || null
}

/** Recorta a `max` caracteres; devuelve también si hubo que recortar. */
export function clip(value: string, max: number): { text: string; clipped: boolean } {
  return value.length <= max ? { text: value, clipped: false } : { text: value.slice(0, max).trimEnd(), clipped: true }
}

/**
 * Nota de prueba: la creó alguien de la lista de la regla (por solicitante o por usuario) y su observación o alguno de sus
 * artículos delata la prueba. Devuelve el motivo para el informe, o `null` si es una nota real.
 */
export function testNoteReason(note: Pick<ErpNote, "solicitante" | "usuario" | "observacion" | "items">, rule: ExclusionRule): string | null {
  const actors = new Set(rule.actors.map((actor) => nameKey(actor)))
  const author = [note.solicitante, note.usuario].find((value) => value && actors.has(nameKey(value)))
  if (!author) return null
  const hit = [note.observacion, ...note.items.map((item) => item.articulo)].find((text) => text && rule.textPattern.test(text))
  return hit ? `Creada por «${author}» y con texto de prueba: «${hit.length > 60 ? `${hit.slice(0, 57)}…` : hit}»` : null
}
