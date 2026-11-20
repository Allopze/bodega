import { hourKeyId, shiftHourKeys } from "./hours"
import type { ShiftInput } from "./types"

/** Un turno tal como está en la página original «Ralentí Cholguán». */
export interface RalentiShiftDoc {
  id: string
  equipo: string
  fecha: string
  ini: number
  fin: number
  operador: string
  obs?: string
  actualizado?: string
}

export interface ShiftImportCatalog {
  vehicles: Array<{ id: string; code: string }>
  workers: Array<{ id: string; firstName: string; lastName: string }>
  existingImportRefs: Set<string>
}

export type PlannedShiftRow = ShiftInput & { importRef: string; operatorName: string }

export interface ShiftImportPlan {
  rows: PlannedShiftRow[]
  errors: string[]
  operatorOverlaps: string[]
  alreadyImported: number
}

export const IMPORT_NOTE = "Importado de Ralentí Cholguán"

/** Sin tildes, sin mayúsculas y con los espacios normalizados. */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
}

function tokens(value: string): string[] {
  const normalized = normalizeName(value)
  return normalized ? normalized.split(" ") : []
}

/**
 * Un operador «Nombre Apellido» calza con un trabajador si su nombre completo es igual,
 * o si su primer token es el primer nombre y el resto es el comienzo de los apellidos:
 * «Jose Briceño» ↔ José Ignacio / Briceño Soto, y «Carlos San Martin» ↔ Carlos Hernán /
 * San Martín Valeria (apellido compuesto: comparar sólo el último token no calzaría).
 */
function workerMatches(operator: string, worker: { firstName: string; lastName: string }): boolean {
  const operatorTokens = tokens(operator)
  if (operatorTokens.length === 0) return false
  if (operatorTokens.join(" ") === normalizeName(`${worker.firstName} ${worker.lastName}`)) return true
  if (operatorTokens.length < 2) return false
  const firstName = tokens(worker.firstName)[0]
  const lastNameTokens = tokens(worker.lastName)
  const surname = operatorTokens.slice(1)
  return operatorTokens[0] === firstName
    && surname.length <= lastNameTokens.length
    && surname.every((token, index) => lastNameTokens[index] === token)
}

function isHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function ddmm(plainDate: string): string {
  return `${plainDate.slice(8, 10)}-${plainDate.slice(5, 7)}`
}

interface Planned {
  row: PlannedShiftRow
  operatorLabel: string
  code: string
}

export function planShiftImport(docs: RalentiShiftDoc[], catalog: ShiftImportCatalog): ShiftImportPlan {
  const vehicleByCode = new Map<string, { id: string; code: string }>()
  for (const vehicle of catalog.vehicles) {
    const key = vehicle.code.trim().toLowerCase()
    if (key && !vehicleByCode.has(key)) vehicleByCode.set(key, vehicle)
  }

  const errors: string[] = []
  // Un equipo u operador que no calza se informa una vez, no una por cada turno suyo.
  const reportedOnce = new Set<string>()
  const reportOnce = (key: string, message: string) => {
    if (reportedOnce.has(key)) return
    reportedOnce.add(key)
    errors.push(message)
  }
  const operatorCache = new Map<string, { worker?: ShiftImportCatalog["workers"][number]; error?: string }>()
  const resolveOperator = (operator: string) => {
    const key = normalizeName(operator)
    const cached = operatorCache.get(key)
    if (cached) return cached
    const candidates = catalog.workers.filter((worker) => workerMatches(operator, worker))
    const label = operator.trim().replace(/\s+/g, " ")
    const result = candidates.length === 1
      ? { worker: candidates[0] }
      : {
          error: candidates.length === 0
            ? `Operador «${label}»: no calza con ningún trabajador activo.`
            : `Operador «${label}»: calza con más de un trabajador (${candidates.map((worker) => `${worker.firstName} ${worker.lastName}`).join("; ")}).`,
        }
    operatorCache.set(key, result)
    return result
  }

  const planned: Planned[] = []
  const seenRefs = new Set<string>()
  let alreadyImported = 0

  for (const doc of docs) {
    const importRef = `ralenti:${doc.id}`
    if (catalog.existingImportRefs.has(importRef)) {
      alreadyImported += 1
      continue
    }
    if (seenRefs.has(importRef)) {
      errors.push(`Turno ${doc.id}: el id aparece más de una vez en el archivo.`)
      continue
    }
    seenRefs.add(importRef)

    const docErrors: string[] = []
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.fecha ?? "")) docErrors.push(`Turno ${doc.id}: la fecha «${doc.fecha}» no es AAAA-MM-DD.`)
    if (!isHour(doc.ini) || !isHour(doc.fin)) docErrors.push(`Turno ${doc.id}: las horas ${doc.ini}–${doc.fin} deben ser enteros de 0 a 23.`)
    else if (doc.ini === doc.fin) docErrors.push(`Turno ${doc.id}: el inicio y el fin son la misma hora (${doc.ini}).`)

    const equipo = (doc.equipo ?? "").trim()
    const vehicle = vehicleByCode.get(equipo.toLowerCase())
    if (!vehicle) reportOnce(`equipo:${equipo.toLowerCase()}`, `Equipo «${equipo}»: no existe en la flota (turno ${doc.id}).`)

    const operator = resolveOperator(doc.operador ?? "")
    if (operator.error) reportOnce(`operador:${normalizeName(doc.operador ?? "")}`, operator.error)

    errors.push(...docErrors)
    if (docErrors.length > 0 || !vehicle || !operator.worker) continue

    const obs = (doc.obs ?? "").trim()
    planned.push({
      operatorLabel: doc.operador.trim().replace(/\s+/g, " "),
      code: vehicle.code,
      row: {
        vehicleId: vehicle.id,
        shiftDate: doc.fecha,
        startHour: doc.ini,
        endHour: doc.fin,
        operatorWorkerId: operator.worker.id,
        notes: obs ? `${IMPORT_NOTE} · ${obs}` : IMPORT_NOTE,
        importRef,
        operatorName: `${operator.worker.firstName} ${operator.worker.lastName}`,
      },
    })
  }

  return { rows: planned.map((item) => item.row), errors, operatorOverlaps: findOperatorOverlaps(planned), alreadyImported }
}

function describeShift(item: Planned): string {
  return `${ddmm(item.row.shiftDate)} ${item.code} ${pad(item.row.startHour)}–${pad(item.row.endHour)}`
}

function findOperatorOverlaps(planned: Planned[]): string[] {
  const byOperator = new Map<string, Planned[]>()
  for (const item of planned) {
    byOperator.set(item.row.operatorWorkerId, [...(byOperator.get(item.row.operatorWorkerId) ?? []), item])
  }
  const overlaps: string[] = []
  for (const items of byOperator.values()) {
    const sorted = [...items].sort((a, b) =>
      a.row.shiftDate.localeCompare(b.row.shiftDate) || a.row.startHour - b.row.startHour || a.code.localeCompare(b.code))
    const hours = sorted.map((item) => new Set(shiftHourKeys(item.row).map(hourKeyId)))
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if ([...hours[j]!].some((key) => hours[i]!.has(key))) {
          overlaps.push(`${sorted[i]!.operatorLabel}: ${describeShift(sorted[i]!)} y ${describeShift(sorted[j]!)}`)
        }
      }
    }
  }
  return overlaps
}
