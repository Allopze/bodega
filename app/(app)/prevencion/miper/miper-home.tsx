"use client"

import Link from "next/link"
import { useCallback, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import { formatDate } from "@/lib/utils"
import type { MiperListRow } from "@/lib/services/miper/queries"
import type { MiperDashboard } from "@/lib/services/miper/dashboard"
import { MiperDashboardPanel } from "./dashboard-panel"
import { ImportMiperDialog } from "./import-dialog"
import { NewMiperDialog, type CreationWorksite } from "./new-miper-dialog"

// La pestaña vive en la URL. `porhacer` sigue siendo la de siempre por defecto
// (no cambia la costumbre); `?tab=resumen` es enlace directo.
const TABS = new Set(["resumen", "porhacer", "todas"])

/** Rótulos en español de `status` + `review_state` (nunca el enum crudo). */
const STATE_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "draft", label: "Borrador" },
  { value: "in_review", label: "En revisión técnica" },
  { value: "observed", label: "Con observaciones" },
  { value: "pending_approval", label: "Pendiente Legal y RRHH" },
  { value: "published", label: "Vigente" },
  { value: "superseded", label: "Reemplazado" },
]

/** Conteo por banda —de la más grave a la más leve— sin decir el color solo. */
function Distribution({ row }: { row: MiperListRow }) {
  const present = [...RISK_CLASSIFICATIONS].reverse().filter((cls) => row.classificationCounts[cls] > 0)
  if (present.length === 0) return <span className="text-xs text-[var(--color-text-subtle)]">Sin riesgos evaluados</span>
  return (
    <span className="flex flex-wrap gap-1">
      {present.map((cls) => (
        <span key={cls} className="inline-flex items-center gap-1">
          <RiskClassificationBadge classification={cls} size="sm" />
          <span className="text-xs tabular-nums">{row.classificationCounts[cls]}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * Filtros primarios (§8.6): faena, período, estado y responsable. El responsable
 * es nuevo en la portada y sale de quién tiene trabajo asignado —actividad del
 * programa o medida—, no de quién firmó.
 */
function FilterBar({ values, worksiteOptions, periodOptions, responsibleOptions, onChange }: {
  values: { faena: string; periodo: string; estado: string; responsable: string }
  worksiteOptions: Array<[string, string]>
  periodOptions: number[]
  responsibleOptions: Array<{ id: string; name: string }>
  onChange: (next: Record<string, string | null>) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={values.faena} onValueChange={(value) => onChange({ faena: value })}>
        <SelectTrigger aria-label="Faena" className="w-56"><SelectValue placeholder="Todas las faenas" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Todas las faenas</SelectItem>{worksiteOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={values.periodo} onValueChange={(value) => onChange({ periodo: value })}>
        <SelectTrigger aria-label="Período" className="w-40"><SelectValue placeholder="Todos los períodos" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Todos los períodos</SelectItem>{periodOptions.map((period) => <SelectItem key={period} value={String(period)}>{period}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={values.estado} onValueChange={(value) => onChange({ estado: value })}>
        <SelectTrigger aria-label="Estado" className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>{STATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={values.responsable} onValueChange={(value) => onChange({ responsable: value })}>
        <SelectTrigger aria-label="Responsable" className="w-56"><SelectValue placeholder="Cualquier responsable" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Cualquier responsable</SelectItem>{responsibleOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

export function MiperHome({ inbox, all, dashboard, creationWorksites, currentYear, permissions }: {
  inbox: MiperListRow[]
  all: MiperListRow[]
  dashboard: MiperDashboard
  creationWorksites: CreationWorksite[]
  currentYear: number
  permissions: { canEdit: boolean; canManageCatalog: boolean }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [creating, setCreating] = useState(false)
  // La pestaña vive en la URL: un enlace a `?tab=todas` abre la lista completa.
  const requestedTab = searchParams.get("tab") ?? ""
  const tab = TABS.has(requestedTab) ? requestedTab : "porhacer"

  // Los cambios se agrupan en UNA sola escritura: tres `replace` seguidos desde
  // el mismo `searchParams` se pisaban entre sí y el último resucitaba los
  // filtros que los otros acababan de quitar.
  const update = useCallback((next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value && value !== "all" && !(key === "tab" && value === "porhacer")) params.set(key, value)
      else params.delete(key)
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  const clearFilters = useCallback(() => {
    update({ faena: null, periodo: null, estado: null, responsable: null, clasificacion: null, control: null, vista: null })
  }, [update])

  // Las opciones de filtro salen de lo que ya se está listando: ofrecer una
  // faena que la persona no puede ver llevaría a una lista vacía sin explicación.
  const worksiteOptions = [...new Map(all.map((row) => [row.worksiteId, row.worksiteName])).entries()]
  const periodOptions = [...new Set(all.map((row) => row.period).filter((period): period is number => period !== null))].sort((a, b) => b - a)
  const filtersActive = ["faena", "periodo", "estado", "responsable"].some((key) => searchParams.get(key))
  const filterValues = {
    faena: searchParams.get("faena") ?? "all",
    periodo: searchParams.get("periodo") ?? "all",
    estado: searchParams.get("estado") ?? "all",
    responsable: searchParams.get("responsable") ?? "all",
  }

  /* Los tiles del Resumen enlazan a esta lista con `clasificacion` o `control`.
   * El subconjunto se acota con las MISMAS cifras que muestra el tablero —no con
   * una regla paralela— y el responsable ya viene aplicado desde el servicio, así
   * que basta con que la MIPER esté entre las filas del tablero. */
  const tileFilters = [
    searchParams.get("clasificacion") === "grave" ? "Intolerables e Importantes" : null,
    searchParams.get("control") === "no" ? "Sin controlar" : null,
    searchParams.get("vista") === "avance" ? "Con avance del programa" : null,
  ].filter((label): label is string => label !== null)
  const showAvance = searchParams.get("vista") === "avance"
  const listRows = tileFilters.length === 0 ? all : all.filter((row) => {
    const summary = dashboard.rows.find((candidate) => candidate.matrixId === row.id)
    if (!summary) return false
    if (searchParams.get("clasificacion") === "grave" && summary.classificationCounts.important + summary.classificationCounts.intolerable === 0) return false
    if (searchParams.get("control") === "no" && summary.uncontrolledCount === 0) return false
    return true
  })
  const avanceOf = (matrixId: string) => {
    const progress = dashboard.rows.find((candidate) => candidate.matrixId === matrixId)?.progress
    if (!progress || progress.ratio === null) return "—"
    return `${Math.round(progress.ratio * 100)}% · ${progress.done}/${progress.planned}`
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Matriz IPER (MIPER)"
        description="Identificación de peligros y evaluación de riesgos por faena y período, con revisión técnica y aprobación Legal y RRHH."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "MIPER" }]} />}
        actions={<div className="flex gap-2">
          {permissions.canManageCatalog && <Button asChild variant="secondary"><Link href="/prevencion/miper/factores">Factores de riesgo</Link></Button>}
          {permissions.canEdit && <ImportMiperDialog worksites={creationWorksites} currentYear={currentYear} canManageCatalog={permissions.canManageCatalog} />}
          {permissions.canEdit && <Button onClick={() => setCreating(true)} disabled={creationWorksites.length === 0}>Nueva MIPER</Button>}
        </div>}
      />
      <Tabs value={tab} onValueChange={(value) => update({ tab: value })}>
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="porhacer">Por hacer ({inbox.length})</TabsTrigger>
          <TabsTrigger value="todas">Todas</TabsTrigger>
        </TabsList>
        <TabsContent value="resumen" className="space-y-3">
          <FilterBar values={filterValues} worksiteOptions={worksiteOptions} periodOptions={periodOptions} responsibleOptions={dashboard.responsibleOptions} onChange={update} />
          <MiperDashboardPanel dashboard={dashboard} filtersActive={filtersActive} onClearFilters={clearFilters} />
        </TabsContent>
        <TabsContent value="porhacer" className="space-y-2">
          {inbox.length === 0 ? (
            <EmptyState
              title="No tienes MIPER pendientes"
              description={permissions.canEdit ? "Cuando tengas un borrador, observaciones por responder o cambios sin enviar, aparecerán aquí. Para empezar, crea la MIPER de una faena." : "Cuando una MIPER espere tu revisión o tu firma, aparecerá aquí."}
              action={permissions.canEdit ? <Button onClick={() => setCreating(true)} disabled={creationWorksites.length === 0}>Nueva MIPER</Button> : undefined}
            />
          ) : inbox.map((row) => (
            <Link key={row.id} href={`/prevencion/miper/${row.id}`} className="block rounded-2xl border border-[var(--color-border)] bg-white p-4 transition-colors hover:border-[var(--color-border-strong)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-signal-ink)]">{row.inboxReason}</p>
                  <p className="mt-1 font-semibold">{row.worksiteName} · {row.period ?? "sin período"}</p>
                  <p className="text-sm text-[var(--color-text-subtle)]">{row.label}{row.submittedByName ? ` · enviada por ${row.submittedByName}${row.submittedAt ? ` el ${formatDate(row.submittedAt)}` : ""}` : ""} · {row.entryCount} riesgos · modificada {formatDate(row.updatedAt)}</p>
                </div>
                <Distribution row={row} />
              </div>
            </Link>
          ))}
        </TabsContent>
        <TabsContent value="todas" className="space-y-3">
          <FilterBar values={filterValues} worksiteOptions={worksiteOptions} periodOptions={periodOptions} responsibleOptions={dashboard.responsibleOptions} onChange={update} />
          {tileFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[var(--color-text-subtle)]">Filtros del tablero:</span>
              {tileFilters.map((label) => (
                <span key={label} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">{label}</span>
              ))}
              <Button type="button" variant="ghost" size="sm" onClick={() => update({ clasificacion: null, control: null, vista: null })}>Quitar</Button>
            </div>
          )}
          <DataTable
            caption="MIPER por faena y período"
            columns={[
              { key: "worksiteName", label: "Faena", sortable: true },
              { key: "period", label: "Período", sortable: true },
              { key: "label", label: "Estado" },
              { key: "entryCount", label: "Riesgos", numeric: true },
              { key: "distribution", label: "Clasificación" },
              ...(showAvance ? [{ key: "avance", label: "Avance", numeric: true }] : []),
              { key: "updatedAt", label: "Modificada", sortable: true },
            ]}
            rows={listRows}
            searchKeys={["worksiteName", "label"]}
            emptyTitle="Sin MIPER para estos filtros"
            emptyDescription={permissions.canEdit ? "Cambia los filtros o crea la MIPER de una faena." : "Cambia los filtros para ver otras faenas o períodos."}
            emptyAction={filtersActive || tileFilters.length > 0 ? <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>Limpiar filtros</Button> : undefined}
            renderRow={(row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => router.push(`/prevencion/miper/${row.id}`)}>
                <TableCell><Link href={`/prevencion/miper/${row.id}`} className="font-medium hover:underline">{row.worksiteName}</Link></TableCell>
                <TableCell>{row.period ?? "—"}</TableCell>
                <TableCell>{row.label}</TableCell>
                <TableCell className="tabular-nums">{row.entryCount}</TableCell>
                <TableCell><Distribution row={row} /></TableCell>
                {showAvance ? <TableCell className="tabular-nums">{avanceOf(row.id)}</TableCell> : null}
                <TableCell>{formatDate(row.updatedAt)}</TableCell>
              </TableRow>
            )}
          />
        </TabsContent>
      </Tabs>
      <NewMiperDialog open={creating} onOpenChange={setCreating} worksites={creationWorksites} currentYear={currentYear} />
    </PageContainer>
  )
}
