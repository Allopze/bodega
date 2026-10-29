import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fuelEquipmentTypes, mantBrands, mantDrivers, mantOils, mantWorkTypes, mantWorkshops, workers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanName, nameKey } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import { unitFromMeter } from "./fleet"

/**
 * Catálogos cerrados del módulo (marcas, talleres, conductores, tipos de
 * trabajo y aceites) y los tipos de equipo de la flota con su unidad.
 *
 * Los cinco catálogos comparten forma (`catalogColumns()` en el esquema) y se
 * identifican por `name_key`: «Cholguán» y «cholguan» son la misma fila, así
 * que dar de alta una entrada que ya existe devuelve la existente.
 */

export type MantCatalogKey = "brands" | "workshops" | "drivers" | "workTypes" | "oils"

export interface CatalogEntry {
  id: string
  name: string
  isActive: boolean
}

/*
 * Las cinco tablas tienen las mismas columnas comunes; sólo difieren en el
 * nombre genérico que Drizzle lleva en el tipo. Se declaran todas como la
 * primera para poder operar con una sola implementación en vez de cinco
 * copias o una unión que Drizzle no sabe estrechar. `mantDrivers` tiene además
 * `worker_id`, que aquí nunca se toca.
 */
type CatalogTable = typeof mantBrands
const TABLES: Record<MantCatalogKey, CatalogTable> = {
  brands: mantBrands,
  workshops: mantWorkshops as unknown as CatalogTable,
  drivers: mantDrivers as unknown as CatalogTable,
  workTypes: mantWorkTypes as unknown as CatalogTable,
  oils: mantOils as unknown as CatalogTable,
}

export const MANT_CATALOG_KEYS = Object.keys(TABLES) as MantCatalogKey[]

type Reader = Pick<Tx, "select">

async function readCatalog(client: Reader, key: MantCatalogKey, includeInactive: boolean): Promise<CatalogEntry[]> {
  const table = TABLES[key]
  return client
    .select({ id: table.id, name: table.name, isActive: table.isActive })
    .from(table)
    .where(includeInactive ? undefined : eq(table.isActive, true))
    .orderBy(asc(table.sortOrder), asc(table.name))
}

export async function listMantCatalogs(opts: { includeInactive?: boolean } = {}): Promise<{
  brands: CatalogEntry[]
  workshops: CatalogEntry[]
  drivers: CatalogEntry[]
  workTypes: CatalogEntry[]
  oils: CatalogEntry[]
}> {
  const includeInactive = opts.includeInactive ?? false
  const [brands, workshops, drivers, workTypes, oils] = await Promise.all(
    MANT_CATALOG_KEYS.map((key) => readCatalog(db, key, includeInactive)),
  )
  return { brands: brands!, workshops: workshops!, drivers: drivers!, workTypes: workTypes!, oils: oils! }
}

/**
 * Tipos de equipo de la flota que se miden en km (odómetro) o en h
 * (horómetro). Los que no llevan medidor (estanques, hidrolavadoras) no pueden
 * entrar a la mantención: sin lectura no hay estado.
 */
export async function listEquipmentTypes(): Promise<Array<{ id: string; name: string; unit: MantUnit }>> {
  const rows = await db
    .select({ id: fuelEquipmentTypes.id, name: fuelEquipmentTypes.name, meter: fuelEquipmentTypes.defaultMeterType })
    .from(fuelEquipmentTypes)
    .where(and(eq(fuelEquipmentTypes.isActive, true), inArray(fuelEquipmentTypes.defaultMeterType, ["odometer", "hour_meter"])))
    .orderBy(asc(fuelEquipmentTypes.sortOrder), asc(fuelEquipmentTypes.name))
  const types: Array<{ id: string; name: string; unit: MantUnit }> = []
  for (const row of rows) {
    const unit = unitFromMeter(row.meter)
    if (unit) types.push({ id: row.id, name: row.name, unit })
  }
  return types
}

/**
 * Alta idempotente por `name_key`. Si ya existe (aunque esté inactiva) devuelve
 * la existente sin reactivarla: reactivar es una decisión de quien administra
 * el catálogo, no un efecto secundario de escribir un nombre.
 */
export async function ensureCatalogEntry(
  tx: Tx,
  table: MantCatalogKey,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const result = await ensureCatalogEntries(tx, table, [name])
  const entry = result.entries.get(nameKey(name))
  if (!entry) throw new Error("Escribe un nombre.")
  return { id: entry.id, created: entry.created }
}

/**
 * Versión en lote de `ensureCatalogEntry` (la carga inicial agrega cientos de
 * entradas): una lectura, un insert y una relectura, en vez de una consulta por
 * nombre. Las entradas nuevas quedan al final del orden del catálogo.
 */
export async function ensureCatalogEntries(
  tx: Tx,
  key: MantCatalogKey,
  names: readonly string[],
): Promise<{ entries: Map<string, { id: string; name: string; created: boolean }>; created: number; existing: number }> {
  const table = TABLES[key]
  const wanted = new Map<string, string>()
  for (const raw of names) {
    const cleaned = cleanName(raw)
    const keyOfName = nameKey(cleaned)
    if (keyOfName && !wanted.has(keyOfName)) wanted.set(keyOfName, cleaned)
  }
  const entries = new Map<string, { id: string; name: string; created: boolean }>()
  if (wanted.size === 0) return { entries, created: 0, existing: 0 }

  const keys = [...wanted.keys()]
  const found = await tx
    .select({ id: table.id, name: table.name, nameKey: table.nameKey })
    .from(table)
    .where(inArray(table.nameKey, keys))
  for (const row of found) entries.set(row.nameKey, { id: row.id, name: row.name, created: false })

  const missing = keys.filter((k) => !entries.has(k))
  if (missing.length > 0) {
    const [{ next } = { next: 0 }] = await tx.select({ next: sql<number>`coalesce(max(${table.sortOrder}), 0) + 10` }).from(table)
    const inserted = await tx.insert(table)
      .values(missing.map((k, index) => ({ id: nanoid(), name: wanted.get(k)!, nameKey: k, sortOrder: next + index * 10 })))
      // Dos altas simultáneas del mismo nombre: gana una y la otra la relee.
      .onConflictDoNothing()
      .returning({ nameKey: table.nameKey })
    const insertedHere = new Set(inserted.map((row) => row.nameKey))
    const reread = await tx
      .select({ id: table.id, name: table.name, nameKey: table.nameKey })
      .from(table)
      .where(inArray(table.nameKey, missing))
    for (const row of reread) entries.set(row.nameKey, { id: row.id, name: row.name, created: insertedHere.has(row.nameKey) })
  }

  const created = [...entries.values()].filter((entry) => entry.created).length
  return { entries, created, existing: entries.size - created }
}

const NAME_STOPWORDS = new Set(["de", "del", "la", "las", "los", "y"])

/** Palabras con significado de un nombre: sin iniciales («A.», «C») ni partículas («de la»). */
function significantTokens(value: string): string[] {
  return nameKey(value)
    .split(/[\s,]+/)
    .filter((token) => token.length >= 2 && !token.endsWith(".") && !NAME_STOPWORDS.has(token))
}

/**
 * Coincidencias PROBABLES entre los conductores de la planilla («APELLIDO
 * APELLIDO NOMBRE I.», sin RUT) y la ficha de personal. Sólo informa: vincular a
 * ciegas por nombre podría equivocar a la persona, así que `worker_id` queda
 * nulo hasta que alguien lo confirme. Exige al menos tres palabras con
 * significado y que todas estén en el nombre de la ficha. Devuelve nombres, no
 * ids ni RUT.
 */
export async function findProbableWorkerMatches(
  client: Reader,
  driverNames: readonly string[],
): Promise<Array<{ driver: string; workers: string[] }>> {
  const people = await client
    .select({ firstName: workers.firstName, lastName: workers.lastName })
    .from(workers)
  const indexed = people.map((person) => ({
    label: `${cleanName(person.firstName)} ${cleanName(person.lastName)}`,
    tokens: new Set(significantTokens(`${person.firstName} ${person.lastName}`)),
  }))
  const matches: Array<{ driver: string; workers: string[] }> = []
  for (const driver of driverNames) {
    const wanted = significantTokens(driver)
    if (wanted.length < 3) continue
    const found = indexed.filter((person) => wanted.every((token) => person.tokens.has(token))).map((person) => person.label)
    if (found.length > 0) matches.push({ driver: cleanName(driver), workers: found })
  }
  return matches
}
