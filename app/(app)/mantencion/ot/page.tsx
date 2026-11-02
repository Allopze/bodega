import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { ClipboardText } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ServerPagination } from "@/components/ui/server-pagination"
import { StageTabs } from "@/components/ui/stage-tabs"
import { NewWorkOrderCta } from "@/components/mantencion/jefatura/ot/new-ot-sheet"
import { OT_FILTER_PARAMS, buildOtTabs, hasWorkOrderFilters, parseWorkOrderQuery, type RawSearchParams } from "@/components/mantencion/jefatura/ot/ot-filters"
import { OtListFilters } from "@/components/mantencion/jefatura/ot/ot-list-filters"
import { OtTable } from "@/components/mantencion/jefatura/ot/ot-table"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import {
  listAssignableMechanics, listWorkOrderEquipmentOptions, listWorkOrders, loadWorkOrderFilterOptions, type WorkOrderTab,
} from "@/lib/services/mantencion/work-orders/query"
import { todayInChile } from "@/lib/utils"
import { OtExportButton } from "./ot-export-button"

export const metadata: Metadata = { title: "Órdenes de trabajo" }
export const dynamic = "force-dynamic"

const PATHNAME = "/mantencion/ot"

/** Qué dice una pestaña vacía: qué significa y qué hacer, sin jerga (regla A4). */
function emptyCopy(tab: WorkOrderTab, filtered: boolean): { title: string; description: string } {
  if (filtered) return { title: "Ninguna orden coincide con estos filtros", description: "Prueba con otro período o quita algún filtro." }
  switch (tab) {
    case "solicitada": return { title: "No hay órdenes por asignar", description: "Las órdenes nuevas esperan aquí hasta que se asigna un mecánico o uno la toma desde la app." }
    case "asignada": return { title: "No hay órdenes asignadas", description: "Aquí quedan las órdenes con mecánico que aún no ingresan el equipo al taller." }
    case "en_ejecucion": return { title: "No hay equipos en taller", description: "Cuando un mecánico registra el ingreso de un equipo, la orden aparece aquí hasta su salida." }
    case "trabajo_terminado": return { title: "No hay equipos por recibir", description: "Aquí aparecen las órdenes con el trabajo terminado, a la espera de quien retira el equipo del taller." }
    case "recepcionada": return { title: "No hay órdenes por conformidad", description: "Aquí esperan las órdenes que el administrador de contrato debe recibir en faena para cerrarlas." }
    case "cerrada": return { title: "Aún no hay órdenes cerradas", description: "Una orden se cierra cuando se da la conformidad en faena." }
    case "anulada": return { title: "No hay órdenes anuladas", description: "Las órdenes anuladas siguen visibles aquí, con su motivo." }
    default: return { title: "Todavía no hay órdenes de trabajo abiertas", description: "Pide una reparación o una mantención para un equipo y sigue aquí cada paso, hasta la recepción en faena." }
  }
}

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:ot:view_worksite", "mant:ot:view_all"], "/mantencion/ot")
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const raw = await searchParams
  const filters = parseWorkOrderQuery(raw)
  const canCreate = can(session, "mant:ot:create")
  const canManage = can(session, "mant:ot:manage")

  const [options, list, equipment, mechanics] = await Promise.all([
    loadWorkOrderFilterOptions(viewer),
    listWorkOrders(viewer, filters),
    listWorkOrderEquipmentOptions(viewer),
    canCreate && canManage ? listAssignableMechanics() : Promise.resolve(null),
  ])

  const pagination = resolvePagination({ pageParam: String(filters.page), totalItems: list.total, pageSize: filters.pageSize })
  const filtered = hasWorkOrderFilters(filters)
  const empty = emptyCopy(filters.tab, filtered)
  const exportFilters = { tab: filters.tab, worksiteId: filters.worksiteId, vehicleId: filters.vehicleId, assignedToUserId: filters.assignedToUserId, from: filters.from, to: filters.to, q: filters.q }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first && !(OT_FILTER_PARAMS as readonly string[]).includes(key) && key !== "pagina") params.set(key, first)
  }
  const clearFiltersHref = params.toString() ? `${PATHNAME}?${params.toString()}` : PATHNAME

  const cta = {
    equipment,
    mechanics,
    today: todayInChile(),
    defaultRequesterName: session.user.name ?? "",
  }

  return (
    <PageContainer>
      <PageHeader
        title="Órdenes de trabajo"
        description="Reparaciones y mantenciones pedidas al taller, desde la solicitud hasta la recepción en faena."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Órdenes de trabajo" }]}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <OtExportButton filters={exportFilters} />
            {canCreate && <NewWorkOrderCta {...cta} />}
          </div>
        )}
      />

      <div className="mb-3">
        <Suspense fallback={<div className="h-11 border-b border-[var(--color-border)] sm:h-9" aria-hidden />}>
          <StageTabs tabs={buildOtTabs(list.counts)} ariaLabel="Estado de las órdenes de trabajo" pageParam="pagina" />
        </Suspense>
      </div>

      <OtListFilters
        options={options}
        equipment={equipment.map((item) => ({
          id: item.id,
          label: item.plate && item.plate !== item.code ? `${item.code} · ${item.plate}` : item.code,
          hint: `${item.typeName} · ${item.worksiteName}`,
        }))}
      />

      {list.rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={22} aria-hidden />}
          title={empty.title}
          description={empty.description}
          action={filtered
            ? <Button asChild variant="secondary"><Link href={clearFiltersHref}>Quitar los filtros</Link></Button>
            : canCreate && filters.tab === "abiertas"
              ? <NewWorkOrderCta {...cta} triggerLabel="Crear la primera orden" />
              : undefined}
        />
      ) : (
        <>
          <OtTable rows={list.rows} />
          <ServerPagination pagination={pagination} hrefForPage={(page) => buildPaginationHref(PATHNAME, raw, page, "pagina")} />
        </>
      )}
    </PageContainer>
  )
}
