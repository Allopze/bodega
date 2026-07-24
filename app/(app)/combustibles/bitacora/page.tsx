import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelAnomalyRules, fuelEquipmentTypes, fuelProducts, fuelSuppliers, users, worksites } from "@/db/schema"
import { fuelTaeLoadingPoints } from "@/db/schema/fuel-tae"
import { settle } from "@/lib/async-settle"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getFuelLogRows, getFuelLogTotal, FUEL_LOG_SOURCE_LABEL, fuelLogDetailHref, fuelLogAuditEntity, type FuelLogSource } from "@/lib/combustibles/fuel-log"
import { ANOMALY_RULE_SEVERITY_LABELS, ANOMALY_RULE_SEVERITIES } from "@/lib/combustibles/validation"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X } from "@phosphor-icons/react/dist/ssr"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { BitacoraTable } from "./bitacora-table"
import { BitacoraExportButton } from "./export-button"
import { FilterSelect } from "../filter-select"

export const metadata: Metadata = { title: "Bitácora general de combustible" }

const PAGE_SIZE = 50
const SOURCE_OPTIONS: FuelLogSource[] = ["tae_pwa", "invoiced", "operation_manual"]

// Filtros secundarios: viven plegados en "Más filtros". Contamos los activos para
// rotular el disclosure y abrirlo por defecto cuando alguno viene aplicado.
const ADVANCED_FILTER_KEYS: Array<keyof BitacoraSearchParams> = [
  "proveedor", "producto", "tipo", "observaciones", "marca", "modelo", "conductor", "supervisor",
  "punto_carga", "unidad_rendimiento", "estado_operativo", "sello_retirado", "sello_instalado",
  "evidencia_tipo", "anomalia", "revision", "anomalia_tipo", "anomalia_severidad", "anomalia_responsable",
]

type BitacoraSearchParams = {
  q?: string; desde?: string; hasta?: string; faena?: string; fuente?: string
  proveedor?: string; producto?: string; tipo?: string; observaciones?: string
  marca?: string; modelo?: string; conductor?: string; supervisor?: string
  punto_carga?: string; unidad_rendimiento?: string; estado_operativo?: string
  sello_retirado?: string; sello_instalado?: string
  evidencia_tipo?: string
  anomalia?: string; anomalia_tipo?: string; anomalia_severidad?: string; anomalia_responsable?: string
  revision?: string
  orden?: string; page?: string
}

export default async function FuelLogPage({ searchParams }: { searchParams: Promise<BitacoraSearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view") } catch { redirect("/forbidden") }

  const sp = await searchParams
  const filters = {
    q: sp.q?.trim().slice(0, 120) || undefined,
    worksiteId: sp.faena?.trim() || undefined,
    source: SOURCE_OPTIONS.includes(sp.fuente as FuelLogSource) ? (sp.fuente as FuelLogSource) : undefined,
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.desde ?? "") ? sp.desde : undefined,
    to: /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta ?? "") ? sp.hasta : undefined,
    supplierId: sp.proveedor?.trim() || undefined,
    productId: sp.producto?.trim() || undefined,
    equipmentTypeId: sp.tipo?.trim() || undefined,
    hasNotes: sp.observaciones === "si" ? true : undefined,
    brand: sp.marca?.trim() || undefined,
    model: sp.modelo?.trim() || undefined,
    driverName: sp.conductor?.trim() || undefined,
    supervisorName: sp.supervisor?.trim() || undefined,
    loadingPointId: sp.punto_carga?.trim() || undefined,
    performanceUnit: sp.unidad_rendimiento === "km_per_liter" || sp.unidad_rendimiento === "liters_per_hour" ? sp.unidad_rendimiento : undefined,
    operationalStatus: sp.estado_operativo?.trim() || undefined,
    sealRemoved: sp.sello_retirado?.trim() || undefined,
    sealInstalled: sp.sello_instalado?.trim() || undefined,
    evidenceKind: sp.evidencia_tipo === "odometer" || sp.evidencia_tipo === "liter_meter" || sp.evidencia_tipo === "removed_seal" || sp.evidencia_tipo === "installed_seal" ? sp.evidencia_tipo : undefined,
    hasAnomaly: sp.anomalia === "si" ? true : undefined,
    hasReviewMark: sp.revision === "si" ? true : undefined,
    anomalyRuleCode: sp.anomalia_tipo?.trim() || undefined,
    anomalySeverity: (ANOMALY_RULE_SEVERITIES as readonly string[]).includes(sp.anomalia_severidad ?? "") ? sp.anomalia_severidad : undefined,
    anomalyAssigneeId: sp.anomalia_responsable?.trim() || undefined,
  }
  const sort = sp.orden === "asc" ? "asc" as const : "desc" as const

  const scope = resolveWorksiteScope(session)

  const [worksitesList, suppliersList, productsList, equipmentTypesList, loadingPointsList, anomalyRulesList, anomalyAssigneesList, total] = await Promise.all([
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({
        where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
        columns: { id: true, name: true },
        orderBy: [worksites.name],
      }),
      [] as Array<{ id: string; name: string }>,
      "bitacora-worksites",
    ),
    settle(
      db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), columns: { id: true, name: true }, orderBy: [fuelSuppliers.name] }),
      [] as Array<{ id: string; name: string }>,
      "bitacora-suppliers",
    ),
    settle(
      db.query.fuelProducts.findMany({ where: eq(fuelProducts.isActive, true), columns: { id: true, name: true }, orderBy: [fuelProducts.name] }),
      [] as Array<{ id: string; name: string }>,
      "bitacora-products",
    ),
    settle(
      db.query.fuelEquipmentTypes.findMany({ where: eq(fuelEquipmentTypes.isActive, true), columns: { id: true, name: true }, orderBy: [fuelEquipmentTypes.name] }),
      [] as Array<{ id: string; name: string }>,
      "bitacora-equipmentTypes",
    ),
    settle(
      db.query.fuelTaeLoadingPoints.findMany({ columns: { id: true, name: true, worksiteId: true }, orderBy: [fuelTaeLoadingPoints.name] }),
      [] as Array<{ id: string; name: string; worksiteId: string }>,
      "bitacora-loadingPoints",
    ),
    settle(
      db.query.fuelAnomalyRules.findMany({ where: eq(fuelAnomalyRules.isActive, true), columns: { code: true, name: true }, orderBy: [fuelAnomalyRules.name] }),
      [] as Array<{ code: string; name: string }>,
      "bitacora-anomalyRules",
    ),
    settle(
      db.selectDistinct({ id: users.id, name: users.name }).from(fuelAnomalyCases)
        .innerJoin(users, eq(fuelAnomalyCases.assigneeId, users.id))
        .where(isNotNull(fuelAnomalyCases.assigneeId)).orderBy(users.name),
      [] as Array<{ id: string; name: string }>,
      "bitacora-anomalyAssignees",
    ),
    settle(getFuelLogTotal(session, filters), 0, "bitacora-total"),
  ])
  const pagination = resolvePagination({ pageParam: sp.page, totalItems: total, pageSize: PAGE_SIZE })
  const rows = await settle(getFuelLogRows(session, filters, { limit: PAGE_SIZE, offset: pagination.offset, sort }), [], "bitacora-rows")

  const canViewAudit = can(session, "combustibles:view_audit")
  const enriched = rows.map((row) => ({
    ...row,
    detailHref: fuelLogDetailHref(row),
    auditEntity: canViewAudit ? fuelLogAuditEntity(row) : null,
  }))

  const pageHref = (page: number) => buildPaginationHref("/combustibles/bitacora", sp, page)

  // Chips: cada filtro activo se puede retirar individualmente sin perder los demás.
  const chipRemoveHref = (key: keyof BitacoraSearchParams) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) { if (k !== key && k !== "page" && v) params.set(k, v) }
    return `/combustibles/bitacora${params.toString() ? `?${params.toString()}` : ""}`
  }
  const chips: Array<{ key: keyof BitacoraSearchParams; label: string }> = [
    sp.q ? { key: "q", label: `Búsqueda: "${sp.q}"` } : null,
    sp.desde ? { key: "desde", label: `Desde ${sp.desde}` } : null,
    sp.hasta ? { key: "hasta", label: `Hasta ${sp.hasta}` } : null,
    filters.worksiteId ? { key: "faena", label: `Faena: ${worksitesList.find((w) => w.id === filters.worksiteId)?.name ?? filters.worksiteId}` } : null,
    filters.source ? { key: "fuente", label: `Fuente: ${FUEL_LOG_SOURCE_LABEL[filters.source]}` } : null,
    filters.supplierId ? { key: "proveedor", label: `Proveedor: ${suppliersList.find((s) => s.id === filters.supplierId)?.name ?? filters.supplierId}` } : null,
    filters.productId ? { key: "producto", label: `Producto: ${productsList.find((p) => p.id === filters.productId)?.name ?? filters.productId}` } : null,
    filters.equipmentTypeId ? { key: "tipo", label: `Tipo: ${equipmentTypesList.find((t) => t.id === filters.equipmentTypeId)?.name ?? filters.equipmentTypeId}` } : null,
    filters.hasNotes ? { key: "observaciones", label: "Con observaciones" } : null,
    filters.hasAnomaly ? { key: "anomalia", label: "Con anomalías" } : null,
    filters.hasReviewMark ? { key: "revision", label: "Marcado para revisión" } : null,
    filters.anomalyRuleCode ? { key: "anomalia_tipo", label: `Anomalía: ${anomalyRulesList.find((r) => r.code === filters.anomalyRuleCode)?.name ?? filters.anomalyRuleCode}` } : null,
    filters.anomalySeverity ? { key: "anomalia_severidad", label: `Severidad: ${ANOMALY_RULE_SEVERITY_LABELS[filters.anomalySeverity as keyof typeof ANOMALY_RULE_SEVERITY_LABELS] ?? filters.anomalySeverity}` } : null,
    filters.anomalyAssigneeId ? { key: "anomalia_responsable", label: `Responsable: ${anomalyAssigneesList.find((u) => u.id === filters.anomalyAssigneeId)?.name ?? filters.anomalyAssigneeId}` } : null,
  ].filter((chip): chip is { key: keyof BitacoraSearchParams; label: string } => chip !== null)

  const advancedActiveCount = ADVANCED_FILTER_KEYS.filter((key) => Boolean(sp[key])).length

  return (
    <PageContainer width="full">
      <PageHeader
        title="Bitácora general"
        description="TAE, facturación y log operacional en una sola consulta, cada fila con su fuente original."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Bitácora general" }]} />}
        actions={<BitacoraExportButton filters={filters} />}
      />

      <form className="mb-4 flex flex-col gap-3 border-y border-(--color-border) py-4">
        {/* Filtros primarios: lo que se usa a diario. La tabla arranca justo debajo. */}
        <div className="grid gap-3 md:grid-cols-4">
          <Input name="q" defaultValue={sp.q} placeholder="Equipo, patente, conductor, supervisor, proveedor…" className="md:col-span-2" />
          <DatePicker name="desde" defaultValue={sp.desde} placeholder="Desde" />
          <DatePicker name="hasta" defaultValue={sp.hasta} placeholder="Hasta" />
          <FilterSelect name="faena" defaultValue={sp.faena} options={worksitesList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todas las faenas autorizadas" />
          <FilterSelect name="fuente" defaultValue={sp.fuente} options={SOURCE_OPTIONS.map((source) => ({ value: source, label: FUEL_LOG_SOURCE_LABEL[source] }))} placeholder="Todas las fuentes" />
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Button type="submit" variant="secondary">Aplicar</Button>
            {chips.length > 0 && <Link href="/combustibles/bitacora" className="text-xs text-(--color-text-muted) hover:underline">Limpiar filtros</Link>}
            <label className="ml-auto flex items-center gap-2 text-xs text-(--color-text-muted)">
              Orden
              <FilterSelect name="orden" defaultValue={sp.orden === "asc" ? "asc" : "desc"} options={[{ value: "desc", label: "Más reciente primero" }, { value: "asc", label: "Más antiguo primero" }]} placeholder="Orden" />
            </label>
          </div>
        </div>

        {/* Filtros secundarios: plegados por defecto (abiertos si vienen activos). Las
            entradas siguen en el DOM aunque estén ocultas, así que se envían igual. */}
        <details open={advancedActiveCount > 0} className="border-t border-(--color-border) pt-3">
          <summary className="cursor-pointer text-sm font-medium text-(--color-text-muted) hover:text-(--color-text)">
            Más filtros{advancedActiveCount > 0 ? ` · ${advancedActiveCount} activo${advancedActiveCount === 1 ? "" : "s"}` : ""}
          </summary>
          <div className="mt-4 flex flex-col gap-5">
            <fieldset className="grid gap-3 md:grid-cols-4">
              <legend className="text-eyebrow mb-2 md:col-span-4">Vehículo</legend>
              <Input name="marca" defaultValue={sp.marca} placeholder="Marca del vehículo" className="control" />
              <Input name="modelo" defaultValue={sp.modelo} placeholder="Modelo del vehículo" className="control" />
              <FilterSelect name="tipo" defaultValue={sp.tipo} options={equipmentTypesList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todos los tipos de equipo" />
              <Input name="conductor" defaultValue={sp.conductor} placeholder="Nombre del conductor" className="control" />
              <Input name="supervisor" defaultValue={sp.supervisor} placeholder="Nombre del supervisor" className="control" />
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-4">
              <legend className="text-eyebrow mb-2 md:col-span-4">Operación</legend>
              <FilterSelect name="proveedor" defaultValue={sp.proveedor} options={suppliersList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todos los proveedores" />
              <FilterSelect name="producto" defaultValue={sp.producto} options={productsList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todos los productos" />
              <FilterSelect name="punto_carga" defaultValue={sp.punto_carga} options={loadingPointsList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Todos los puntos de carga" />
              <FilterSelect name="unidad_rendimiento" defaultValue={sp.unidad_rendimiento} options={[{ value: "km_per_liter", label: "km/L" }, { value: "liters_per_hour", label: "L/h" }]} placeholder="Cualquier unidad" />
              <FilterSelect name="estado_operativo" defaultValue={sp.estado_operativo} options={[{ value: "operativo", label: "Operativo" }, { value: "inactivo_mantencion", label: "Inactivo — mantención" }, { value: "inactivo_fuera_servicio", label: "Inactivo — fuera de servicio" }, { value: "inactivo_revision", label: "Inactivo — revisión" }]} placeholder="Cualquier estado" />
              <Input name="sello_retirado" defaultValue={sp.sello_retirado} placeholder="Número de sello retirado" className="control" />
              <Input name="sello_instalado" defaultValue={sp.sello_instalado} placeholder="Número de sello instalado" className="control" />
              <FilterSelect name="evidencia_tipo" defaultValue={sp.evidencia_tipo} options={[{ value: "odometer", label: "Odómetro / horómetro" }, { value: "liter_meter", label: "Medidor de litros" }, { value: "removed_seal", label: "Sello retirado" }, { value: "installed_seal", label: "Sello instalado" }]} placeholder="Cualquier tipo de evidencia" />
              <label className="flex items-center gap-2 text-xs text-(--color-text-muted)"><input type="checkbox" name="observaciones" value="si" defaultChecked={sp.observaciones === "si"} />Sólo con observaciones</label>
            </fieldset>
            <fieldset className="grid gap-3 md:grid-cols-4">
              <legend className="text-eyebrow mb-2 md:col-span-4">Anomalías</legend>
              <FilterSelect name="anomalia_tipo" defaultValue={sp.anomalia_tipo} options={anomalyRulesList.map((item) => ({ value: item.code, label: item.name }))} placeholder="Cualquier tipo de anomalía" />
              <FilterSelect name="anomalia_severidad" defaultValue={sp.anomalia_severidad} options={ANOMALY_RULE_SEVERITIES.map((item) => ({ value: item, label: ANOMALY_RULE_SEVERITY_LABELS[item] }))} placeholder="Cualquier severidad" />
              <FilterSelect name="anomalia_responsable" defaultValue={sp.anomalia_responsable} options={anomalyAssigneesList.map((item) => ({ value: item.id, label: item.name }))} placeholder="Cualquier responsable" />
              <label className="flex items-center gap-2 text-xs text-(--color-text-muted)"><input type="checkbox" name="anomalia" value="si" defaultChecked={sp.anomalia === "si"} />Sólo con anomalías</label>
              <label className="flex items-center gap-2 text-xs text-(--color-text-muted)"><input type="checkbox" name="revision" value="si" defaultChecked={sp.revision === "si"} />Sólo marcados para revisión</label>
            </fieldset>
          </div>
        </details>
      </form>

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Link key={chip.key} href={chipRemoveHref(chip.key)}>
              <Badge variant="outline" size="sm" className="inline-flex items-center gap-1 hover:bg-(--color-surface-2)">{chip.label}<X size={10} /></Badge>
            </Link>
          ))}
        </div>
      )}

      <p className="mb-2 text-xs text-(--color-text-muted)">{pagination.totalItems} registros · mostrando {pagination.from}–{pagination.to}</p>

      {pagination.totalItems === 0 && chips.length > 0 && (
        <div className="mb-4 border border-dashed border-(--color-border-strong) p-4 text-center text-sm text-(--color-text-muted)">
          Sin coincidencias para estos filtros. Intenta con otros criterios o limpia los filtros para ver todos los registros.
        </div>
      )}
      {pagination.totalItems === 0 && chips.length === 0 && (
        <div className="mb-4 border border-dashed border-(--color-border-strong) p-4 text-center text-sm text-(--color-text-muted)">
          No hay registros en la bitácora para este alcance de faena. Si acabas de migrar, ejecuta la importación histórica TAE desde /combustibles/tae/importar.
        </div>
      )}

      <BitacoraTable rows={enriched} />

      <ServerPagination pagination={pagination} hrefForPage={pageHref} className="mt-2" />
    </PageContainer>
  )
}
