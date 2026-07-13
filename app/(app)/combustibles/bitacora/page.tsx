import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelProducts, fuelSuppliers, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getFuelLogRows, getFuelLogTotal, FUEL_LOG_SOURCE_LABEL, fuelLogDetailHref, fuelLogAuditEntity, type FuelLogSource } from "@/lib/combustibles/fuel-log"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X } from "@phosphor-icons/react/dist/ssr"
import { ServerPagination } from "@/components/ui/server-pagination"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { BitacoraTable } from "./bitacora-table"
import { BitacoraExportButton } from "./export-button"

export const metadata: Metadata = { title: "Bitácora general de combustible" }

const PAGE_SIZE = 50
const SOURCE_OPTIONS: FuelLogSource[] = ["tae_pwa", "invoiced", "operation_manual"]

type BitacoraSearchParams = {
  q?: string; desde?: string; hasta?: string; faena?: string; fuente?: string
  proveedor?: string; producto?: string; tipo?: string; observaciones?: string
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
  }
  const sort = sp.orden === "asc" ? "asc" as const : "desc" as const

  const scope = resolveWorksiteScope(session)

  const [worksitesList, suppliersList, productsList, equipmentTypesList, total] = await Promise.all([
    scope.mode === "none" ? Promise.resolve([]) : db.query.worksites.findMany({
      where: scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined,
      columns: { id: true, name: true },
      orderBy: [worksites.name],
    }),
    db.query.fuelSuppliers.findMany({ where: eq(fuelSuppliers.isActive, true), columns: { id: true, name: true }, orderBy: [fuelSuppliers.name] }),
    db.query.fuelProducts.findMany({ where: eq(fuelProducts.isActive, true), columns: { id: true, name: true }, orderBy: [fuelProducts.name] }),
    db.query.fuelEquipmentTypes.findMany({ where: eq(fuelEquipmentTypes.isActive, true), columns: { id: true, name: true }, orderBy: [fuelEquipmentTypes.name] }),
    getFuelLogTotal(session, filters),
  ])
  const pagination = resolvePagination({ pageParam: sp.page, totalItems: total, pageSize: PAGE_SIZE })
  const rows = await getFuelLogRows(session, filters, { limit: PAGE_SIZE, offset: pagination.offset, sort })

  const enriched = rows.map((row) => ({
    ...row,
    detailHref: fuelLogDetailHref(row),
    auditEntity: fuelLogAuditEntity(row),
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
  ].filter((chip): chip is { key: keyof BitacoraSearchParams; label: string } => chip !== null)

  return (
    <PageContainer width="full">
      <PageHeader
        title="Bitácora general"
        description="TAE, facturación y log operacional en una sola consulta, cada fila con su fuente original."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Bitácora general" }]} />}
        actions={<BitacoraExportButton filters={filters} />}
      />

      <form className="mb-4 grid gap-3 border-y border-(--color-border) py-4 md:grid-cols-4">
        <Input name="q" defaultValue={sp.q} placeholder="Equipo, patente, conductor, supervisor, proveedor…" className="md:col-span-2" />
        <input type="date" name="desde" defaultValue={sp.desde} className="control" />
        <input type="date" name="hasta" defaultValue={sp.hasta} className="control" />
        <select name="faena" defaultValue={sp.faena} className="control"><option value="">Todas las faenas autorizadas</option>{worksitesList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select name="fuente" defaultValue={sp.fuente} className="control"><option value="">Todas las fuentes</option>{SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{FUEL_LOG_SOURCE_LABEL[source]}</option>)}</select>
        <select name="proveedor" defaultValue={sp.proveedor} className="control"><option value="">Todos los proveedores</option>{suppliersList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select name="producto" defaultValue={sp.producto} className="control"><option value="">Todos los productos</option>{productsList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select name="tipo" defaultValue={sp.tipo} className="control"><option value="">Todos los tipos de equipo</option>{equipmentTypesList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <label className="flex items-center gap-2 text-xs text-(--color-text-muted)"><input type="checkbox" name="observaciones" value="si" defaultChecked={sp.observaciones === "si"} />Sólo con observaciones</label>
        <div className="flex flex-wrap items-center gap-2 md:col-span-4">
          <Button type="submit" variant="secondary">Aplicar</Button>
          {chips.length > 0 && <Link href="/combustibles/bitacora" className="text-xs text-(--color-text-muted) hover:underline">Limpiar filtros</Link>}
          <label className="ml-auto flex items-center gap-2 text-xs text-(--color-text-muted)">
            Orden
            <select name="orden" defaultValue={sp.orden === "asc" ? "asc" : "desc"} className="control w-44"><option value="desc">Más reciente primero</option><option value="asc">Más antiguo primero</option></select>
          </label>
        </div>
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

      <BitacoraTable rows={enriched} />

      <ServerPagination pagination={pagination} hrefForPage={pageHref} className="mt-2" />
    </PageContainer>
  )
}
