import { z } from "zod"
import type { DB, Tx } from "@/db"
import { fuelEquipmentTypes, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { cleanName, nameKey } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import {
  ensureCatalogEntries, findProbableWorkerMatches, MANT_CATALOG_KEYS, type MantCatalogKey,
} from "./catalogs"
import { seedEquipment, seedMechanics } from "./seed-equipment"
import { seedSchedules } from "./seed-schedules"
import { unitFromMeter } from "./fleet"
import { ensureFolioCode, resolveOrCreateWorksite } from "./worksites"

/**
 * Carga inicial del módulo de mantención (§13): faenas con folio, tipos de
 * equipo, catálogos, las dos pautas con su matriz y reglas por marca, los 120
 * equipos y los mecánicos. Todo es idempotente: correrla dos veces no cambia
 * nada la segunda vez, y sobre una flota que ya tiene equipos concilia por
 * código (y luego por patente) y REPORTA las diferencias sin pisar datos.
 *
 * La carga corre en UNA transacción: si algo falla no queda una mitad escrita.
 */

const unit = z.enum(["km", "h"])
const nonEmpty = z.string().trim().min(1)

const seedItem = z.object({
  clave: nonEmpty,
  nombre: nonEmpty,
  aplicaPorIntervalo: z.array(z.number().int().min(0).max(1)),
})

const seedSchedule = z.object({
  id: nonEmpty,
  nombre: nonEmpty,
  unidad: unit,
  intervalos: z.array(z.number().int().positive()).min(1),
  origen: z.string().optional(),
  grupos: z.array(z.object({ nombre: nonEmpty, items: z.array(seedItem).min(1) })).min(1),
  reglasPorMarca: z.object({
    marcas: z.array(nonEmpty),
    filas: z.array(z.object({ actividadPlanilla: nonEmpty, claveItem: z.string().nullable(), valores: z.string() })),
  }).nullish(), // la pauta de maquinaria no tiene reglas por marca (`null` en el archivo)
})

export const mantSeedDataSchema = z.object({
  faenas: z.array(z.object({ nombre: nonEmpty, codigoFolio: z.string().regex(/^[A-Z]{3}$/) })),
  tiposEquipo: z.array(z.object({ nombre: nonEmpty, unidad: unit })),
  marcasConReglas: z.array(nonEmpty),
  mecanicos: z.array(z.object({ nombre: nonEmpty, faena: nonEmpty })),
  talleresExternos: z.array(nonEmpty),
  conductores: z.array(nonEmpty),
  tiposTrabajo: z.array(nonEmpty),
  aceites: z.array(nonEmpty),
  pautas: z.array(seedSchedule).min(1),
  equipos: z.array(z.object({
    codigo: nonEmpty,
    patente: nonEmpty,
    tipo: nonEmpty,
    marca: nonEmpty,
    modelo: z.string(),
    anio: z.number().int().nullable(),
    faena: nonEmpty,
    unidad: unit,
    pautaId: nonEmpty,
  })),
})
export type MantSeedData = z.infer<typeof mantSeedDataSchema>

/** Lo que la especificación (§13) dice que trae la carga; una desviación se avisa, no se bloquea. */
const EXPECTED = { equipos: 120, talleres: 10, conductores: 27, mecanicos: 7, itemsPorPauta: { "p-camiones": 53, "p-maquinaria": 37 } } as const

export interface CountPair { created: number; existing: number }

export interface MantSeedReport {
  worksites: CountPair & { folioNotes: string[]; derivedFolio: string[] }
  equipmentTypes: CountPair & { problems: string[] }
  catalogs: Record<MantCatalogKey, CountPair>
  schedules: Array<{ name: string; unit: MantUnit; created: boolean; items: number; intervals: number; brandRules: number; version: number }>
  equipment: {
    created: number
    existing: number
    profilesCreated: number
    profilesExisting: number
    filledFromSeed: number
    skipped: Array<{ code: string; reason: string }>
    differences: Array<{ code: string; field: string; fleet: string; seed: string }>
  }
  driverMatches: Array<{ driver: string; workers: string[] }>
  mechanics: {
    linked: number
    alreadyLinked: number
    pending: Array<{ name: string; worksite: string; hasEmail: boolean; action: string }>
  }
  warnings: string[]
  /** Si esta corrida escribió algo. En la segunda corrida seguida es `false`. */
  changed: boolean
}

/** Estado compartido de una corrida: la transacción, el actor y el reporte que cada paso va llenando. */
export interface SeedContext {
  tx: Tx
  data: MantSeedData
  actorUserId: string | null
  report: MantSeedReport
}

export interface SeededType { id: string; name: string; unit: MantUnit; meterType: string; performanceUnit: string }
export type WorksiteMap = Map<string, { id: string; name: string }>

export function parseMantSeedData(raw: unknown): MantSeedData {
  const data = mantSeedDataSchema.parse(raw)
  const problems = validateSeedData(data)
  if (problems.length > 0) throw new Error(`El archivo de carga inicial es inconsistente:\n- ${problems.join("\n- ")}`)
  return data
}

/** Consistencia interna del archivo, antes de escribir nada. */
function validateSeedData(data: MantSeedData): string[] {
  const problems: string[] = []
  const typeNames = new Set(data.tiposEquipo.map((type) => nameKey(type.nombre)))
  const scheduleIds = new Set(data.pautas.map((schedule) => schedule.id))
  for (const schedule of data.pautas) {
    const keys = new Set<string>()
    for (const item of schedule.grupos.flatMap((group) => group.items)) {
      if (keys.has(item.clave)) problems.push(`Pauta ${schedule.id}: clave de ítem repetida ${item.clave}.`)
      keys.add(item.clave)
      if (item.aplicaPorIntervalo.length !== schedule.intervalos.length) {
        problems.push(`Pauta ${schedule.id}: «${item.nombre}» trae ${item.aplicaPorIntervalo.length} columnas y la pauta ${schedule.intervalos.length} intervalos.`)
      }
    }
    for (const row of schedule.reglasPorMarca?.filas ?? []) {
      if (row.valores.length !== schedule.reglasPorMarca!.marcas.length || !/^[AWX]+$/.test(row.valores)) {
        problems.push(`Pauta ${schedule.id}: valores inválidos en «${row.actividadPlanilla}».`)
      }
      if (row.claveItem && !keys.has(row.claveItem)) problems.push(`Pauta ${schedule.id}: «${row.actividadPlanilla}» apunta a un ítem que no existe (${row.claveItem}).`)
    }
  }
  const codes = new Set<string>()
  for (const equipo of data.equipos) {
    const code = equipo.codigo.toUpperCase().replace(/\s+/g, "")
    if (codes.has(code)) problems.push(`Equipo repetido en el archivo: ${code}.`)
    codes.add(code)
    if (!typeNames.has(nameKey(equipo.tipo))) problems.push(`${code}: tipo «${equipo.tipo}» no está en tiposEquipo.`)
    if (!scheduleIds.has(equipo.pautaId)) problems.push(`${code}: pauta ${equipo.pautaId} no existe.`)
  }
  return problems
}

function emptyReport(): MantSeedReport {
  const pair = (): CountPair => ({ created: 0, existing: 0 })
  return {
    worksites: { ...pair(), folioNotes: [], derivedFolio: [] },
    equipmentTypes: { ...pair(), problems: [] },
    catalogs: { brands: pair(), workshops: pair(), drivers: pair(), workTypes: pair(), oils: pair() },
    schedules: [],
    equipment: { created: 0, existing: 0, profilesCreated: 0, profilesExisting: 0, filledFromSeed: 0, skipped: [], differences: [] },
    driverMatches: [],
    mechanics: { linked: 0, alreadyLinked: 0, pending: [] },
    warnings: [],
    changed: false,
  }
}

export async function seedMantencion(
  client: DB,
  data: MantSeedData,
  options: { invitationEmails?: Record<string, string>; actorUserId?: string | null } = {},
): Promise<MantSeedReport> {
  const actorUserId = options.actorUserId ?? null
  return client.transaction(async (tx) => {
    const report = emptyReport()
    const ctx: SeedContext = { tx, data, actorUserId, report }
    warnOnUnexpectedCounts(ctx)

    const worksiteMap = await seedWorksites(ctx)
    const types = await seedEquipmentTypes(ctx)
    const catalogs = await seedCatalogs(ctx)
    const schedules = await seedSchedules(ctx, catalogs.brands)
    await seedEquipment(ctx, { types, brands: catalogs.brands, schedules, worksites: worksiteMap })
    report.driverMatches = await findProbableWorkerMatches(tx, data.conductores)
    await seedMechanics(ctx, worksiteMap, options.invitationEmails ?? {})

    report.changed = hasChanges(report)
    if (report.changed) {
      await recordAudit({
        userId: actorUserId,
        action: "create",
        entityType: "mant_seed",
        entityId: nanoid(),
        newState: summarize(report),
      }, tx)
    }
    return report
  })
}

function warnOnUnexpectedCounts({ data, report }: SeedContext) {
  const expect = (label: string, got: number, want: number) => {
    if (got !== want) report.warnings.push(`El archivo trae ${got} ${label} y la especificación dice ${want}.`)
  }
  expect("equipos", data.equipos.length, EXPECTED.equipos)
  expect("talleres", data.talleresExternos.length, EXPECTED.talleres)
  expect("conductores", data.conductores.length, EXPECTED.conductores)
  expect("mecánicos", data.mecanicos.length, EXPECTED.mecanicos)
  for (const [id, want] of Object.entries(EXPECTED.itemsPorPauta)) {
    const schedule = data.pautas.find((candidate) => candidate.id === id)
    if (schedule) expect(`ítems en la pauta «${schedule.nombre}»`, schedule.grupos.reduce((sum, group) => sum + group.items.length, 0), want)
  }
}

/**
 * Faenas del archivo más las que sólo aparecen en equipos o mecánicos (la
 * planilla de inventario trae cuatro que la lista de faenas no): éstas reciben
 * un código de folio derivado del nombre. Las que ya existen (por nombre
 * normalizado: «cholguán» = «Cholguan») se respetan, y su código de folio
 * también: si ya tienen otro distinto del archivo, se reporta.
 */
async function seedWorksites(ctx: SeedContext): Promise<WorksiteMap> {
  const { tx, data, report, actorUserId } = ctx
  const wanted = new Map<string, { name: string; folio?: string }>()
  for (const faena of data.faenas) wanted.set(nameKey(faena.nombre), { name: cleanName(faena.nombre), folio: faena.codigoFolio })
  const referenced = [...data.equipos.map((equipo) => equipo.faena), ...data.mecanicos.map((mecanico) => mecanico.faena)]
  for (const name of referenced) if (!wanted.has(nameKey(name))) wanted.set(nameKey(name), { name: cleanName(name) })

  const before = await tx.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites)
  const byKey = new Map(before.map((row) => [nameKey(row.name), row]))
  const map: WorksiteMap = new Map()
  for (const [key, want] of wanted) {
    const existed = byKey.get(key)
    const resolved = await resolveOrCreateWorksite(tx, { typedName: want.name, actor: { userId: actorUserId }, folioCode: want.folio })
    map.set(key, { id: resolved.id, name: resolved.name })
    if (resolved.created) report.worksites.created++
    else report.worksites.existing++
    const folio = await ensureFolioCode(tx, resolved.id)
    if (!want.folio) report.worksites.derivedFolio.push(`«${resolved.name}»: ${folio} (derivado del nombre; no está en la lista de faenas del archivo)`)
    else if (folio !== want.folio) report.worksites.folioNotes.push(`«${resolved.name}»: el archivo trae ${want.folio} pero queda ${folio} (${existed ? "ya tenía otro código" : "el código ya lo usa otra faena"}).`)
    if (existed && !existed.isActive) report.warnings.push(`La faena «${existed.name}» existe pero está inactiva; se usó igual.`)
  }
  return map
}

/** Nombre del archivo → slug del catálogo de flota. «Grúa horquilla» no existe en la flota y se crea. */
const TYPE_SLUGS: Record<string, string> = {
  camion: "camion", tracto: "tracto", camioneta: "camioneta", "cargador frontal": "cargador", minicargador: "minicargador",
  excavadora: "excavadora", bulldozer: "bulldozer", retroexcavadora: "retroexcavadora", tractor: "tractor",
  "grua horquilla": "grua_horquilla",
}

async function seedEquipmentTypes(ctx: SeedContext): Promise<Map<string, SeededType>> {
  const { tx, data, report } = ctx
  const rows = await tx.select().from(fuelEquipmentTypes)
  const result = new Map<string, SeededType>()
  for (const type of data.tiposEquipo) {
    const key = nameKey(type.nombre)
    const slug = TYPE_SLUGS[key]
    if (!slug) {
      report.equipmentTypes.problems.push(`«${type.nombre}»: no hay tipo de flota equivalente conocido.`)
      continue
    }
    let row = rows.find((candidate) => candidate.slug === slug)
      ?? (slug === "grua_horquilla" ? rows.find((candidate) => nameKey(candidate.name) === key) : undefined)
    if (row) report.equipmentTypes.existing++
    else if (slug === "grua_horquilla") {
      const [created] = await tx.insert(fuelEquipmentTypes).values({
        id: "fet-grua-horquilla", slug, name: cleanName(type.nombre), category: "heavy",
        defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour", sortOrder: 150,
      }).onConflictDoNothing().returning()
      row = created ?? (await tx.select().from(fuelEquipmentTypes)).find((candidate) => candidate.slug === slug)
      report.equipmentTypes.created++
    } else {
      report.equipmentTypes.problems.push(`«${type.nombre}»: el tipo de flota «${slug}» no existe.`)
      continue
    }
    if (!row) continue
    if (unitFromMeter(row.defaultMeterType) !== type.unidad) {
      report.equipmentTypes.problems.push(`«${type.nombre}»: el archivo lo mide en ${type.unidad} y el tipo «${row.name}» de la flota usa otro medidor (${row.defaultMeterType}).`)
      continue
    }
    result.set(key, { id: row.id, name: row.name, unit: type.unidad, meterType: row.defaultMeterType, performanceUnit: row.defaultPerformanceUnit })
  }
  return result
}

async function seedCatalogs(ctx: SeedContext): Promise<{ brands: Map<string, { id: string; name: string }> }> {
  const { tx, data, report } = ctx
  const names: Record<MantCatalogKey, string[]> = {
    brands: [...data.marcasConReglas, ...data.equipos.map((equipo) => equipo.marca)],
    workshops: data.talleresExternos,
    drivers: data.conductores,
    workTypes: data.tiposTrabajo,
    oils: data.aceites,
  }
  let brands = new Map<string, { id: string; name: string }>()
  for (const key of MANT_CATALOG_KEYS) {
    const result = await ensureCatalogEntries(tx, key, names[key])
    report.catalogs[key] = { created: result.created, existing: result.existing }
    if (key === "brands") brands = result.entries
  }
  return { brands }
}

function hasChanges(report: MantSeedReport): boolean {
  const { worksites: w, equipmentTypes: t, catalogs, schedules, equipment, mechanics } = report
  return w.created > 0 || t.created > 0
    || Object.values(catalogs).some((pair) => pair.created > 0)
    || schedules.some((schedule) => schedule.created)
    || equipment.created > 0 || equipment.profilesCreated > 0 || equipment.filledFromSeed > 0
    || mechanics.linked > 0
}

function summarize(report: MantSeedReport): Record<string, unknown> {
  return {
    worksites: report.worksites.created,
    equipmentTypes: report.equipmentTypes.created,
    catalogs: Object.fromEntries(Object.entries(report.catalogs).map(([key, pair]) => [key, pair.created])),
    schedules: report.schedules.filter((schedule) => schedule.created).length,
    vehicles: report.equipment.created,
    profiles: report.equipment.profilesCreated,
    mechanicsLinked: report.mechanics.linked,
  }
}
