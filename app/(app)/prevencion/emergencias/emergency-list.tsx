"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { Pagination } from "@/components/ui/pagination"
import { TableCell, TableRow } from "@/components/ui/table"
import type { PaginationState } from "@/lib/pagination"
import {
  EMERGENCY_DRILL_OUTCOME_LABELS,
  EMERGENCY_DRILL_STATUS_LABELS,
  EMERGENCY_PLAN_STATUS_LABELS,
  emergencyPlanStatusBadgeVariant,
} from "@/lib/prevention/emergency"
import { formatDateTime } from "@/lib/utils"
import { NewPlanDialog } from "./emergencias-dialogs"

interface PlanItem {
  id: string
  code: string
  title: string
  status: string
  worksiteName: string
  scenarios: number
  roles: number
  drills: number
}

interface DrillItem {
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

export function EmergencyList({ plans, drills, worksites, canManage, plansPagination }: Props) {
  const searchParams = useSearchParams()
  const { getFilter, setFilter } = useUrlFilters()
  const tab = (getFilter("tab") || "plans") as "plans" | "drills"
  const navigatePlansPage = React.useCallback((page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(page))
    window.location.search = params.toString()
  }, [searchParams])

  const planRows = plans.map((item) => ({
    ...item,
    plan: item.code,
  })) as unknown as Record<string, unknown>[]

  const drillRows = drills.map((item) => ({
    ...item,
  })) as unknown as Record<string, unknown>[]

  const metrics = [
    { id: "approved", label: "Planes aprobados", value: plans.filter((item) => item.status === "approved").length, detail: "Vigentes" },
    { id: "draft", label: "En preparación", value: plans.filter((item) => item.status === "draft").length, detail: "Sin aprobar" },
    { id: "drills", label: "Simulacros realizados", value: drills.filter((item) => item.status === "completed").length, detail: "Con resultado registrado" },
    { id: "needs_improvement", label: "Requieren mejora", value: drills.filter((item) => item.outcome === "needs_improvement").length, detail: "Derivados a CAPA" },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.id} className="border-r border-[var(--color-border)] px-4 py-3">
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1 w-fit">
          <button type="button" onClick={() => setFilter("tab", "plans")} aria-pressed={tab === "plans"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
            Planes ({plans.length})
          </button>
          <button type="button" onClick={() => setFilter("tab", "drills")} aria-pressed={tab === "drills"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
            Simulacros ({drills.length})
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "plans" && canManage && worksites.length > 0 && <NewPlanDialog worksites={worksites} />}
        </div>
      </div>

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
          renderRow={(row) => {
            const item = row as unknown as PlanItem
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
                  <Badge variant={emergencyPlanStatusBadgeVariant(item.status)}>
                    {EMERGENCY_PLAN_STATUS_LABELS[item.status] ?? item.status}
                  </Badge>
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
          renderRow={(row) => {
            const item = row as unknown as DrillItem
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <span className="block text-sm">{item.planTitle}</span>
                  <span className="text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>
                </TableCell>
                <TableCell className="text-sm">{item.scenarioType}</TableCell>
                <TableCell className="text-sm tabular-nums">{formatDateTime(item.scheduledFor)}</TableCell>
                <TableCell>
                  <Badge variant={item.status === "completed" ? "success" : item.status === "cancelled" ? "outline" : "default"}>
                    {EMERGENCY_DRILL_STATUS_LABELS[item.status] ?? item.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {item.outcome
                    ? <Badge variant={item.outcome === "satisfactory" ? "success" : "warning"}>{EMERGENCY_DRILL_OUTCOME_LABELS[item.outcome] ?? item.outcome}</Badge>
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
