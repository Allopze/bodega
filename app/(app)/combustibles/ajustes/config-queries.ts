import type { Session } from "next-auth"
import { and, asc, count, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { clients, fuelEquipmentTypes, fuelMandanteWorksites, fuelMandantes, fuelSuppliers, fuelSupplyMedia, fuelVehicles, worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { providerMappingFromColumns } from "@/lib/combustibles/control/catalogs"
import { DEFAULT_PERFORMANCE_CONTROL_SETTINGS, type PerformanceControlSettings, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { getPerformanceControlSettings } from "@/lib/combustibles/control/settings"
import type { EquipmentTypeRow, MandanteRow, Option, SupplyMediumRow, WorksiteOption } from "./config-types"

/**
 * Lecturas de las secciones de «Ajustes». Cada consulta cae a su valor vacío
 * sin tumbar la página y avisa que cayó (`failed`): la pantalla dice qué no se
 * pudo cargar en vez de mostrar una lista vacía como si fuera el dato real.
 */
async function load<T>(promise: Promise<T>, fallback: T, label: string): Promise<{ value: T; failed: boolean }> {
  const failed = Symbol("failed")
  const value = await settle<T | typeof failed>(promise, failed, label)
  return value === failed ? { value: fallback, failed: true } : { value: value as T, failed: false }
}

export async function loadMandantesData(session: Session): Promise<{ mandantes: MandanteRow[]; worksites: WorksiteOption[]; clients: Option[]; degraded: string[]; total: number }> {
  const scope = resolveWorksiteScope(session)
  const [mandanteRows, linkRows, worksiteRows, clientRows] = await Promise.all([
    load(
      db.select({ id: fuelMandantes.id, name: fuelMandantes.name, clientId: fuelMandantes.clientId, clientName: clients.name, tolerancePct: fuelMandantes.tolerancePct, isActive: fuelMandantes.isActive })
        .from(fuelMandantes).leftJoin(clients, eq(clients.id, fuelMandantes.clientId)).orderBy(asc(fuelMandantes.name)),
      [], "ajustes-mandantes",
    ),
    load(db.select({ worksiteId: fuelMandanteWorksites.worksiteId, mandanteId: fuelMandanteWorksites.mandanteId }).from(fuelMandanteWorksites), [], "ajustes-mandante-worksites"),
    load(
      scope.mode === "none" ? Promise.resolve([]) : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
        .where(and(eq(worksites.isActive, true), scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined))
        .orderBy(asc(worksites.name)),
      [], "ajustes-worksites",
    ),
    load(db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.isActive, true)).orderBy(asc(clients.name)), [], "ajustes-clients"),
  ])

  const mandanteByWorksite = new Map(linkRows.value.map((link) => [link.worksiteId, link.mandanteId]))
  const mandanteNames = new Map(mandanteRows.value.map((row) => [row.id, row.name]))
  const worksiteOptions: WorksiteOption[] = worksiteRows.value.map((worksite) => {
    const mandanteId = mandanteByWorksite.get(worksite.id) ?? null
    return { id: worksite.id, name: worksite.name, mandanteId, mandanteName: mandanteId ? mandanteNames.get(mandanteId) ?? null : null }
  })
  const visibleWorksiteIds = new Set(worksiteOptions.map((worksite) => worksite.id))
  const mandantes: MandanteRow[] = mandanteRows.value.map((row) => ({
    ...row,
    worksiteIds: linkRows.value.filter((link) => link.mandanteId === row.id && visibleWorksiteIds.has(link.worksiteId)).map((link) => link.worksiteId),
  }))
  const sources = [
    { label: "mandantes", failed: mandanteRows.failed },
    { label: "faenas de cada mandante", failed: linkRows.failed },
    { label: "faenas", failed: worksiteRows.failed },
    { label: "clientes", failed: clientRows.failed },
  ]
  return { mandantes, worksites: worksiteOptions, clients: clientRows.value, degraded: sources.filter((source) => source.failed).map((source) => source.label), total: sources.length }
}

export async function loadSupplyMediaData(): Promise<{ media: SupplyMediumRow[]; suppliers: Option[]; degraded: string[]; total: number }> {
  const [mediaRows, supplierRows] = await Promise.all([
    load(
      db.select({
        id: fuelSupplyMedia.id, name: fuelSupplyMedia.name, kind: fuelSupplyMedia.kind, fuelSupplierId: fuelSupplyMedia.fuelSupplierId, fuelSupplierName: fuelSuppliers.name,
        providerCode: fuelSupplyMedia.providerCode, providerChannel: fuelSupplyMedia.providerChannel, aliases: fuelSupplyMedia.aliases, sortOrder: fuelSupplyMedia.sortOrder, isActive: fuelSupplyMedia.isActive,
      }).from(fuelSupplyMedia).leftJoin(fuelSuppliers, eq(fuelSuppliers.id, fuelSupplyMedia.fuelSupplierId)).orderBy(asc(fuelSupplyMedia.sortOrder), asc(fuelSupplyMedia.name)),
      [], "ajustes-media",
    ),
    load(db.select({ id: fuelSuppliers.id, name: fuelSuppliers.name }).from(fuelSuppliers).where(eq(fuelSuppliers.isActive, true)).orderBy(asc(fuelSuppliers.name)), [], "ajustes-suppliers"),
  ])
  const media: SupplyMediumRow[] = mediaRows.value.map((row) => ({
    id: row.id, name: row.name, kind: row.kind, fuelSupplierId: row.fuelSupplierId, fuelSupplierName: row.fuelSupplierName,
    providerMapping: providerMappingFromColumns(row.providerCode, row.providerChannel), aliases: row.aliases, sortOrder: row.sortOrder, isActive: row.isActive,
  }))
  const sources = [
    { label: "medios de suministro", failed: mediaRows.failed },
    { label: "proveedores", failed: supplierRows.failed },
  ]
  return { media, suppliers: supplierRows.value, degraded: sources.filter((source) => source.failed).map((source) => source.label), total: sources.length }
}

export async function loadEquipmentFamiliesData(): Promise<{ types: EquipmentTypeRow[]; degraded: string[]; total: number }> {
  const typeRows = await load(
    db.select({ id: fuelEquipmentTypes.id, name: fuelEquipmentTypes.name, performanceFamily: fuelEquipmentTypes.performanceFamily, vehicleCount: count(fuelVehicles.id) })
      .from(fuelEquipmentTypes).leftJoin(fuelVehicles, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
      .where(eq(fuelEquipmentTypes.isActive, true)).groupBy(fuelEquipmentTypes.id).orderBy(asc(fuelEquipmentTypes.sortOrder), asc(fuelEquipmentTypes.name)),
    [], "ajustes-equipment-types",
  )
  const types: EquipmentTypeRow[] = typeRows.value.map((row) => ({ id: row.id, name: row.name, performanceFamily: row.performanceFamily as PerformanceFamily | null, vehicleCount: Number(row.vehicleCount) }))
  return { types, degraded: typeRows.failed ? ["tipos de equipo"] : [], total: 1 }
}

export async function loadThresholdsData(): Promise<{ settings: PerformanceControlSettings; failed: boolean }> {
  const settings = await load(getPerformanceControlSettings(), DEFAULT_PERFORMANCE_CONTROL_SETTINGS, "ajustes-thresholds")
  return { settings: settings.value, failed: settings.failed }
}
