/**
 * scripts/apply-trinorma-lecturas-preventivas.ts
 *
 * Carga, desde la planilla que devuelve el Jefe de Mantención, la lectura inicial y la última
 * preventiva declarada anterior a la plataforma de cada camión (Trinorma, decisión del usuario del
 * 2026-11-21, opción A). Van JUNTAS y sólo donde él las confirmó con respaldo: nunca una lectura
 * sin su preventiva, ni una preventiva sin respaldo. Lo que no se confirma queda pendiente, con su
 * motivo, en el informe; nada se descarta en silencio.
 *
 * Las dos escrituras salen por `updateEquipmentPlanTx` (la misma puerta de «Editar mantención»):
 * validación del servidor, historial del equipo y bitácora con quién la declaró, quién la cargó y de
 * dónde salió. Este script sólo lee la planilla, decide qué equipos cargar y arma el informe.
 *
 * Reglas (condiciones del usuario):
 *  - La pauta va antes que las lecturas: sin `--pauta-confirmada` sólo se puede simular, y `--apply`
 *    sin ella es un error que no escribe nada.
 *  - Quien carga (`--actor-email`) y quien declara (`--declarada-por`, el Jefe de Mantención) son
 *    usuarios activos con `mant:equipment:manage` (por rol o por permiso directo), comprobado en la base.
 *  - Sólo completa vacíos: si el equipo ya tiene una lectura inicial o una preventiva declarada DISTINTA
 *    de la que traería la planilla, la carga entera se aborta diciendo qué equipo y por qué (excepción:
 *    la lectura de noviembre de la hoja 3 reemplaza a la de la hoja 2 si ésa es la que está guardada).
 *  - Simulación por defecto: corre el mismo código en una sola transacción (con advisory lock) y la
 *    deshace. Idempotente: una segunda corrida da «ya estaba».
 *
 *   npx tsx scripts/apply-trinorma-lecturas-preventivas.ts --file <planilla.xlsx> --actor-email <correo> --declarada-por <correo> [--pauta-confirmada] [--report <informe.md>]           # simulación
 *   npx tsx scripts/apply-trinorma-lecturas-preventivas.ts --file <planilla.xlsx> --actor-email <correo> --declarada-por <correo> --pauta-confirmada --apply [--report <informe.md>]  # escribe
 *
 * `--origen-formularios` (decisión del usuario del 2026-11-27, antes de la auditoría del 01-12): una fila que el Jefe
 * dejó sin responder se carga con lo que dicen los formularios (fecha y odómetro de la última preventiva, la OT como
 * respaldo y el servicio que la regla de la pauta sugiere para ese odómetro). La fuente lo dice así en la historia del
 * equipo: «según formularios, sin confirmar por el Jefe de Mantención». Lo que el Jefe sí respondió manda igual que siempre.
 * `--solo <código,código>` acota la carga a esos equipos; el resto queda pendiente con su motivo.
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { and, count, eq, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelVehicles, permissions, rolePermissions, userPermissions, userRoles, users } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { matchVehicle, plateKey } from "@/lib/mantencion/equipment-identity"
import { loadXlsxTolerant } from "@/lib/reports/xlsx-normalize"
import { EVIDENCE_REFERENCE_MESSAGE, isEvidenceReference, loadEquipmentCurrent } from "@/lib/services/mantencion/equipment-resolve"
import { updateEquipmentPlanTx } from "@/lib/services/mantencion/equipment"
import { getCurrentScheduleSnapshots } from "@/lib/services/mantencion/schedule-versions"
import { suggestInterval } from "@/lib/mantencion/schedule"

export const MANAGE_PERMISSION = "mant:equipment:manage"
const LOCK_KEY = "trinorma-lecturas-preventivas"
const EVIDENCE_MAX = 120
export const PAUTA_PENDING_NOTE = "falta confirmar la pauta: hoja 1 de la planilla. Hasta entonces sólo se simula; con --apply no se escribe nada."
/** El error de `--apply` sin `--pauta-confirmada` (dice lo mismo una vez, sin repetirse). */
export const PAUTA_REQUIRED_ERROR = "No se escribe nada: falta confirmar la pauta: hoja 1 de la planilla. Agrega --pauta-confirmada cuando el Jefe de Mantención la haya confirmado o corregido."

/* ── Lectura de la planilla ──────────────────────────────────────────────── */

/** Un valor de celda sin envoltorios (fórmula, texto enriquecido, hipervínculo). */
function plain(value: unknown): string | number | Date | null {
  if (value == null) return null
  if (typeof value === "string") return value.trim() === "" ? null : value.trim()
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "boolean") return String(value)
  const object = value as { result?: unknown; text?: unknown; richText?: Array<{ text?: string }> }
  if (Array.isArray(object.richText)) return plain(object.richText.map((part) => part.text ?? "").join(""))
  if (object.result != null) return plain(object.result)
  if (object.text != null) return plain(object.text)
  return null
}

function text(value: unknown): string {
  const v = plain(value)
  if (v == null) return ""
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

const headerKey = (value: unknown) => text(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "")

function isRealDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** `Date` de Excel o texto «dd-mm-aaaa» / «dd/mm/aaaa» / «aaaa-mm-dd»; `null` si no es una fecha real. */
export function parsePlainDate(value: unknown): string | null {
  const v = plain(value)
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === "number") return null
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v)
  if (dmy) {
    const [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])]
    return isRealDate(y, m, d) ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (ymd) return isRealDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])) ? v : null
  return null
}

/** Número de Excel o texto con puntos de miles («400.627», «1 234», «1.234,5»); `null` si no es un número. */
export function parseNumber(value: unknown): number | null {
  const v = plain(value)
  if (v == null || v instanceof Date) return null
  if (typeof v === "number") return v
  const cleaned = v.replace(/\s*(km|kms|h|hr|hrs|horas)\.?$/i, "").trim()
  if (/^\d{1,3}([.\s]\d{3})+(,\d+)?$/.test(cleaned)) return Number(cleaned.replace(/[.\s]/g, "").replace(",", "."))
  if (/^\d+(,\d+)?$/.test(cleaned)) return Number(cleaned.replace(",", "."))
  if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned)
  return null
}

/** «40.000 km» → 40000; «Otro» o vacío → `null`. */
export function parseService(value: unknown): number | null {
  const n = parseNumber(value)
  return n !== null && Number.isInteger(n) && n > 0 ? n : null
}

export interface PreventiveRow {
  /** Fila de la hoja (1-based), para el informe. */
  row: number
  code: string
  plate: string
  reading: unknown
  readingDate: unknown
  note: string
  answer: string
  formDate: unknown
  formReading: unknown
  realDate: unknown
  realReading: unknown
  service: unknown
  where: string
  evidence: string
  /** OT de la última preventiva según formularios (columna «OT»), para `--origen-formularios`. */
  formOt: string
}

export interface NovemberReading { row: number; code: string; plate: string; reading: unknown; date: unknown }

export interface Planilla {
  rows: PreventiveRow[]
  november: NovemberReading[]
  notes: string[]
}

type Sheet = { getRow(n: number): { getCell(c: number): { value: unknown } }; rowCount: number; name: string }

function findHeader(sheet: Sheet, required: readonly string[]): { rowNumber: number; columns: Map<string, number[]> } | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber++) {
    const columns = new Map<string, number[]>()
    for (let column = 1; column <= 40; column++) {
      const key = headerKey(sheet.getRow(rowNumber).getCell(column).value)
      if (key) columns.set(key, [...(columns.get(key) ?? []), column])
    }
    if (required.every((key) => columns.has(key))) return { rowNumber, columns }
  }
  return null
}

export async function readPlanilla(bytes: ArrayBuffer | Uint8Array): Promise<Planilla> {
  const workbook = await loadXlsxTolerant(bytes)
  if (!workbook) throw new Error("No se pudo leer la planilla: el archivo no es un Excel válido.")
  const notes: string[] = []
  const sheets = workbook.worksheets as unknown as Sheet[]

  const sheet2 = sheets.find((sheet) => headerKey(sheet.name).includes("ULTIMAPREVENTIVA"))
  if (!sheet2) throw new Error("La planilla no tiene la hoja «2 Última preventiva».")
  const REQUIRED = ["CODIGO", "PATENTE", "LECTURAACTUALKM", "FECHADELALECTURA", "CONFIRMAOCORRIGE", "FECHAREAL", "ODOMETROREALKM", "SERVICIODEPAUTA", "RESPALDOOTOFACTURA"]
  const header = findHeader(sheet2, REQUIRED)
  if (!header) throw new Error(`La hoja «${sheet2.name}» no tiene los encabezados esperados (${REQUIRED.join(", ")}) en sus primeras filas.`)
  const col = (key: string) => header.columns.get(key)?.[0] ?? 0
  const formDateColumn = [...header.columns.entries()].find(([key]) => key.startsWith("ULTIMAPREVENTIVA"))?.[1][0] ?? 0
  if (!formDateColumn || !col("ODOMETROKM")) throw new Error(`La hoja «${sheet2.name}» no tiene las columnas de la última preventiva según formularios (fecha y «Odómetro (km)»).`)
  const rows: PreventiveRow[] = []
  for (let number = header.rowNumber + 1; number <= sheet2.rowCount; number++) {
    const r = sheet2.getRow(number)
    const code = text(r.getCell(col("CODIGO")).value)
    const plate = text(r.getCell(col("PATENTE")).value)
    if (!code && !plate) continue
    rows.push({
      row: number, code, plate,
      reading: r.getCell(col("LECTURAACTUALKM")).value, readingDate: r.getCell(col("FECHADELALECTURA")).value,
      note: col("NOTA") ? text(r.getCell(col("NOTA")).value) : "",
      answer: text(r.getCell(col("CONFIRMAOCORRIGE")).value),
      formDate: r.getCell(formDateColumn).value, formReading: r.getCell(col("ODOMETROKM")).value,
      realDate: r.getCell(col("FECHAREAL")).value, realReading: r.getCell(col("ODOMETROREALKM")).value,
      service: r.getCell(col("SERVICIODEPAUTA")).value,
      where: col("DONDESEHIZO") ? text(r.getCell(col("DONDESEHIZO")).value) : "",
      evidence: text(r.getCell(col("RESPALDOOTOFACTURA")).value),
      formOt: col("OT") ? text(r.getCell(col("OT")).value) : "",
    })
  }

  const november: NovemberReading[] = []
  const sheet3 = sheets.find((sheet) => headerKey(sheet.name).includes("ARAUCO"))
  if (!sheet3) notes.push("La planilla no trae la hoja «3 Arauco»: todas las lecturas salen de la hoja 2.")
  else {
    const h3 = findHeader(sheet3, ["CODIGO", "PATENTE", "LECTURADENOVIEMBREKM"])
    if (!h3) throw new Error(`La hoja «${sheet3.name}» no tiene los encabezados «Código», «Patente» y «Lectura de noviembre (km)».`)
    const readingColumn = h3.columns.get("LECTURADENOVIEMBREKM")![0]!
    // Hay dos columnas «Fecha» (la de la última lectura conocida y la de noviembre): la de noviembre es la que sigue a su lectura.
    const dateColumn = (h3.columns.get("FECHA") ?? []).find((c) => c > readingColumn) ?? 0
    if (!dateColumn) throw new Error(`La hoja «${sheet3.name}» no tiene la columna «Fecha» de la lectura de noviembre.`)
    const codeColumn = h3.columns.get("CODIGO")![0]!
    const plateColumn = h3.columns.get("PATENTE")![0]!
    // La primera tabla termina en la primera fila sin código ni patente; debajo viene la de KCH-130.
    for (let number = h3.rowNumber + 1; number <= sheet3.rowCount; number++) {
      const r = sheet3.getRow(number)
      const code = text(r.getCell(codeColumn).value)
      const plate = text(r.getCell(plateColumn).value)
      if (!code && !plate) break
      november.push({ row: number, code, plate, reading: r.getCell(readingColumn).value, date: r.getCell(dateColumn).value })
    }
  }
  return { rows, november, notes }
}

/* ── Decisión por fila ───────────────────────────────────────────────────── */

export interface Candidate {
  initialReading: number
  initialReadingDate: string
  /** De dónde salió la lectura, para el informe. */
  readingFrom: "hoja 2" | "hoja 3 (noviembre)"
  /** La lectura de la hoja 2, para reconocer el reemplazo por la de noviembre. */
  sheet2Reading: { value: number; date: string } | null
  prior: { date: string; reading: number; intervalValue: number; evidence: string }
  source: string
  notes: string[]
}

const label = (row: { code: string; plate: string }) => [row.code, row.plate].filter(Boolean).join(" ") || "(sin código ni patente)"

/** La fila de la planilla convertida en lo que se cargaría, o el motivo por el que queda pendiente. */
/** Con `--origen-formularios`: el servicio que la regla de la pauta sugiere para el odómetro de la preventiva. */
export interface FormsOrigin { intervals: readonly number[]; cyclic: boolean }

export const FORMS_SOURCE_NOTE = "según formularios, sin confirmar por el Jefe de Mantención"

export function buildCandidate(
  row: PreventiveRow,
  november: NovemberReading | null,
  fileName: string,
  formsOrigin: FormsOrigin | null = null,
): { ok: true; value: Candidate } | { ok: false; reason: string } {
  const answer = headerKey(row.answer)
  if (!answer && formsOrigin) return buildFromForms(row, november, fileName, formsOrigin)
  let priorDate: string | null
  let priorReading: number | null
  if (answer === "CONFIRMA") {
    priorDate = parsePlainDate(row.formDate)
    priorReading = parseNumber(row.formReading)
    if (!priorDate || priorReading === null) return { ok: false, reason: "dice «Confirma», pero los formularios no traen una preventiva con fecha y odómetro" }
  } else if (answer === "CORRIGE") {
    priorDate = parsePlainDate(row.realDate)
    priorReading = parseNumber(row.realReading)
    if (!priorDate || priorReading === null) return { ok: false, reason: "dice «Corrige», pero falta la «Fecha real» o el «Odómetro real (km)» (o no son válidos)" }
  } else {
    return { ok: false, reason: !answer ? "sin respuesta en «¿Confirma o corrige?»" : answer === "NOSE" ? "respondió «No sé»" : "respuesta no reconocida en «¿Confirma o corrige?»" }
  }
  const intervalValue = parseService(row.service)
  if (intervalValue === null) return { ok: false, reason: "falta el «Servicio de pauta» (vacío u «Otro»): no se sabe a qué servicio de la pauta corresponde" }
  if (!row.evidence) return { ok: false, reason: "falta el respaldo (OT o factura): sin respaldo no se carga nada del equipo, ni su lectura" }
  if (!isEvidenceReference(row.evidence)) return { ok: false, reason: `el respaldo «${row.evidence}» no sirve: ${EVIDENCE_REFERENCE_MESSAGE.charAt(0).toLowerCase()}${EVIDENCE_REFERENCE_MESSAGE.slice(1)} No se carga nada del equipo.` }
  const notes: string[] = []
  let evidence = row.evidence
  if (evidence.length > EVIDENCE_MAX) return { ok: false, reason: `el respaldo supera los ${EVIDENCE_MAX} caracteres y no se recorta` }
  if (row.where) {
    const joined = `${evidence} · ${row.where}`
    if (joined.length <= EVIDENCE_MAX) evidence = joined
    else {
      const room = EVIDENCE_MAX - evidence.length - 3 - 1
      if (room >= 4) { evidence = `${evidence} · ${row.where.slice(0, room)}…`; notes.push("«Dónde se hizo» se recortó para caber en el respaldo") }
      else notes.push("«Dónde se hizo» no cabe en el respaldo y no se guardó")
    }
  }

  const sheet2Date = parsePlainDate(row.readingDate)
  const sheet2Value = parseNumber(row.reading)
  const sheet2Reading = sheet2Date && sheet2Value !== null ? { value: sheet2Value, date: sheet2Date } : null
  let reading = sheet2Reading
  let readingFrom: Candidate["readingFrom"] = "hoja 2"
  if (november) {
    const nDate = parsePlainDate(november.date)
    const nValue = parseNumber(november.reading)
    const hasValue = plain(november.reading) !== null
    const hasDate = plain(november.date) !== null
    if (hasValue || hasDate) {
      if (nDate && nValue !== null) { reading = { value: nValue, date: nDate }; readingFrom = "hoja 3 (noviembre)" }
      else return { ok: false, reason: "la hoja 3 trae la lectura de noviembre incompleta o inválida (necesita lectura y fecha)" }
    }
  }
  if (!reading) return { ok: false, reason: "falta la lectura actual con su fecha (hoja 2) o no son válidas" }

  const source = `Planilla del Jefe de Mantención (${path.basename(fileName)})${row.note ? ` · Nota: ${row.note}` : ""}`
  return {
    ok: true,
    value: {
      // La base guarda las lecturas con un decimal (numeric(14,1)): se redondea igual, así una segunda
      // corrida compara lo mismo que quedó guardado.
      initialReading: oneDecimal(reading.value), initialReadingDate: reading.date, readingFrom,
      sheet2Reading: sheet2Reading ? { ...sheet2Reading, value: oneDecimal(sheet2Reading.value) } : sheet2Reading,
      prior: { date: priorDate!, reading: oneDecimal(priorReading!), intervalValue, evidence }, source, notes,
    },
  }
}

/**
 * Fila sin respuesta del Jefe, cargada con lo que dicen los formularios. Mismas condiciones que una confirmación
 * (fecha y odómetro válidos, respaldo con número, lectura actual con fecha); el servicio no lo eligió nadie, así que
 * se usa el que sugiere la regla de la pauta del equipo para ese odómetro, como en la app del mecánico.
 */
function buildFromForms(row: PreventiveRow, november: NovemberReading | null, fileName: string, origin: FormsOrigin): { ok: true; value: Candidate } | { ok: false; reason: string } {
  const date = parsePlainDate(row.formDate)
  const reading = parseNumber(row.formReading)
  if (!date || reading === null) return { ok: false, reason: "sin respuesta del Jefe y los formularios no traen una preventiva con fecha y odómetro" }
  const ot = row.formOt.replace(/^OT\s*/i, "").trim()
  if (!/^\d+$/.test(ot)) return { ok: false, reason: "sin respuesta del Jefe y la preventiva de los formularios no trae un número de OT que sirva de respaldo" }
  if (origin.intervals.length === 0) return { ok: false, reason: "la pauta del equipo no tiene intervalos" }
  const service = suggestInterval(origin.intervals, reading, origin.cyclic).intervalValue
  const built = buildCandidate({ ...row, answer: "Confirma", service, evidence: `OT ${ot}` }, november, fileName)
  if (!built.ok) return built
  return {
    ok: true,
    value: {
      ...built.value,
      source: `Formularios de mantención (${path.basename(fileName)}), ${FORMS_SOURCE_NOTE}${row.note ? ` · Nota: ${row.note}` : ""}`,
      notes: [...built.value.notes, `servicio ${service} sugerido por la regla de la pauta (nadie lo eligió)`],
    },
  }
}

/* ── Informe ─────────────────────────────────────────────────────────────── */

type Result = "dry-run" | "cargado" | "ya estaba" | "pendiente"
export interface Outcome { item: string; row: number | null; result: Result; detail?: string }
export interface LecturasReport {
  fileName: string
  pautaConfirmada: boolean
  apply: boolean
  outcomes: Outcome[]
  /** Hechos de la planilla que no son un equipo (hoja 3 sin su fila en la hoja 2, etc.). */
  notes: string[]
}

interface Actor { userId: string; email: string }
class DryRunRollback extends Error {}

const near = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && Math.abs(a - b) < 0.05
const oneDecimal = (value: number) => Math.round(value * 10) / 10

async function resolveManager(tx: Tx, email: string, role: string): Promise<Actor> {
  const [user] = await tx.select({ id: users.id, email: users.email }).from(users)
    .where(and(eq(sql`lower(${users.email})`, email.trim().toLowerCase()), eq(users.isActive, true))).limit(1)
  if (!user) throw new Error(`No hay un usuario activo para ${role}: se necesita un usuario activo con ${MANAGE_PERMISSION}.`)
  const [viaRole] = await tx.select({ n: count() }).from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, user.id), eq(permissions.name, MANAGE_PERMISSION)))
  const [direct] = await tx.select({ n: count() }).from(userPermissions)
    .innerJoin(permissions, eq(permissions.id, userPermissions.permissionId))
    .where(and(eq(userPermissions.userId, user.id), eq(permissions.name, MANAGE_PERMISSION)))
  if ((viaRole?.n ?? 0) + (direct?.n ?? 0) === 0) throw new Error(`El usuario indicado como ${role} no tiene el permiso ${MANAGE_PERMISSION}: no se escribe nada.`)
  return { userId: user.id, email: user.email }
}

export interface ApplyLecturasOptions {
  /** Bytes del .xlsx. */
  bytes: ArrayBuffer | Uint8Array
  /** Nombre del archivo (va en la fuente de cada preventiva). */
  fileName: string
  actorEmail: string
  declaredByEmail: string
  pautaConfirmada?: boolean
  apply?: boolean
  /** Carga las filas sin respuesta con lo que dicen los formularios (ver el encabezado). */
  formsOrigin?: boolean
  /** Sólo estos códigos (o patentes); vacío = todos. */
  only?: readonly string[]
}

export async function applyTrinormaLecturasPreventivas(options: ApplyLecturasOptions): Promise<LecturasReport> {
  const apply = options.apply ?? false
  const pautaConfirmada = options.pautaConfirmada ?? false
  if (apply && !pautaConfirmada) {
    throw new Error(PAUTA_REQUIRED_ERROR)
  }
  const planilla = await readPlanilla(options.bytes)
  const report: LecturasReport = { fileName: path.basename(options.fileName), pautaConfirmada, apply, outcomes: [], notes: [...planilla.notes] }
  if (!pautaConfirmada) report.notes.unshift(`Simulación: ${PAUTA_PENDING_NOTE}`)

  try {
    await db.transaction(async (tx) => {
      // Una sola carga a la vez: dos corridas simultáneas no se pisan.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`)
      const actor = await resolveManager(tx, options.actorEmail, "quien carga (--actor-email)")
      const declarer = await resolveManager(tx, options.declaredByEmail, "quien declara (--declarada-por)")
      const fleet = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate }).from(fuelVehicles)

      // Cada patente de la hoja 2 debe aparecer una sola vez; la de la hoja 3, también.
      const plateCounts = new Map<string, number>()
      for (const row of planilla.rows) plateCounts.set(plateKey(row.plate), (plateCounts.get(plateKey(row.plate)) ?? 0) + 1)
      const novemberByPlate = new Map<string, NovemberReading[]>()
      for (const n of planilla.november) novemberByPlate.set(plateKey(n.plate), [...(novemberByPlate.get(plateKey(n.plate)) ?? []), n])
      const sheet2Plates = new Set(planilla.rows.map((row) => plateKey(row.plate)))
      for (const n of planilla.november) {
        if (!sheet2Plates.has(plateKey(n.plate))) report.notes.push(`Hoja 3, fila ${n.row} (${label(n)}): no tiene fila en la hoja 2; su lectura de noviembre no se usó.`)
      }

      const loaded: string[] = []
      const conflicts: string[] = []
      const only = new Set((options.only ?? []).map((value) => plateKey(value)).filter(Boolean))
      for (const row of planilla.rows) {
        const item = label(row)
        const pending = (reason: string) => report.outcomes.push({ item, row: row.row, result: "pendiente", detail: reason })
        const conflict = (message: string) => { conflicts.push(message); pending(`conflicto: ${message}`) }
        if (!plateKey(row.plate)) { pending("la fila no trae patente"); continue }
        if ((plateCounts.get(plateKey(row.plate)) ?? 0) > 1) { pending("la patente aparece más de una vez en la hoja 2"); continue }
        const novemberRows = novemberByPlate.get(plateKey(row.plate)) ?? []
        if (novemberRows.length > 1) { pending("la patente aparece más de una vez en la hoja 3"); continue }

        const match = matchVehicle({ code: row.code, plate: row.plate }, fleet)
        if (match.state === "conflict") { pending(`no se pudo identificar el equipo: ${match.reason}`); continue }
        if (match.state === "unmatched") { pending("el equipo no está en la flota (ni por patente ni por código)"); continue }
        const current = await loadEquipmentCurrent(tx, match.vehicleId)
        if (!current) { pending("el equipo está en la flota, pero no en Mantención"); continue }
        if (!current.scheduleId) { pending("el equipo no tiene pauta asignada en Mantención"); continue }
        if (!current.active) { pending("el equipo está dado de baja: no se le carga lectura ni preventiva"); continue }
        if (only.size > 0 && !only.has(plateKey(row.code)) && !only.has(plateKey(row.plate))) { pending("fuera de esta carga (--solo)"); continue }

        let origin: FormsOrigin | null = null
        if (options.formsOrigin) {
          const [snapshot] = await getCurrentScheduleSnapshots([current.scheduleId], tx)
          origin = { intervals: snapshot?.intervals ?? [], cyclic: snapshot?.cyclic ?? false }
        }
        const built = buildCandidate(row, novemberRows[0] ?? null, options.fileName, origin)
        if (!built.ok) { pending(built.reason); continue }
        const target = built.value

        // Sólo completa vacíos: lo ya guardado y distinto de lo que traería la planilla se respeta y aborta la carga.
        const f = current.fields
        const sameReading = near(f.initialReading, target.initialReading) && f.initialReadingDate === target.initialReadingDate
        if (f.initialReading !== null && !sameReading) {
          const isPlannedReplacement = target.readingFrom === "hoja 3 (noviembre)" && target.sheet2Reading !== null
            && near(f.initialReading, target.sheet2Reading.value) && f.initialReadingDate === target.sheet2Reading.date
          if (!isPlannedReplacement) {
            conflict(`Fila ${row.row} (${item}): ya tiene una lectura inicial (${f.initialReading} km al ${f.initialReadingDate}) distinta de la de la planilla (${target.initialReading} km al ${target.initialReadingDate}). No se sobrescribe: se aborta la carga entera; corrige la ficha o la planilla.`)
            continue
          }
        }
        const hasPrior = f.priorPreventiveDate != null
        const samePrior = f.priorPreventiveDate === target.prior.date && near(f.priorPreventiveReading, target.prior.reading)
          && f.priorPreventiveInterval === target.prior.intervalValue && f.priorPreventiveEvidence === target.prior.evidence
        if (hasPrior && !samePrior) {
          conflict(`Fila ${row.row} (${item}): ya tiene una preventiva declarada (${f.priorPreventiveDate}, ${f.priorPreventiveReading} km, servicio ${f.priorPreventiveInterval}) distinta de la de la planilla (${target.prior.date}, ${target.prior.reading} km, servicio ${target.prior.intervalValue}). No se sobrescribe: se aborta la carga entera; corrige la ficha o la planilla.`)
          continue
        }
        if (sameReading && samePrior) { report.outcomes.push({ item, row: row.row, result: "ya estaba" }); continue }

        const result = await updateEquipmentPlanTx(
          tx,
          { userId: actor.userId, email: actor.email },
          match.vehicleId,
          {
            scheduleId: current.scheduleId,
            initialReading: target.initialReading,
            initialReadingDate: target.initialReadingDate,
            priorPreventive: { ...target.prior, declaredBy: declarer.userId, source: target.source },
          },
          { active: current.active, retiredReason: current.retiredReason ?? "" },
        )
        if (!result.ok) {
          const reasons = [...new Set(Object.values(result.fieldErrors ?? {}).filter(Boolean))]
          pending(`el servidor lo rechazó: ${reasons.length ? reasons.join(" ") : result.message}`)
          continue
        }
        loaded.push(item)
        report.outcomes.push({
          item, row: row.row, result: apply ? "cargado" : "dry-run",
          detail: `lectura ${target.initialReading} km al ${target.initialReadingDate} (${target.readingFrom}); preventiva ${target.prior.date}, ${target.prior.reading} km, servicio ${target.prior.intervalValue}, respaldo «${target.prior.evidence}»${target.notes.length ? `; ${target.notes.join("; ")}` : ""}`,
        })
      }

      // Un valor ya guardado y distinto no se sobrescribe. Con --apply aborta la carga entera, con todos
      // los conflictos a la vista; en simulación quedan en el informe y se sigue, para no ocultar el resto.
      if (conflicts.length > 0) {
        if (apply) throw new Error(`No se escribe nada: ${conflicts.length} equipo(s) ya tienen datos distintos de los de la planilla.\n${conflicts.join("\n")}`)
        report.notes.push(`${conflicts.length} conflicto(s) con datos ya guardados: con --apply se abortaría la carga entera hasta corregirlos.`)
      }
      const countOf = (r: Result) => report.outcomes.filter((o) => o.result === r).length
      await recordAudit({
        userId: actor.userId, userEmail: actor.email, action: "update", entityType: "mant_equipment_prior_preventive_load", entityId: nanoid(),
        entityCode: "trinorma-lecturas-preventivas",
        newState: {
          file: report.fileName, applied: apply, declaredBy: declarer.userId, pautaConfirmada, formsOrigin: options.formsOrigin ?? false,
          total: report.outcomes.length, loaded: loaded.length, alreadyThere: countOf("ya estaba"), pending: countOf("pendiente"),
          loadedEquipment: loaded,
          pendingEquipment: report.outcomes.filter((o) => o.result === "pendiente").map((o) => ({ item: o.item, reason: o.detail })),
        },
        reason: options.formsOrigin
          ? `Carga de la lectura inicial y la preventiva declarada anterior a la plataforma; las filas sin respuesta del Jefe salen de los formularios (${FORMS_SOURCE_NOTE}; decisión del 2026-11-27)`
          : "Carga de la lectura inicial y la preventiva declarada anterior a la plataforma desde la planilla del Jefe de Mantención (Trinorma, 2026-11-21)",
      }, tx)
      // La simulación corre el mismo código y lo deshace: lo que informa es lo que `--apply` haría.
      if (!apply) throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return report
}

function tally(report: LecturasReport) {
  const n = (r: Result) => report.outcomes.filter((o) => o.result === r).length
  const pendientes = report.outcomes.filter((o) => o.result === "pendiente")
  const summary = `${report.apply ? `${n("cargado")} cargado(s)` : `${n("dry-run")} por cargar (simulación)`}, ${n("ya estaba")} ya estaban, ${pendientes.length} pendiente(s).`
  return { pendientes, summary }
}

const RESULT_LABEL: Record<Result, string> = { "dry-run": "por cargar", cargado: "cargado", "ya estaba": "ya estaba", pendiente: "pendiente" }

export function printLecturasReport(report: LecturasReport) {
  console.log(`Planilla: ${report.fileName}`)
  for (const note of report.notes) console.log(`Nota: ${note}`)
  for (const o of report.outcomes) console.log(`  ${o.item.padEnd(20)} ${RESULT_LABEL[o.result].padEnd(10)}${o.detail ? ` — ${o.detail}` : ""}`)
  const { pendientes, summary } = tally(report)
  console.log(`\n${summary}`)
  if (pendientes.length) {
    console.log("Pendientes:")
    for (const o of pendientes) console.log(`  ${o.item} (fila ${o.row}): ${o.detail}`)
  }
}

export function renderLecturasReportMarkdown(report: LecturasReport): string {
  const { pendientes, summary } = tally(report)
  const lines = [
    "# Carga de lecturas y preventivas declaradas (Trinorma)",
    "",
    `- Planilla: ${report.fileName}`,
    `- Modo: ${report.apply ? "escritura (`--apply`)" : "simulación (no escribió nada)"}`,
    `- Pauta confirmada: ${report.pautaConfirmada ? "sí" : "no (hoja 1 de la planilla)"}`,
    `- Resultado: ${summary}`,
    "",
  ]
  for (const note of report.notes) lines.push(`> ${note}`, "")
  lines.push("## Por equipo", "", "| Equipo | Fila | Resultado | Detalle |", "|---|---|---|---|")
  for (const o of report.outcomes) lines.push(`| ${o.item} | ${o.row ?? ""} | ${RESULT_LABEL[o.result]} | ${(o.detail ?? "").replace(/\|/g, "/")} |`)
  lines.push("", "## Pendientes", "")
  if (pendientes.length === 0) lines.push("Ninguno.")
  for (const o of pendientes) lines.push(`- ${o.item} (fila ${o.row}): ${o.detail}`)
  return `${lines.join("\n")}\n`
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Falta el valor de ${flag}.`)
  return value
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const pautaConfirmada = argv.includes("--pauta-confirmada")
  const file = argValue(argv, "--file")
  const actorEmail = argValue(argv, "--actor-email")
  const declaredByEmail = argValue(argv, "--declarada-por")
  const reportPath = argValue(argv, "--report")
  const formsOrigin = argv.includes("--origen-formularios")
  const only = (argValue(argv, "--solo") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  if (!file) throw new Error("Falta --file <planilla.xlsx>.")
  if (!actorEmail) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  if (!declaredByEmail) throw new Error("Falta --declarada-por <correo>: quién declara la preventiva (el Jefe de Mantención).")
  if (apply && !pautaConfirmada) throw new Error(PAUTA_REQUIRED_ERROR)
  console.log(`Lecturas y preventivas declaradas — ${apply ? "escribiendo" : "simulación (no escribe)"}`)
  const report = await applyTrinormaLecturasPreventivas({ bytes: readFileSync(file), fileName: file, actorEmail, declaredByEmail, pautaConfirmada, apply, formsOrigin, only })
  printLecturasReport(report)
  if (reportPath) {
    writeFileSync(reportPath, renderLecturasReportMarkdown(report), "utf8")
    console.log(`Informe escrito en ${reportPath}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
