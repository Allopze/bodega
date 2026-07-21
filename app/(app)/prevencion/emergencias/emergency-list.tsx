"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Siren } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Pagination } from "@/components/ui/pagination"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
}

export function EmergencyList({ plans, drills, worksites, canManage }: Props) {
  const { searchQuery } = useSafeShellHeader()
  const [tab, setTab] = React.useState<"plans" | "drills">("plans")

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filteredPlans = plans.filter((item) =>
    !query || `${item.code} ${item.title} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query))
  const filteredDrills = drills.filter((item) =>
    !query || `${item.planTitle} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query))

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
          <button type="button" onClick={() => setTab("plans")} aria-pressed={tab === "plans"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
            Planes ({plans.length})
          </button>
          <button type="button" onClick={() => setTab("drills")} aria-pressed={tab === "drills"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
            Simulacros ({drills.length})
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "plans" && canManage && worksites.length > 0 && <NewPlanDialog worksites={worksites} />}
        </div>
      </div>

      {tab === "plans" && (filteredPlans.length === 0 ? (
        <EmptyState
          icon={<Siren size={20} />}
          title={plans.length === 0 ? "Aún no hay planes de emergencia" : "Ningún plan coincide con la búsqueda"}
          description={plans.length === 0
            ? "Un plan de emergencia declara escenarios, organigrama de respuesta, recursos y contactos por faena. Aprobarlo exige al menos un escenario y un rol."
            : "Ajusta el texto del buscador superior."}
          action={canManage && worksites.length > 0 ? <NewPlanDialog worksites={worksites} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan / faena</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Escenarios</TableHead>
                <TableHead className="text-right">Organigrama</TableHead>
                <TableHead className="text-right">Simulacros</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPlans.map((item) => (
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
              ))}
            </TableBody>
          </Table>
        </div>
        {tab === "plans" && plansPagination.totalPages > 1 && (
          <div className="flex justify-center pt-2">
            <Pagination page={plansPagination.page} total={plansPagination.totalItems} perPage={plansPagination.limit} onPage={navigatePlansPage} />
          </div>
        )}
      )}

      {tab === "drills" && (filteredDrills.length === 0 ? (
        <EmptyState
          icon={<Siren size={20} />}
          title={drills.length === 0 ? "Aún no hay simulacros programados" : "Ningún simulacro coincide con la búsqueda"}
          description={drills.length === 0
            ? "Sólo un plan aprobado puede programar simulacros. Prográmalos desde el detalle del plan."
            : "Ajusta el texto del buscador superior."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan / faena</TableHead>
                <TableHead>Escenario</TableHead>
                <TableHead>Programado</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDrills.map((item) => (
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
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}
