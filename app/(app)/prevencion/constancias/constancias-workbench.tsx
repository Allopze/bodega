"use client"

import * as React from "react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MONTH_LABELS } from "@/lib/services/pdtp/constants"
import type { listPdtpConstanciaActivities } from "@/lib/services/prevention-pdtp"
import { PdtpDeviationForm } from "../pdtp/pdtp-deviation-form"
import { PdtpExecutionForm } from "../pdtp/pdtp-execution-form"

type ConstanciaView = Awaited<ReturnType<typeof listPdtpConstanciaActivities>>
type Worksite = { id: string; name: string; code: string }

export function ConstanciasWorkbench({
  worksites, view, initialWorksiteId, canExecute,
}: {
  worksites: Worksite[]
  view: ConstanciaView
  initialWorksiteId: string
  canExecute: boolean
}) {
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState("open")
  const [worksiteId, setWorksiteId] = React.useState(
    view && worksites.some((item) => item.id === initialWorksiteId) ? initialWorksiteId : "all",
  )
  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const debts = React.useMemo(() => view?.debts ?? [], [view])

  const counts = React.useMemo(() => ({
    pending: debts.filter((row) => row.status === "pending").length,
    overdue: debts.filter((row) => row.status === "overdue").length,
  }), [debts])

  const rows = debts.filter((row) => {
    if (status !== "open" && row.status !== status) return false
    if (worksiteId !== "all" && row.worksiteId !== worksiteId) return false
    if (!query) return true
    return [row.activityName, row.worksiteName, row.responsibleDisplay]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase("es-CL").includes(query))
  })

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Constancias"
        description="Actividades del Programa de Trabajo Preventivo que se cumplen dejando constancia: se hicieron o no se hicieron, con evidencia u observación."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Programa de trabajo", href: "/prevencion/pdtp" }, { label: "Constancias" }]} />}
      />

      {!view ? (
        <EmptyState title="No hay un programa activo" description="Activa una versión del Programa de Trabajo Preventivo para poder dejar constancias." />
      ) : (
        <>
          <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] sm:grid-cols-2">
            {[
              { key: "pending", label: "Pendientes", value: counts.pending, detail: "Dentro del mes en curso" },
              { key: "overdue", label: "Vencidas", value: counts.overdue, detail: "Meses anteriores sin marcar" },
            ].map((metric) => (
              <button key={metric.key} type="button" onClick={() => setStatus((current) => current === metric.key ? "open" : metric.key)} aria-pressed={status === metric.key} className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]">
                <span className="text-eyebrow">{metric.label}</span>
                <strong className="mt-1 block font-mono text-xl tabular-nums">{metric.value}</strong>
                <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44" aria-label="Estado"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Todas las deudas</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="overdue">Vencidas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={worksiteId} onValueChange={setWorksiteId}>
              <SelectTrigger className="w-56" aria-label="Faena"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas las faenas visibles</SelectItem>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {debts.length === 0 ? (
            <EmptyState title="Sin deudas de constancia" description="Todas las actividades de constancia están al día en las faenas visibles." />
          ) : rows.length === 0 ? (
            <EmptyState compact title="No hay resultados con estos filtros" description="Cambia el estado, la faena o el texto del filtro superior." action={<Button type="button" variant="secondary" onClick={() => { setStatus("open"); setWorksiteId("all") }}>Limpiar filtros</Button>} />
          ) : (
            <div className="mt-4 divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              {rows.map((row) => (
                <article key={`${row.activityId}:${row.worksiteId}`} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_14rem_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <MetaBadge meta={{ label: `${row.status === "overdue" ? "Vencida" : "Pendiente"}`, variant: row.status === "overdue" ? "danger" : "warning" }} dot />
                      <span className="font-mono text-xs text-[var(--color-text-subtle)]">Actividad {row.n}</span>
                      <span className="text-xs text-[var(--color-text-subtle)]">{row.worksiteName}</span>
                    </div>
                    <h2 className="mt-2 text-sm font-semibold text-[var(--color-text)]">{row.activityName}</h2>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Responsable: {row.responsibleDisplay}
                      {row.evidenceRequirement ? ` · Evidencia: ${row.evidenceRequirement}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-eyebrow">Mes que corresponde marcar</p>
                    <p className={row.status === "overdue" ? "mt-1 text-sm font-semibold text-[var(--color-danger)]" : "mt-1 text-sm text-[var(--color-text)]"}>
                      {MONTH_LABELS[row.dueMonth - 1]}
                      {row.overdueMonths > 1 ? ` · atrasada ${row.overdueMonths} meses` : ""}
                    </p>
                  </div>
                  {canExecute && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <PdtpExecutionForm
                        activityId={row.activityId}
                        worksiteId={row.worksiteId}
                        year={view.programYear}
                        defaultMonth={row.dueMonth}
                        effectiveFrom={view.effectiveFrom}
                        evidenceRequirement={row.evidenceRequirement}
                      />
                      <PdtpDeviationForm
                        activityId={row.activityId}
                        activityN={row.n}
                        activityName={row.activityName}
                        worksiteId={row.worksiteId}
                        year={view.programYear}
                        defaultMonth={row.dueMonth}
                        defaultWeek={row.dueWeek}
                        canDeclareNotPerformed={canExecute}
                        canDeclareNotApplicable={canExecute}
                      />
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}
