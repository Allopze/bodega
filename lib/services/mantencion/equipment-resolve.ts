import { and, count, eq, isNull } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantBrands, mantEquipmentProfiles, mantRecords, mantSchedules, worksites,
} from "@/db/schema"
import { unitName } from "@/lib/mantencion/format"
import { cleanName, findByNameKey, nameKey, normalizeCode, normalizePlate, resolvePlate } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import { codeYear, todayInChile } from "@/lib/utils"
import { unitFromMeter } from "./fleet"
import type { EquipmentFields } from "./equipment-history"

/**
 * Validación y resolución de un equipo (§10, reglas 16 y 17). Es lo mismo para
 * el formulario de la ficha y para cada fila de la importación: una sola
 * definición de «equipo válido». `equipment.ts` escribe lo que esto resuelve.
 */

type Reader = Pick<Tx, "select">

/** Valor del selector de faena que significa «escribir una faena nueva». */
export const NEW_WORKSITE = "__new__"

/** Lo que el formulario (o una fila de la planilla) dice del equipo. */
export interface EquipmentInput {
  code: string
  plate: string
  noPlate: boolean
  equipmentTypeId: string
  brandId: string
  model: string
  year: number | null
  /** Id de una faena, o `NEW_WORKSITE` con el nombre en `newWorksiteName`. */
  worksiteId: string
  newWorksiteName: string
  scheduleId: string | null
  initialReading: number | null
  initialReadingDate: string | null
}

export type FieldErrors = Record<string, string>

export type EquipmentResult<T> =
  | { ok: true; data: T; message?: string }
  | { ok: false; message: string; fieldErrors: FieldErrors }

export function equipmentFailure(fieldErrors: FieldErrors, message?: string): { ok: false; message: string; fieldErrors: FieldErrors } {
  const first = Object.values(fieldErrors)[0]
  return { ok: false, message: message ?? first ?? "Revisa los campos marcados.", fieldErrors }
}

export interface VehicleIdentity {
  id: string
  code: string | null
  plate: string
  isActive: boolean
  hasProfile: boolean
  /** Faena y tipo que tiene hoy en la flota: la importación no los cambia (decisión 2026-11-11). */
  worksiteId: string | null
  equipmentTypeId: string | null
  /** Modelo y año de la flota: una fila que los deja en blanco los conserva al incorporar. */
  model?: string | null
  year?: number | null
}

export interface ResolvedEquipment {
  code: string
  plate: string
  noPlate: boolean
  type: { id: string; slug: string; name: string; unit: MantUnit; meterType: string; performanceUnit: string }
  brand: { id: string; name: string }
  model: string | null
  year: number | null
  /** `id` nulo: faena nueva que aún no se crea (vista previa de una importación). */
  worksite: { id: string | null; name: string }
  schedule: { id: string; name: string } | null
  initialReading: number | null
  initialReadingDate: string | null
  fields: EquipmentFields
}

/** La ficha tal como está hoy (edición) y los hechos que fijan sus reglas. */
export interface EquipmentCurrent {
  vehicleId: string
  /** Faena actual del vehículo: el alcance de ORIGEN que se exige al editarlo. */
  worksiteId: string
  equipmentTypeId: string
  active: boolean
  retiredReason: string | null
  unit: MantUnit
  recordCount: number
  /** Marca del perfil (lista cerrada): la conserva el padrón cuando quien edita no administra Mantención. */
  brandId: string
  /** Pauta vigente; `null` sin pauta o si la que tenía se eliminó. */
  scheduleId: string | null
  fields: EquipmentFields
  /** Quién declaró la preventiva anterior a la plataforma y de dónde salió (para la bitácora). */
  priorPreventiveDeclaredBy: string | null
  priorPreventiveSource: string | null
  /** Última modificación del perfil: el formulario la devuelve para no pisar una edición concurrente. */
  profileUpdatedAt: string
}

export interface EquipmentCatalogs {
  types: Array<{ id: string; slug: string; name: string; isActive: boolean; unit: MantUnit | null; meterType: string; performanceUnit: string }>
  brands: Array<{ id: string; name: string; isActive: boolean }>
  schedules: Array<{ id: string; name: string; unit: MantUnit }>
  worksites: Array<{ id: string; name: string; isActive: boolean }>
  /** Toda la flota (con y sin perfil): código y patente son únicos entre todos. */
  identities: VehicleIdentity[]
}

/**
 * Catálogos y flota en memoria. Una importación los carga una vez y los va
 * actualizando fila a fila, de modo que dos filas del mismo archivo con el
 * mismo código o patente chocan igual que dos altas seguidas.
 */
/** Las pautas vigentes (sin las eliminadas), con su unidad. */
export async function loadScheduleCatalog(client: Reader): Promise<EquipmentCatalogs["schedules"]> {
  const rows = await client.select({ id: mantSchedules.id, name: mantSchedules.name, unit: mantSchedules.unit }).from(mantSchedules).where(isNull(mantSchedules.deletedAt))
  return rows.map((row) => ({ ...row, unit: row.unit as MantUnit }))
}

export async function loadEquipmentCatalogs(client: Reader): Promise<EquipmentCatalogs> {
  const [types, brands, schedules, sites, vehicles] = await Promise.all([
    client.select().from(fuelEquipmentTypes),
    client.select({ id: mantBrands.id, name: mantBrands.name, isActive: mantBrands.isActive }).from(mantBrands),
    loadScheduleCatalog(client),
    client.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites),
    client
      .select({
        id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, isActive: fuelVehicles.isActive,
        worksiteId: fuelVehicles.worksiteId, equipmentTypeId: fuelVehicles.equipmentTypeId, profile: mantEquipmentProfiles.vehicleId,
        model: fuelVehicles.model, year: fuelVehicles.year,
      })
      .from(fuelVehicles)
      .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id)),
  ])
  return {
    types: types.map((row) => ({
      id: row.id, slug: row.slug, name: row.name, isActive: row.isActive,
      unit: unitFromMeter(row.defaultMeterType), meterType: row.defaultMeterType, performanceUnit: row.defaultPerformanceUnit,
    })),
    brands,
    schedules,
    worksites: sites,
    identities: vehicles.map((row) => ({
      id: row.id, code: row.code, plate: row.plate, isActive: row.isActive, hasProfile: row.profile !== null,
      worksiteId: row.worksiteId, equipmentTypeId: row.equipmentTypeId, model: row.model, year: row.year,
    })),
  }
}

const plateKey = (plate: string) => normalizePlate(plate) ?? normalizeCode(plate)

export function identityLabel(identity: VehicleIdentity): string {
  return identity.code ?? identity.plate
}

/** Equipo de mantención (con perfil) cuyo código normalizado coincide. */
export function findIdentityByCode(identities: readonly VehicleIdentity[], code: string): VehicleIdentity | null {
  const key = normalizeCode(code)
  return key ? identities.find((item) => item.code !== null && normalizeCode(item.code) === key) ?? null : null
}

/** Cuenta los registros del equipo (cualquier estado): fijan su unidad y su lectura inicial. */
export async function countEquipmentRecords(vehicleId: string, client: Reader = db): Promise<number> {
  const [row] = await client.select({ n: count() }).from(mantRecords).where(eq(mantRecords.vehicleId, vehicleId))
  return row?.n ?? 0
}

/** Si el vehículo de la flota ya tiene ficha de mantención (perfil). La ficha de Flota
 *  enlaza a la de Mantención sólo entonces: `/mantencion/equipos/[id]` da 404 sin perfil. */
export async function hasMaintenanceProfile(vehicleId: string, client: Reader = db): Promise<boolean> {
  const [row] = await client.select({ id: mantEquipmentProfiles.vehicleId }).from(mantEquipmentProfiles)
    .where(eq(mantEquipmentProfiles.vehicleId, vehicleId)).limit(1)
  return Boolean(row)
}

/** La ficha actual de uno (con `vehicleId`) o de todos los equipos con perfil de mantención. */
export async function loadEquipmentCurrents(client: Reader, vehicleId?: string): Promise<EquipmentCurrent[]> {
  const rows = await client
    .select({
      vehicleId: mantEquipmentProfiles.vehicleId,
      worksiteId: fuelVehicles.worksiteId,
      equipmentTypeId: fuelVehicles.equipmentTypeId,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      model: fuelVehicles.model,
      year: fuelVehicles.year,
      isActive: fuelVehicles.isActive,
      typeName: fuelEquipmentTypes.name,
      meterType: fuelEquipmentTypes.defaultMeterType,
      brandName: mantBrands.name,
      worksiteName: worksites.name,
      scheduleName: mantSchedules.name,
      noPlate: mantEquipmentProfiles.noPlate,
      brandId: mantEquipmentProfiles.brandId,
      scheduleId: mantSchedules.id,
      retiredReason: mantEquipmentProfiles.retiredReason,
      initialReading: mantEquipmentProfiles.initialReading,
      initialReadingDate: mantEquipmentProfiles.initialReadingDate,
      priorPreventiveDate: mantEquipmentProfiles.priorPreventiveDate,
      priorPreventiveReading: mantEquipmentProfiles.priorPreventiveReading,
      priorPreventiveInterval: mantEquipmentProfiles.priorPreventiveInterval,
      priorPreventiveEvidence: mantEquipmentProfiles.priorPreventiveEvidence,
      priorPreventiveDeclaredBy: mantEquipmentProfiles.priorPreventiveDeclaredBy,
      priorPreventiveSource: mantEquipmentProfiles.priorPreventiveSource,
      profileUpdatedAt: mantEquipmentProfiles.updatedAt,
    })
    .from(mantEquipmentProfiles)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(mantBrands, eq(mantBrands.id, mantEquipmentProfiles.brandId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .leftJoin(mantSchedules, and(eq(mantSchedules.id, mantEquipmentProfiles.scheduleId), isNull(mantSchedules.deletedAt)))
    .where(vehicleId ? eq(mantEquipmentProfiles.vehicleId, vehicleId) : undefined)
  const withRecords = new Map<string, number>()
  const recordRows = await client
    .select({ vehicleId: mantRecords.vehicleId, n: count() })
    .from(mantRecords)
    .where(vehicleId ? eq(mantRecords.vehicleId, vehicleId) : undefined)
    .groupBy(mantRecords.vehicleId)
  for (const row of recordRows) withRecords.set(row.vehicleId, row.n)

  const currents: EquipmentCurrent[] = []
  for (const row of rows) {
    const unit = unitFromMeter(row.meterType)
    if (!unit) continue
    currents.push({
      vehicleId: row.vehicleId,
      worksiteId: row.worksiteId,
      equipmentTypeId: row.equipmentTypeId,
      active: row.isActive,
      retiredReason: row.retiredReason,
      unit,
      recordCount: withRecords.get(row.vehicleId) ?? 0,
      brandId: row.brandId,
      scheduleId: row.scheduleId,
      fields: {
        code: row.code ?? row.plate,
        plate: row.plate,
        noPlate: row.noPlate,
        type: row.typeName,
        brand: row.brandName,
        model: row.model?.trim() || null,
        year: row.year,
        worksite: row.worksiteName,
        schedule: row.scheduleName,
        initialReading: row.initialReading,
        initialReadingDate: row.initialReadingDate,
        priorPreventiveDate: row.priorPreventiveDate,
        priorPreventiveReading: row.priorPreventiveReading,
        priorPreventiveInterval: row.priorPreventiveInterval,
        priorPreventiveEvidence: row.priorPreventiveEvidence,
      },
      priorPreventiveDeclaredBy: row.priorPreventiveDeclaredBy,
      priorPreventiveSource: row.priorPreventiveSource,
      profileUpdatedAt: row.profileUpdatedAt,
    })
  }
  return currents
}

export async function loadEquipmentCurrent(client: Reader, vehicleId: string): Promise<EquipmentCurrent | null> {
  return (await loadEquipmentCurrents(client, vehicleId))[0] ?? null
}

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isRealDate(value: string): boolean {
  const match = PLAIN_DATE.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export interface ResolveOptions {
  /** Equipo que se edita; `null` en el alta. */
  current: EquipmentCurrent | null
  /** Catálogos ya cargados (importación); sin ellos se leen de la base. */
  catalogs?: EquipmentCatalogs
  /**
   * Crea la faena nueva (alta o confirmación de una importación). Sin esto sólo
   * se valida: la vista previa de una importación no escribe nada.
   */
  createWorksite?: (name: string) => Promise<{ id: string; name: string }>
  /**
   * Faena que el equipo YA tiene: se acepta aunque esté inactiva. Sin esto, un
   * equipo de una faena desactivada no se podía editar en nada (auditoría I-3).
   */
  keepWorksiteId?: string | null
  /**
   * Tipo y marca que el equipo YA tiene: se aceptan aunque se hayan desactivado. Los pasa el
   * padrón (crítica 2026-11-15, paso 4b): quien corrige un SOAP no puede quedar trabado por
   * una marca que otro dio de baja en el catálogo y que, sin `mant:equipment:manage`, ni
   * siquiera puede cambiar.
   */
  keepEquipmentTypeId?: string | null
  keepBrandId?: string | null
  /**
   * Importación: si el equipo ya tiene registros y la fila trae otra lectura
   * inicial, se conserva la actual con un aviso en vez de rechazar toda la fila
   * (la planilla real traía 45 filas así; 2026-11-11). El formulario no lo usa.
   */
  ignoreLockedInitialReading?: boolean
}

/** Lo que es de Mantención en la ficha del equipo: su pauta, su lectura inicial y la preventiva declarada. */
export interface EquipmentPlanInput {
  scheduleId: string | null
  initialReading: number | null
  initialReadingDate: string | null
  /**
   * Preventiva anterior a la plataforma: `undefined` = no viene (se conserva la guardada);
   * `null` o todo vacío = se borra. Quién la declaró y de dónde salió van a la ficha y a la bitácora.
   */
  priorPreventive?: (PriorPreventiveInput & { declaredBy?: string | null; source?: string | null }) | null
  /** `profileUpdatedAt` que vio el formulario; si la ficha cambió después, no se guarda (edición concurrente). */
  expectedUpdatedAt?: string | null
}

export interface PriorPreventiveInput {
  date: string | null
  reading: number | null
  intervalValue: number | null
  evidence: string | null
}

export interface ResolvedPriorPreventive {
  date: string
  reading: number
  intervalValue: number
  evidence: string
}

/** Textos de relleno que no son un respaldo, aunque no estén vacíos. */
const EVIDENCE_PLACEHOLDERS = new Set(["-", "--", "?", "x", "no", "na", "n/a", "s/r", "sr", "s/n", "sin", "sin respaldo", "no tiene", "pendiente", "ninguno", "nada"])

/**
 * ¿El respaldo es una referencia verificable? Un número de orden de trabajo o de factura siempre
 * lleva un número: sin dígitos, o si es un relleno conocido («S/R», «N/A», «-»…), no sirve.
 */
export function isEvidenceReference(text: string | null | undefined): boolean {
  const value = (text ?? "").trim()
  if (!value || EVIDENCE_PLACEHOLDERS.has(value.toLowerCase())) return false
  return /\d/.test(value)
}

export const EVIDENCE_REFERENCE_MESSAGE = "El respaldo tiene que ser un número de orden de trabajo o de factura (por ejemplo, «OT 35513» o «Factura 9876»)."

/**
 * La última preventiva anterior a la plataforma, DECLARADA por jefatura con su respaldo (Trinorma,
 * decisión del usuario del 2026-11-21, opción A). Reglas del servidor, no sólo del formulario:
 * - van las cuatro: fecha, lectura, servicio de la pauta y respaldo (orden de trabajo o factura);
 * - necesita la lectura inicial: la fecha no puede ser posterior a la de esa lectura ni futura, y la
 *   lectura no puede pasar de la inicial;
 * - el servicio tiene que existir en la pauta vigente del equipo.
 * Todo vacío = borrarla.
 */
export function resolvePriorPreventive(
  input: PriorPreventiveInput,
  plan: {
    initialReading: number | null
    initialReadingDate: string | null
    hasSchedule: boolean
    intervals: readonly number[]
    /** El servicio de la declaración guardada: sigue valiendo aunque la pauta se haya republicado sin él. */
    storedInterval?: number | null
  },
  today: string,
): { value: ResolvedPriorPreventive | null; errors: FieldErrors } {
  const errors: FieldErrors = {}
  const evidence = input.evidence?.trim() ?? ""
  if (!input.date && input.reading === null && input.intervalValue === null && !evidence) return { value: null, errors }

  if (!input.date) errors.priorPreventiveDate = "Indica la fecha de la preventiva."
  else if (!isRealDate(input.date)) errors.priorPreventiveDate = "La fecha de la preventiva no es válida."
  else if (input.date > today) errors.priorPreventiveDate = "La fecha de la preventiva no puede ser futura."
  if (input.reading === null) errors.priorPreventiveReading = "Indica la lectura de la preventiva."
  else if (!Number.isFinite(input.reading) || input.reading < 0 || input.reading > 99_999_999) {
    errors.priorPreventiveReading = "Escribe una lectura válida: un número que no sea negativo."
  }
  if (input.intervalValue === null) errors.priorPreventiveInterval = "Indica qué servicio de la pauta fue."
  if (!evidence) errors.priorPreventiveEvidence = "Indica el respaldo: número de orden de trabajo o de factura."
  else if (evidence.length > 120) errors.priorPreventiveEvidence = "El respaldo es demasiado largo (máximo 120 caracteres)."
  else if (!isEvidenceReference(evidence)) errors.priorPreventiveEvidence = EVIDENCE_REFERENCE_MESSAGE

  if (plan.initialReading === null || !plan.initialReadingDate) {
    errors.priorPreventiveDate ??= "Primero indica la lectura inicial: la preventiva declarada no puede ser posterior a ella."
  } else {
    if (!errors.priorPreventiveDate && input.date && input.date > plan.initialReadingDate) {
      errors.priorPreventiveDate = `La fecha de la preventiva no puede ser posterior a la de la lectura inicial (${plan.initialReadingDate}).`
    }
    if (!errors.priorPreventiveReading && input.reading !== null && input.reading > plan.initialReading) {
      errors.priorPreventiveReading = `La lectura de la preventiva no puede ser mayor que la lectura inicial (${plan.initialReading}).`
    }
  }
  if (!plan.hasSchedule) errors.priorPreventiveInterval ??= "Asigna una pauta: el servicio tiene que existir en ella."
  else if (input.intervalValue !== null && !plan.intervals.includes(input.intervalValue) && input.intervalValue !== plan.storedInterval) {
    errors.priorPreventiveInterval = `Ese servicio no existe en la pauta del equipo (${plan.intervals.join(", ")}).`
  }
  if (Object.keys(errors).length > 0) return { value: null, errors }
  return { value: { date: input.date as string, reading: input.reading as number, intervalValue: input.intervalValue as number, evidence }, errors }
}

export interface ResolvedEquipmentPlan {
  schedule: { id: string; name: string } | null
  initialReading: number | null
  initialReadingDate: string | null
}

/**
 * Pauta y lectura inicial (§10). Una sola definición para el alta y la importación —dentro de
 * `resolveEquipment`— y para «Editar mantención», que sólo cambia esto (crítica 2026-11-15, paso
 * 4b). La pauta tiene que medirse en la unidad del equipo; con registros, la lectura inicial
 * queda fija porque el cálculo de lecturas la usa como piso.
 */
export function resolveEquipmentPlan(
  schedules: EquipmentCatalogs["schedules"],
  input: EquipmentPlanInput,
  /** Unidad del equipo; `null` si su tipo todavía no se resolvió (el error ya está en el tipo). */
  unit: MantUnit | null,
  current: EquipmentCurrent | null,
  options: {
    today: string
    ignoreLockedInitialReading?: boolean
    /**
     * Revisa la lectura inicial contra la preventiva declarada GUARDADA (por defecto sí). Sólo lo
     * apaga «Editar mantención» cuando trae una declaración nueva, que se valida aparte.
     */
    checkStoredPrior?: boolean
  },
): { value: ResolvedEquipmentPlan; errors: FieldErrors; notices: string[] } {
  const errors: FieldErrors = {}
  const notices: string[] = []
  const { today } = options

  let schedule: ResolvedEquipmentPlan["schedule"] = null
  if (input.scheduleId) {
    const row = schedules.find((item) => item.id === input.scheduleId)
    if (!row) errors.scheduleId = "Esa pauta no existe."
    else if (unit && row.unit !== unit) {
      errors.scheduleId = `Esa pauta se mide en ${unitName(row.unit)} y el equipo en ${unitName(unit)}.`
    } else schedule = { id: row.id, name: row.name }
  }

  let initialReading = input.initialReading
  let initialReadingDate = input.initialReadingDate
  if (initialReading !== null && (!Number.isFinite(initialReading) || initialReading < 0 || initialReading > 99_999_999)) {
    errors.initialReading = "Escribe una lectura válida: un número que no sea negativo."
  }
  if (current && current.recordCount > 0) {
    if ((initialReading ?? null) !== current.fields.initialReading) {
      if (options.ignoreLockedInitialReading) notices.push("La lectura inicial no se cambia: el equipo ya tiene registros. Se conserva la actual.")
      else errors.initialReading = "La lectura inicial no se puede cambiar: el equipo ya tiene registros."
    }
    initialReading = current.fields.initialReading
    initialReadingDate = current.fields.initialReadingDate
  } else if (initialReading === null) {
    initialReadingDate = null
  } else if (!initialReadingDate) {
    initialReadingDate = current && current.fields.initialReading === initialReading && current.fields.initialReadingDate
      ? current.fields.initialReadingDate
      : today
  } else if (!isRealDate(initialReadingDate)) {
    errors.initialReadingDate = "La fecha de la lectura no es válida."
  } else if (initialReadingDate > today) {
    errors.initialReadingDate = "La fecha de la lectura no puede ser futura."
  }

  // La declarada no puede quedar después de la lectura inicial ni por encima de ella, venga el cambio
  // de donde venga (formulario, importación de equipos).
  const priorDate = current?.fields.priorPreventiveDate ?? null
  const priorReading = current?.fields.priorPreventiveReading ?? null
  if ((options.checkStoredPrior ?? true) && priorDate && priorReading !== null && !errors.initialReading && !errors.initialReadingDate) {
    if (initialReading === null) {
      errors.initialReading = "No se puede quitar la lectura inicial: el equipo tiene una preventiva declarada. Bórrala primero."
    } else {
      if (initialReading < priorReading) errors.initialReading = `La lectura inicial no puede ser menor que la de la preventiva declarada (${priorReading}).`
      if (initialReadingDate && initialReadingDate < priorDate) errors.initialReadingDate = `La fecha de la lectura inicial no puede ser anterior a la de la preventiva declarada (${priorDate}).`
    }
  }

  return { value: { schedule, initialReading, initialReadingDate }, errors, notices }
}

/**
 * Valida y resuelve un equipo contra el catálogo y la flota. Devuelve TODOS los
 * errores por campo de una vez, no el primero.
 */
export async function resolveEquipment(
  client: Reader,
  input: EquipmentInput,
  options: ResolveOptions,
): Promise<{ ok: true; value: ResolvedEquipment; incorporate: VehicleIdentity | null; notices: string[] } | { ok: false; fieldErrors: FieldErrors }> {
  const errors: FieldErrors = {}
  /** Avisos que no impiden guardar (sólo con `ignoreLockedInitialReading`). */
  const notices: string[] = []
  const { current } = options
  const catalogs = options.catalogs ?? await loadEquipmentCatalogs(client)
  const today = todayInChile()

  const code = normalizeCode(input.code)
  if (!code) errors.code = "Escribe el código interno."
  else if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) errors.code = "Usa letras, números y guion (por ejemplo, KA-147)."

  const plateResult = resolvePlate(input.plate, code, input.noPlate)
  if (!plateResult.ok) errors.plate = plateResult.message

  let type: ResolvedEquipment["type"] | null = null
  if (!input.equipmentTypeId) errors.equipmentTypeId = "Elige el tipo de equipo."
  else {
    const row = catalogs.types.find((item) => item.id === input.equipmentTypeId)
    const keeping = !!row && row.id === options.keepEquipmentTypeId
    if (!row || (!row.isActive && !keeping)) errors.equipmentTypeId = "Ese tipo de equipo no existe o está inactivo."
    else if (!row.unit) errors.equipmentTypeId = `«${row.name}» no se mide en kilómetros ni en horas.`
    else type = { id: row.id, slug: row.slug, name: row.name, unit: row.unit, meterType: row.meterType, performanceUnit: row.performanceUnit }
  }
  if (type && current && current.recordCount > 0 && type.unit !== current.unit) {
    errors.equipmentTypeId = "No se puede cambiar a otra unidad: el equipo ya tiene registros."
  }

  let brand: ResolvedEquipment["brand"] | null = null
  if (!input.brandId) errors.brandId = "Elige la marca de la lista."
  else {
    const row = catalogs.brands.find((item) => item.id === input.brandId)
    const keeping = !!row && row.id === options.keepBrandId
    if (!row || (!row.isActive && !keeping)) errors.brandId = "Esa marca no está en la lista."
    else brand = { id: row.id, name: row.name }
  }

  const model = cleanName(input.model)
  if (model.length > 80) errors.model = "El modelo es demasiado largo (máximo 80 caracteres)."
  if (input.year !== null && (!Number.isInteger(input.year) || input.year < 1950 || input.year > codeYear() + 1)) {
    errors.year = "Año no válido."
  }

  const plan = resolveEquipmentPlan(catalogs.schedules, input, type?.unit ?? null, current, {
    today, ignoreLockedInitialReading: options.ignoreLockedInitialReading,
  })
  Object.assign(errors, plan.errors)
  notices.push(...plan.notices)
  const { schedule, initialReading, initialReadingDate } = plan.value

  // Faena existente, o nueva (regla 17: coincide normalizada → se usa la existente).
  let worksiteName: string | null = null
  let worksiteId: string | null = null
  let newWorksiteName: string | null = null
  if (input.worksiteId === NEW_WORKSITE) {
    const typed = cleanName(input.newWorksiteName)
    if (!typed) errors.worksiteId = "Escribe el nombre de la faena nueva."
    else if (typed.length > 80) errors.worksiteId = "El nombre de la faena es demasiado largo (máximo 80 caracteres)."
    else {
      const existing = findByNameKey(catalogs.worksites, typed)
      if (existing && !existing.isActive) errors.worksiteId = inactiveWorksiteMessage(existing.name, catalogs.worksites)
      else if (existing) { worksiteId = existing.id; worksiteName = existing.name }
      else newWorksiteName = typed
    }
  } else if (!input.worksiteId) errors.worksiteId = "Elige la faena."
  else {
    const row = catalogs.worksites.find((item) => item.id === input.worksiteId)
    const keeping = !!row && row.id === options.keepWorksiteId
    if (!row || (!row.isActive && !keeping)) errors.worksiteId = "Esa faena no existe o está inactiva."
    else { worksiteId = row.id; worksiteName = row.name }
  }

  // Identidad: código único normalizado (D3) y patente única (regla 16).
  const selfId = current?.vehicleId ?? null
  const others = catalogs.identities.filter((item) => item.id !== selfId)
  const codeHits = code ? others.filter((item) => item.code !== null && normalizeCode(item.code) === code) : []
  const plateText = plateResult.ok ? plateResult.plate : ""
  const plateHits = plateResult.ok ? others.filter((item) => plateKey(item.plate) === plateText) : []
  let incorporate: VehicleIdentity | null = null
  if (selfId) {
    if (codeHits.length) errors.code = `Ya existe un equipo con el código ${code}.`
    if (plateHits.length) errors.plate = `La patente ${plateText} ya está en el equipo ${identityLabel(plateHits[0]!)}.`
  } else {
    if (codeHits.length > 1) errors.code = `El código ${code} está repetido en la flota: corrígelo en Vehículos antes de agregarlo.`
    if (plateHits.length > 1) errors.plate = `La patente ${plateText} está repetida en la flota: corrígela en Vehículos antes de agregarla.`
    const candidate = codeHits[0] ?? plateHits[0] ?? null
    if (candidate) {
      if (candidate.hasProfile) {
        if (codeHits.length) errors.code = `Ya existe un equipo con el código ${code}.`
        else errors.plate = `La patente ${plateText} ya está en el equipo ${identityLabel(candidate)}.`
      } else if (!candidate.isActive) {
        errors.code = `El vehículo ${identityLabel(candidate)} está inactivo en la flota: reactívalo en Vehículos antes de agregarlo a la mantención.`
      } else incorporate = candidate
      // Si el código apunta a un vehículo y la patente a otro, no hay a quién incorporar.
      const stray = plateHits.filter((item) => item.id !== candidate.id)
      if (stray.length) errors.plate = `La patente ${plateText} ya está en el equipo ${identityLabel(stray[0]!)}.`
    }
  }

  if (Object.keys(errors).length > 0 || !plateResult.ok || !type || !brand) return { ok: false, fieldErrors: errors }

  if (!worksiteId) {
    if (!options.createWorksite) worksiteName = newWorksiteName
    else {
      const created = await options.createWorksite(newWorksiteName ?? "")
      worksiteId = created.id
      worksiteName = created.name
      if (!catalogs.worksites.some((item) => item.id === created.id)) catalogs.worksites.push({ id: created.id, name: created.name, isActive: true })
    }
  }

  const value: ResolvedEquipment = {
    code,
    plate: plateResult.plate,
    noPlate: plateResult.noPlate,
    type,
    brand,
    model: model || null,
    year: input.year,
    worksite: { id: worksiteId, name: worksiteName ?? "" },
    schedule,
    initialReading,
    initialReadingDate,
    fields: {
      code,
      plate: plateResult.plate,
      noPlate: plateResult.noPlate,
      type: type.name,
      brand: brand.name,
      model: model || null,
      year: input.year,
      worksite: worksiteName ?? "",
      schedule: schedule?.name ?? null,
      initialReading,
      initialReadingDate,
    },
  }
  return { ok: true, value, incorporate, notices }
}

/**
 * «La faena X está inactiva», con la activa que probablemente la reemplazó si
 * hay exactamente una que empieza con la misma palabra (las faenas se
 * unificaron el 2026-11; la planilla real traía los nombres antiguos).
 */
function inactiveWorksiteMessage(name: string, all: EquipmentCatalogs["worksites"]): string {
  const first = nameKey(name).split(" ")[0] ?? ""
  const candidates = first.length >= 3 ? all.filter((item) => item.isActive && nameKey(item.name).split(" ")[0] === first) : []
  return candidates.length === 1
    ? `La faena «${name}» está inactiva. ¿Es «${candidates[0]!.name}»? Escribe esa.`
    : `La faena «${name}» existe pero está inactiva.`
}
