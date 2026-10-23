import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, count, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { clients, fuelEquipmentTypes, fuelMandanteWorksites, fuelMandantes, fuelSuppliers, fuelSupplyMedia, fuelVehicles, worksites } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { providerMappingFromColumns } from "@/lib/combustibles/control/catalogs"
import { DEFAULT_PERFORMANCE_CONTROL_SETTINGS, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { getPerformanceControlSettings } from "@/lib/combustibles/control/settings"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import type { EquipmentTypeRow, MandanteRow, Option, SupplyMediumRow, WorksiteOption } from "./config-types"
import { EquipmentFamiliesSection } from "./equipment-families-section"
import { MandantesSection } from "./mandantes-section"
import { SupplyMediaSection } from "./supply-media-section"
import { ThresholdsSection } from "./thresholds-section"

export const metadata: Metadata = { title: "Configuración del control de combustible" }

/** Una consulta que cae a su valor vacío sin tumbar la página, y avisa que cayó. */
async function load<T>(promise: Promise<T>, fallback: T, label: string): Promise<{ value: T; failed: boolean }> {
  const failed = Symbol("failed")
  const value = await settle<T | typeof failed>(promise, failed, label)
  return value === failed ? { value: fallback, failed: true } : { value: value as T, failed: false }
}

export default async function ControlConfigurationPage() {
  let session
  try { session = await requirePermission("combustibles:manage_control") } catch { redirect("/forbidden") }

  const scope = resolveWorksiteScope(session)

  const [mandanteRows, linkRows, worksiteRows, clientRows, mediaRows, supplierRows, typeRows, settings] = await Promise.all([
    load(
      db.select({ id: fuelMandantes.id, name: fuelMandantes.name, clientId: fuelMandantes.clientId, clientName: clients.name, tolerancePct: fuelMandantes.tolerancePct, isActive: fuelMandantes.isActive })
        .from(fuelMandantes).leftJoin(clients, eq(clients.id, fuelMandantes.clientId)).orderBy(asc(fuelMandantes.name)),
      [], "config-mandantes",
    ),
    load(db.select({ worksiteId: fuelMandanteWorksites.worksiteId, mandanteId: fuelMandanteWorksites.mandanteId }).from(fuelMandanteWorksites), [], "config-mandante-worksites"),
    load(
      scope.mode === "none" ? Promise.resolve([]) : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
        .where(and(eq(worksites.isActive, true), scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined))
        .orderBy(asc(worksites.name)),
      [], "config-worksites",
    ),
    load(db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.isActive, true)).orderBy(asc(clients.name)), [], "config-clients"),
    load(
      db.select({
        id: fuelSupplyMedia.id, name: fuelSupplyMedia.name, kind: fuelSupplyMedia.kind, fuelSupplierId: fuelSupplyMedia.fuelSupplierId, fuelSupplierName: fuelSuppliers.name,
        providerCode: fuelSupplyMedia.providerCode, providerChannel: fuelSupplyMedia.providerChannel, aliases: fuelSupplyMedia.aliases, sortOrder: fuelSupplyMedia.sortOrder, isActive: fuelSupplyMedia.isActive,
      }).from(fuelSupplyMedia).leftJoin(fuelSuppliers, eq(fuelSuppliers.id, fuelSupplyMedia.fuelSupplierId)).orderBy(asc(fuelSupplyMedia.sortOrder), asc(fuelSupplyMedia.name)),
      [], "config-media",
    ),
    load(db.select({ id: fuelSuppliers.id, name: fuelSuppliers.name }).from(fuelSuppliers).where(eq(fuelSuppliers.isActive, true)).orderBy(asc(fuelSuppliers.name)), [], "config-suppliers"),
    load(
      db.select({ id: fuelEquipmentTypes.id, name: fuelEquipmentTypes.name, performanceFamily: fuelEquipmentTypes.performanceFamily, vehicleCount: count(fuelVehicles.id) })
        .from(fuelEquipmentTypes).leftJoin(fuelVehicles, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
        .where(eq(fuelEquipmentTypes.isActive, true)).groupBy(fuelEquipmentTypes.id).orderBy(asc(fuelEquipmentTypes.sortOrder), asc(fuelEquipmentTypes.name)),
      [], "config-equipment-types",
    ),
    load(getPerformanceControlSettings(), DEFAULT_PERFORMANCE_CONTROL_SETTINGS, "config-thresholds"),
  ])

  const sources = [mandanteRows, linkRows, worksiteRows, clientRows, mediaRows, supplierRows, typeRows, settings]
  const degraded = sources.filter((source) => source.failed).length

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
  const media: SupplyMediumRow[] = mediaRows.value.map((row) => ({
    id: row.id, name: row.name, kind: row.kind, fuelSupplierId: row.fuelSupplierId, fuelSupplierName: row.fuelSupplierName,
    providerMapping: providerMappingFromColumns(row.providerCode, row.providerChannel), aliases: row.aliases, sortOrder: row.sortOrder, isActive: row.isActive,
  }))
  const types: EquipmentTypeRow[] = typeRows.value.map((row) => ({ id: row.id, name: row.name, performanceFamily: row.performanceFamily as PerformanceFamily | null, vehicleCount: Number(row.vehicleCount) }))
  const clientOptions: Option[] = clientRows.value
  const supplierOptions: Option[] = supplierRows.value

  return (
    <PageContainer>
      <PageHeader
        title="Configuración del control de combustible"
        description="Mandantes, medios de suministro, familias de equipos y umbrales que usa el control de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Administración", href: "/admin" }, { label: "Catálogos de flota", href: "/admin/flota-catalogos" }, { label: "Control de combustible" }]} />}
      />
      <DegradedDataBanner degraded={Array.from({ length: degraded }, () => "fuente")} total={sources.length} />
      <MandantesSection mandantes={mandantes} worksites={worksiteOptions} clients={clientOptions} />
      <SupplyMediaSection media={media} suppliers={supplierOptions} />
      <EquipmentFamiliesSection types={types} />
      <ThresholdsSection settings={settings.value} />
    </PageContainer>
  )
}
