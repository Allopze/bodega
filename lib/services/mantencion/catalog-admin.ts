import { and, eq, isNotNull, ne, sql } from "drizzle-orm"
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core"
import { db, type Tx } from "@/db"
import { mantRecordDrivers, mantRecordJobs, mantRecords, mantEquipmentProfiles, mantScheduleBrandRules, mantWorkOrders } from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import { CATALOG_LABELS, CATALOG_NAME_MAX, CATALOG_NAME_MIN } from "@/lib/mantencion/catalog-labels"
import { cleanName, nameKey } from "@/lib/mantencion/normalize"
import { catalogTable, ensureCatalogEntry, type MantCatalogKey } from "./catalogs"
import type { MantActionResult } from "./result"

/**
 * Administración de los catálogos cerrados (marcas, talleres, conductores, tipos
 * de trabajo y aceites): alta, renombre y activar/desactivar.
 *
 * Reglas:
 * - La identidad es `name_key`: «Cholguán» y «cholguan» son la misma fila, así
 *   que no se puede crear ni renombrar hacia un nombre que ya existe.
 * - Dar de alta un nombre cuyo registro está inactivo lo REACTIVA en vez de
 *   duplicarlo (el índice único no deja duplicarlo de todos modos).
 * - Desactivar no toca a quien ya usa la entrada: los equipos, registros y OT la
 *   conservan; sólo deja de ofrecerse en los selectores.
 * - Cada cambio sube `updated_at`: la versión (ETag) del catálogo de la app del
 *   mecánico (`sync-catalog-version.ts`) se calcula con el máximo de esa columna y
 *   el conteo de las cinco tablas, así que los teléfonos descargan el catálogo
 *   nuevo en la siguiente sincronización.
 */

export interface CatalogAdminActor {
  userId: string
  email?: string | null
}

export interface CatalogAdminRow {
  id: string
  name: string
  isActive: boolean
  /** Veces que algo del módulo usa la entrada; `null` si el catálogo no guarda una referencia contable. */
  usage: number | null
  /** El desglose de `usage` en palabras («3 equipos · 2 reglas de pauta»). */
  usageText: string
}

type UsageSource = { table: AnyPgTable; column: AnyPgColumn; singular: string; plural: string }

/**
 * Qué referencia a cada catálogo (por clave foránea). Los aceites NO están: una
 * correctiva guarda los nombres elegidos como texto (`oils` jsonb), no una
 * referencia, y contarlos por nombre mentiría tras un renombre.
 */
const USAGE_SOURCES: Record<MantCatalogKey, UsageSource[]> = {
  brands: [
    { table: mantEquipmentProfiles, column: mantEquipmentProfiles.brandId, singular: "equipo", plural: "equipos" },
    { table: mantScheduleBrandRules, column: mantScheduleBrandRules.brandId, singular: "regla de pauta", plural: "reglas de pauta" },
  ],
  workshops: [
    { table: mantRecords, column: mantRecords.executorWorkshopId, singular: "registro", plural: "registros" },
    { table: mantWorkOrders, column: mantWorkOrders.workshopId, singular: "OT", plural: "OT" },
  ],
  drivers: [
    { table: mantRecordDrivers, column: mantRecordDrivers.driverId, singular: "registro", plural: "registros" },
    { table: mantWorkOrders, column: mantWorkOrders.operatorDriverId, singular: "OT", plural: "OT" },
  ],
  workTypes: [
    { table: mantRecordJobs, column: mantRecordJobs.workTypeId, singular: "trabajo registrado", plural: "trabajos registrados" },
  ],
  oils: [],
}

async function countByReference(client: Pick<Tx, "select">, source: UsageSource): Promise<Map<string, number>> {
  const rows = await client
    .select({ id: sql<string>`${source.column}`, total: sql<number>`count(*)::int` })
    .from(source.table)
    .where(isNotNull(source.column))
    .groupBy(source.column)
  return new Map(rows.map((row) => [row.id, Number(row.total)]))
}

/** Todas las entradas de un catálogo (activas e inactivas) con cuánto se usan. */
export async function listCatalogAdminRows(key: MantCatalogKey): Promise<CatalogAdminRow[]> {
  const table = catalogTable(key)
  const entries = await db
    .select({ id: table.id, name: table.name, isActive: table.isActive })
    .from(table)
    .orderBy(table.sortOrder, table.name)
  const sources = USAGE_SOURCES[key]
  const counts = await Promise.all(sources.map((source) => countByReference(db, source)))
  return entries.map((entry) => {
    if (sources.length === 0) return { ...entry, usage: null, usageText: "" }
    const parts = sources.map((source, index) => ({ source, total: counts[index]!.get(entry.id) ?? 0 }))
    const usage = parts.reduce((sum, part) => sum + part.total, 0)
    const usageText = parts
      .filter((part) => part.total > 0)
      .map((part) => `${part.total} ${part.total === 1 ? part.source.singular : part.source.plural}`)
      .join(" · ")
    return { ...entry, usage, usageText }
  })
}

type NameCheck = { ok: true; name: string; key: string } | { ok: false; message: string; field: string }

function checkName(raw: string): NameCheck {
  const name = cleanName(raw)
  if (name.length < CATALOG_NAME_MIN) return { ok: false, message: `Escribe un nombre de al menos ${CATALOG_NAME_MIN} caracteres.`, field: "name" }
  if (name.length > CATALOG_NAME_MAX) return { ok: false, message: `El nombre no puede pasar de ${CATALOG_NAME_MAX} caracteres.`, field: "name" }
  return { ok: true, name, key: nameKey(name) }
}

const CLASH = (catalog: MantCatalogKey, name: string) => {
  const { feminine, singular } = CATALOG_LABELS[catalog]
  return `Ya existe ${feminine ? "una" : "un"} ${singular} llamad${feminine ? "a" : "o"} «${name}».`
}
const ENTITY: Record<MantCatalogKey, string> = {
  brands: "mant_brand", workshops: "mant_workshop", drivers: "mant_driver", workTypes: "mant_work_type", oils: "mant_oil",
}

export interface CreateCatalogEntryResult { id: string; name: string; reactivated: boolean }

/**
 * Alta de una entrada. Si ya existe activa, avisa (no hay nada que crear). Si existe
 * inactiva, la reactiva y lo dice en el mensaje.
 */
export async function createCatalogEntry(input: {
  catalog: MantCatalogKey
  name: string
  actor: CatalogAdminActor
}): Promise<MantActionResult<CreateCatalogEntryResult>> {
  const checked = checkName(input.name)
  if (!checked.ok) return checked
  const table = catalogTable(input.catalog)
  const feminine = CATALOG_LABELS[input.catalog].feminine
  const now = new Date().toISOString()

  const run = () => db.transaction(async (tx): Promise<MantActionResult<CreateCatalogEntryResult>> => {
    const [existing] = await tx
      .select({ id: table.id, name: table.name, isActive: table.isActive })
      .from(table)
      .where(eq(table.nameKey, checked.key))
      .for("update")
      .limit(1)

    if (existing?.isActive) {
      return { ok: false, field: "name", message: `${CLASH(input.catalog, existing.name)} Ya está disponible.` }
    }

    if (existing) {
      await tx.update(table).set({ isActive: true, updatedAt: now, updatedBy: input.actor.userId }).where(eq(table.id, existing.id))
      await recordAudit({
        userId: input.actor.userId,
        userEmail: input.actor.email ?? undefined,
        action: "status_change",
        entityType: ENTITY[input.catalog],
        entityId: existing.id,
        entityCode: existing.name,
        oldState: { isActive: false },
        newState: { isActive: true },
        reason: "Reactivada al dar de alta el mismo nombre",
      }, tx)
      return {
        ok: true,
        message: `«${existing.name}» ya existía desactivada: la reactivé en vez de duplicarla.`,
        data: { id: existing.id, name: existing.name, reactivated: true },
      }
    }

    const created = await ensureCatalogEntry(tx, input.catalog, checked.name)
    if (!created.created) {
      // Otra persona la dio de alta entre la lectura y el insert: no hay nada que duplicar.
      return { ok: false, field: "name", message: CLASH(input.catalog, checked.name) }
    }
    await tx.update(table).set({ updatedAt: now, updatedBy: input.actor.userId }).where(eq(table.id, created.id))
    await recordAudit({
      userId: input.actor.userId,
      userEmail: input.actor.email ?? undefined,
      action: "create",
      entityType: ENTITY[input.catalog],
      entityId: created.id,
      entityCode: checked.name,
      newState: { catalog: input.catalog, name: checked.name, isActive: true },
    }, tx)
    return { ok: true, message: `${feminine ? "Agregada" : "Agregado"} «${checked.name}».`, data: { id: created.id, name: checked.name, reactivated: false } }
  })

  try {
    return await run()
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, field: "name", message: CLASH(input.catalog, checked.name) }
    throw error
  }
}

/** Cambia el nombre. Escribir el mismo nombre con otra grafía («cholguan» → «Cholguán») está permitido. */
export async function renameCatalogEntry(input: {
  catalog: MantCatalogKey
  id: string
  name: string
  actor: CatalogAdminActor
}): Promise<MantActionResult<{ id: string; name: string }>> {
  const checked = checkName(input.name)
  if (!checked.ok) return checked
  const table = catalogTable(input.catalog)
  const now = new Date().toISOString()

  try {
    return await db.transaction(async (tx): Promise<MantActionResult<{ id: string; name: string }>> => {
      const [current] = await tx
        .select({ id: table.id, name: table.name, nameKey: table.nameKey })
        .from(table)
        .where(eq(table.id, input.id))
        .for("update")
        .limit(1)
      if (!current) return { ok: false, message: "Esa entrada ya no existe. Recarga la página." }
      if (current.name === checked.name) return { ok: true, message: "El nombre no cambió.", data: { id: current.id, name: current.name } }

      if (checked.key !== current.nameKey) {
        const [clash] = await tx
          .select({ id: table.id, name: table.name })
          .from(table)
          .where(and(eq(table.nameKey, checked.key), ne(table.id, current.id)))
          .limit(1)
        if (clash) return { ok: false, field: "name", message: CLASH(input.catalog, clash.name) }
      }

      await tx.update(table)
        .set({ name: checked.name, nameKey: checked.key, updatedAt: now, updatedBy: input.actor.userId })
        .where(eq(table.id, current.id))
      await recordAudit({
        userId: input.actor.userId,
        userEmail: input.actor.email ?? undefined,
        action: "update",
        entityType: ENTITY[input.catalog],
        entityId: current.id,
        entityCode: checked.name,
        oldState: { name: current.name },
        newState: { name: checked.name },
      }, tx)
      return { ok: true, message: `${CATALOG_LABELS[input.catalog].feminine ? "Renombrada" : "Renombrado"} a «${checked.name}».`, data: { id: current.id, name: checked.name } }
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, field: "name", message: CLASH(input.catalog, checked.name) }
    throw error
  }
}

/**
 * Activa o desactiva. No toca los equipos, registros ni OT que ya la usan: sólo
 * deja de ofrecerse (o vuelve a ofrecerse) en los selectores y en la app.
 */
export async function setCatalogEntryActive(input: {
  catalog: MantCatalogKey
  id: string
  active: boolean
  actor: CatalogAdminActor
}): Promise<MantActionResult<{ id: string; isActive: boolean }>> {
  const table = catalogTable(input.catalog)
  const now = new Date().toISOString()
  return db.transaction(async (tx): Promise<MantActionResult<{ id: string; isActive: boolean }>> => {
    const [current] = await tx
      .select({ id: table.id, name: table.name, isActive: table.isActive })
      .from(table)
      .where(eq(table.id, input.id))
      .for("update")
      .limit(1)
    if (!current) return { ok: false, message: "Esa entrada ya no existe. Recarga la página." }
    if (current.isActive === input.active) {
      return { ok: true, message: input.active ? "Ya estaba activa." : "Ya estaba desactivada.", data: { id: current.id, isActive: current.isActive } }
    }
    await tx.update(table).set({ isActive: input.active, updatedAt: now, updatedBy: input.actor.userId }).where(eq(table.id, current.id))
    await recordAudit({
      userId: input.actor.userId,
      userEmail: input.actor.email ?? undefined,
      action: "status_change",
      entityType: ENTITY[input.catalog],
      entityId: current.id,
      entityCode: current.name,
      oldState: { isActive: current.isActive },
      newState: { isActive: input.active },
    }, tx)
    return {
      ok: true,
      message: input.active ? `«${current.name}» vuelve a ofrecerse.` : `«${current.name}» ya no se ofrecerá. Lo que ya la usa la conserva.`,
      data: { id: current.id, isActive: input.active },
    }
  })
}
