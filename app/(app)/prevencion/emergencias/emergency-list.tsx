"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Pagination } from "@/components/ui/pagination"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableCell, TableRow } from "@/components/ui/table"
import type { PaginationState } from "@/lib/pagination"
import {
  EMERGENCY_QUICK_FILTER_LABELS,
  type EmergencyListTab,
  type EmergencyQuickFilter,
} from "@/lib/prevention/emergency-list-filters"
import {
  EMERGENCY_DRILL_OUTCOME_LABELS,
  EMERGENCY_DRILL_STATUS_LABELS,
  EMERGENCY_PLAN_STATUS_LABELS,
  emergencyPlanStatusBadgeVariant,
} from "@/lib/prevention/emergency"
import { formatDateTime } from "@/lib/utils"
import { NewPlanDialog } from "./emergencias-dialogs"

type PlanItem = {
  id: string
  code: string
  title: string
  status: string
  worksiteName: string
  scenarios: number
  roles: number
  drills: number
}

type DrillItem = {
  id: string
  planTitle: string
  worksiteName: string
  scenarioType: string
  scheduledFor: string
  status: string
  outcome: string | null
}

interface Props {
  plans: PlanItem[]
  drills: DrillItem[]
  worksites: { id: string; name: string }[]
  canManage: boolean
  plansPagination: PaginationState
  tab: EmergencyListTab
  quickFilter: EmergencyQuickFilter
  counts: {
    totalPlans: number
    approvedPlans: number
    draftPlans: number
    totalDrills: number
    completedDrills: number
    needsImprovementDrills: number
    // El servicio ya calculaba estos cuatro y se perdían al bajar a la UI: el
    // tipado estructural acepta el objeto más ancho sin avisar, así que el
    // inventario de emergencia no se veía en ninguna pantalla del módulo.
    totalResources: number
    resourcesExpired: number
    resourcesOverdueInspection: number
    resourcesOutOfService: number
  }
}

const PLAN_COLUMNS = [
  { key: "plan", label: "Plan / faena" },
  { key: "status", label: "Estado", sortable: true },
  { key: "scenarios", label: "Escenarios", sortable: true, numeric: true },
  { key: "roles", label: "Organigrama", sortable: true, numeric: true },
  { key: "drills", label: "Simulacros", sortable: true, numeric: true },
]

const DRILL_COLUMNS = [
  { key: "plan", label: "Plan / faena" },
  { key: "scenarioType", label: "Escenario" },
  { key: "scheduledFor", label: "Programado" },
  { key: "status", label: "Estado" },
  { key: "outcome", label: "Resultado" },
]

export function EmergencyList({ plans, drills, worksites, canManage, plansPagination, tab, quickFilter, counts }: Props) {
  const searchParams = useSearchParams()
  const { setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const navigatePlansPage = React.useCallback((page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    window.location.search = params.toString()
  }, [searchParams])

  const planRows = plans.map((item) => ({
    ...item,
    plan: item.code,
  }))

  const drillRows = drills.map((item) => ({
    ...item,
  }))

  // EMERGENCIAS-09: el rótulo decía "Vigentes" y el contador no sabe nada de
  // vigencia — cuenta planes aprobados y sin archivar, y un plan aprobado hace
  // tres años sigue ahí. La periodicidad NO se agrega acá: ya vive en el
  // programa anual, que calendariza el plan de emergencia (N°83) y los
  // simulacros (N°84, dos veces al año) y los clasifica como `enganche`. Un
  // reloj propio en este módulo sería un segundo calendario con otro período,
  // compitiendo con el del PDTP. Lo que faltaba era el cable que cierra esas
  // actividades cuando el simulacro ocurre, y eso es EMERGENCIAS-05.
  const metrics = [
    { id: "approved", key: "approved" as const, tab: "plans" as const, label: "Planes aprobados", value: counts.approvedPlans, detail: "Sin archivar" },
    { id: "draft", key: "draft" as const, tab: "plans" as const, label: "En preparación", value: counts.draftPlans, detail: "Sin aprobar" },
    { id: "drills", key: "completed" as const, tab: "drills" as const, label: "Simulacros realizados", value: counts.completedDrills, detail: "Con resultado registrado" },
    { id: "needs_improvement", key: "needs_improvement" as const, tab: "drills" as const, label: "Requieren mejora", value: counts.needsImprovementDrills, detail: "Derivados a CAPA" },
  ]
  // Inventario de equipos de emergencia: es de faena, no de plan ni de
  // simulacro, así que no filtra ninguna de las dos pestañas. Se muestra como
  // resumen y no como botón para no fingir un filtro que no existe; el detalle
  // de cada equipo vive en el plan que lo declara y los vencimientos llegan a
  // la bandeja de Prevención.
  const resourceFacts = [
    { label: "Equipos", value: counts.totalResources },
    { label: "Vencidos", value: counts.resourcesExpired },
    { label: "Inspección atrasada", value: counts.resourcesOverdueInspection },
    { label: "Fuera de servicio", value: counts.resourcesOutOfService },
  ]

  const activeChips: ActiveFilterChip[] = quickFilter === "all" ? [] : [{
    key: "vista",
    label: "Vista",
    value: quickFilter,
    displayValue: EMERGENCY_QUICK_FILTER_LABELS[quickFilter],
  }]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            onClick={() => setFilters({ tab: metric.tab, vista: tab === metric.tab && quickFilter === metric.key ? null : metric.key })}
            aria-pressed={tab === metric.tab && quickFilter === metric.key}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      {counts.totalResources > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-[var(--color-border)] px-4 pb-3 text-sm">
          <span className="text-eyebrow">Inventario de emergencia</span>
          {/* El `<dl>` sólo admite dt/dd (o div) como hijos directos: el rótulo
              va fuera para no romper la regla `definition-list` de axe. */}
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            {resourceFacts.map((fact) => (
              <div key={fact.label} className="flex items-baseline gap-2">
                <dt className="text-xs text-[var(--color-text-subtle)]">{fact.label}</dt>
                <dd className="font-mono tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={() => setFilters({ vista: null })}
        onClearAll={() => clearUrlFilters(["tab"])}
        hasActiveFilters={quickFilter !== "all"}
        actions={tab === "plans" && canManage && worksites.length > 0 ? <NewPlanDialog worksites={worksites} /> : undefined}
      >
        <div role="tablist" aria-label="Vista de emergencias" className="flex gap-1 rounded-md border border-[var(--color-border)] p-1 w-fit">
          <button type="button" role="tab" onClick={() => setFilters({ tab: "plans", vista: null })} aria-selected={tab === "plans"}
            className="rounded px-3 py-1 text-sm aria-selected:bg-[var(--color-primary-tint)]">
            Planes ({counts.totalPlans})
          </button>
          <button type="button" role="tab" onClick={() => setFilters({ tab: "drills", vista: null })} aria-selected={tab === "drills"}
            className="rounded px-3 py-1 text-sm aria-selected:bg-[var(--color-primary-tint)]">
            Simulacros ({counts.totalDrills})
          </button>
        </div>
      </FilterToolbar>

      {tab === "plans" && (
        <>
        <DataTable
          caption="Planes de emergencia"
          disableInternalSearch
          columns={PLAN_COLUMNS}
          rows={planRows}
          searchKeys={[]}
          pageSize={Infinity}
          emptyTitle={plans.length === 0 ? "Aún no hay planes de emergencia" : "Ningún plan coincide con la búsqueda"}
          emptyDescription={plans.length === 0
            ? "Un plan de emergencia declara escenarios, organigrama de respuesta, recursos y contactos por faena. Aprobarlo exige al menos un escenario y un rol."
            : "Ajusta el texto del buscador superior."}
          emptyAction={canManage && worksites.length > 0 ? <NewPlanDialog worksites={worksites} /> : undefined}
          renderMobileCard={(item) => {
            return (
              <ResponsiveDataListCard
                title={<Link href={`/prevencion/emergencias/${item.id}`} className="hover:underline">{item.title}</Link>}
                description={<span className="font-mono">{item.code}</span>}
                status={<MetaBadge meta={{ label: EMERGENCY_PLAN_STATUS_LABELS[item.status] ?? item.status, variant: emergencyPlanStatusBadgeVariant(item.status) }} />}
                actions={<Link href={`/prevencion/emergencias/${item.id}`} className="inline-flex min-h-11 items-center text-xs font-medium text-[var(--color-primary-ink)] hover:underline">Ver plan</Link>}
              >
                <ResponsiveDataListField label="Faena">{item.worksiteName}</ResponsiveDataListField>
                <ResponsiveDataListField label="Escenarios"><span className="font-mono tabular-nums text-[var(--color-text)]">{item.scenarios}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Organigrama"><span className="font-mono tabular-nums text-[var(--color-text)]">{item.roles}</span></ResponsiveDataListField>
                <ResponsiveDataListField label="Simulacros"><span className="font-mono tabular-nums text-[var(--color-text)]">{item.drills}</span></ResponsiveDataListField>
              </ResponsiveDataListCard>
            )
          }}
          renderRow={(item) => {
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <Link href={`/prevencion/emergencias/${item.id}`} className="hover:underline">
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm font-medium">{item.title}</span>
                  </Link>
                  <span className="block text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>
                </TableCell>
                <TableCell>
                  <MetaBadge meta={{ label: EMERGENCY_PLAN_STATUS_LABELS[item.status] ?? item.status, variant: emergencyPlanStatusBadgeVariant(item.status) }} />
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">{item.scenarios}</TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">{item.roles}</TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">{item.drills}</TableCell>
              </TableRow>
            )
          }}
        />
        {plansPagination.totalPages > 1 && (
          <div className="flex justify-center pt-2">
            <Pagination page={plansPagination.page} total={plansPagination.totalItems} perPage={plansPagination.limit} onPage={navigatePlansPage} />
          </div>
        )}
        </>
      )}

      {tab === "drills" && (
        <DataTable
          caption="Simulacros de emergencia"
          columns={DRILL_COLUMNS}
          rows={drillRows}
          searchKeys={["planTitle", "worksiteName", "scenarioType"]}
          emptyTitle={drills.length === 0 ? "Aún no hay simulacros programados" : "Ningún simulacro coincide con la búsqueda"}
          emptyDescription={drills.length === 0
            ? "Sólo un plan aprobado puede programar simulacros. Prográmalos desde el detalle del plan."
            : "Ajusta el texto del buscador superior."}
          renderMobileCard={(item) => {
            return (
              <ResponsiveDataListCard
                title={item.planTitle}
                description={item.worksiteName}
                status={<MetaBadge meta={{ label: EMERGENCY_DRILL_STATUS_LABELS[item.status] ?? item.status, variant: item.status === "completed" ? "success" : item.status === "cancelled" ? "outline" : "default" }} />}
              >
                <ResponsiveDataListField label="Escenario">{item.scenarioType}</ResponsiveDataListField>
                <ResponsiveDataListField label="Programado">{formatDateTime(item.scheduledFor)}</ResponsiveDataListField>
                <ResponsiveDataListField label="Resultado" className="col-span-2">
                  {item.outcome
                    ? <MetaBadge meta={{ label: EMERGENCY_DRILL_OUTCOME_LABELS[item.outcome] ?? item.outcome, variant: item.outcome === "satisfactory" ? "success" : "warning" }} />
                    : "Sin resultado registrado"}
                </ResponsiveDataListField>
              </ResponsiveDataListCard>
            )
          }}
          renderRow={(item) => {
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <span className="block text-sm">{item.planTitle}</span>
                  <span className="text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>
                </TableCell>
                <TableCell className="text-sm">{item.scenarioType}</TableCell>
                <TableCell className="text-sm tabular-nums">{formatDateTime(item.scheduledFor)}</TableCell>
                <TableCell>
                  <MetaBadge meta={{ label: EMERGENCY_DRILL_STATUS_LABELS[item.status] ?? item.status, variant: item.status === "completed" ? "success" : item.status === "cancelled" ? "outline" : "default" }} />
                </TableCell>
                <TableCell>
                  {item.outcome
                    ? <MetaBadge meta={{ label: EMERGENCY_DRILL_OUTCOME_LABELS[item.outcome] ?? item.outcome, variant: item.outcome === "satisfactory" ? "success" : "warning" }} />
                    : <span className="text-sm text-[var(--color-text-subtle)]">—</span>}
                </TableCell>
              </TableRow>
            )
          }}
        />
      )}
    </div>
  )
}
