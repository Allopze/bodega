"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge, metaFor, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { CreateChoiceButton } from "@/components/ui/create-choice-button"
import { DataTable } from "@/components/ui/data-table"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect } from "@/components/ui/option-select"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Progress } from "@/components/ui/progress"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { SummaryBar, type SummaryLinkProps } from "@/components/ui/summary-bar"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  filterPortfolioRows, hasPortfolioFilters, parsePortfolioParams, PORTFOLIO_STATUS_FILTER_OPTIONS, PORTFOLIO_STATUS_LABEL,
  PORTFOLIO_SUMMARY_HREF, portfolioHref, portfolioSummary,
  type MiperPortfolioAction, type MiperPortfolioMatrix, type MiperPortfolioRow, type MiperPortfolioStatus,
} from "@/lib/prevention/miper/portfolio"
import { progressPercent } from "@/lib/prevention/miper/progress"
import { countOf, formatDate } from "@/lib/utils"
import { ImportMiperDialog } from "./import-dialog"
import { NewMiperDialog, type CreationWorksite } from "./new-miper-dialog"

/** Estado de la faena → badge (A6: nunca el valor crudo; `MetaBadge`, no un mapa local de variantes). */
const STATUS_META: Record<MiperPortfolioStatus, StateMetaInput> = {
  sin_miper: { label: PORTFOLIO_STATUS_LABEL.sin_miper, variant: "neutral" },
  borrador: { label: PORTFOLIO_STATUS_LABEL.borrador, variant: "outline" },
  en_revision: { label: PORTFOLIO_STATUS_LABEL.en_revision, variant: "info" },
  observada: { label: PORTFOLIO_STATUS_LABEL.observada, variant: "warning" },
  vigente: { label: PORTFOLIO_STATUS_LABEL.vigente, variant: "success" },
}

const COLUMNS = [
  { key: "worksiteName", label: "Faena", sortable: true },
  { key: "status", label: "Estado" },
  { key: "pending", label: "Trabajo pendiente" },
  { key: "action", label: "Acción" },
]

const NO_CREATION_HINT = "No hay faenas activas a tu alcance"
const NO_PROGRAM = "Sin programa"

/**
 * Las cifras FILTRAN esta misma lista: `replace` y sin mover el scroll (AGENTS,
 * «Navigation and scroll preservation»). A nivel de módulo: `SummaryBar` es
 * `memo` y un `renderLink` nuevo en cada render lo invalidaría.
 */
function ReplaceLink({ href, className, children, ...rest }: SummaryLinkProps) {
  return <Link href={href} replace scroll={false} className={className} {...rest}>{children}</Link>
}

/** A1: una cifra en cero se ve, pero no enlaza a una lista vacía. */
const linkUnlessZero = (count: number, href: string) => (count > 0 ? href : undefined)

const matrixHref = (matrixId: string) => `/prevencion/miper/${matrixId}?tab=resumen`
const periodLabel = (period: number | null) => (period === null ? "sin período" : String(period))
const actionLabel = (action: MiperPortfolioAction) => `${action.reason} · MIPER ${periodLabel(action.period)}`

function vigenteLabel(matrix: MiperPortfolioMatrix) {
  if (matrix.isLegacy) return `Vigente · metodología anterior (${periodLabel(matrix.period)})`
  return `Vigente ${matrix.versionNumber ? `v${matrix.versionNumber} ` : ""}(${periodLabel(matrix.period)})`
}

/**
 * Avance del programa de la vigente (o de la MIPER de la fila). `null` es una
 * faena sin MIPER; sin nada planificado —sin programa o sin ocurrencias— se
 * dice «Sin programa», nunca un 0 % que se leería como atraso. Si la vigente no
 * es la MIPER de la fila, la celda lo aclara con «en la vigente», como «sin
 * control» (Decisión 3 del plan).
 */
function programLabel(row: MiperPortfolioRow): string | null {
  const progress = row.programProgress
  if (!progress) return null
  const where = row.vigente ? " en la vigente" : ""
  if (progress.planned === 0) return `${NO_PROGRAM}${where}`
  return `${progressPercent(progress)}% · ${progress.done}/${progress.planned}${where}`
}

/** Faena, su MIPER, la vigente si es otra y lo que cada MIPER espera de ti (un enlace por acción). */
function Worksite({ row }: { row: MiperPortfolioRow }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="font-medium">
        {row.matrix ? <Link href={matrixHref(row.matrix.id)} className="hover:underline">{row.worksiteName}</Link> : row.worksiteName}
        {!row.worksiteActive && <span className="ml-2 text-xs font-normal text-[var(--color-text-subtle)]">Faena cerrada</span>}
      </p>
      {row.matrix && (
        <p className="text-xs text-[var(--color-text-subtle)]">MIPER {periodLabel(row.matrix.period)}{row.matrix.versionNumber ? ` · v${row.matrix.versionNumber}` : ""}</p>
      )}
      {row.vigente && (
        <p className="text-xs"><Link href={matrixHref(row.vigente.id)} className="text-[var(--color-text-muted)] hover:underline">{vigenteLabel(row.vigente)}</Link></p>
      )}

    </div>
  )
}

function State({ row }: { row: MiperPortfolioRow }) {
  const meta = metaFor(STATUS_META, row.status)
  const detail = [row.matrix && row.stateLabel !== meta.label ? row.stateLabel : null, row.submittedByName ? `enviada por ${row.submittedByName}` : null].filter(Boolean).join(" · ")
  return (
    <div className="flex flex-col items-start gap-1">
      <MetaBadge meta={meta} />
      {detail && <p className="text-xs text-[var(--color-text-subtle)]">{detail}</p>}

    </div>
  )
}

function Completeness({ row }: { row: MiperPortfolioRow }) {
  if (row.matrix?.isLegacy) return <span className="text-xs text-[var(--color-text-subtle)]">Metodología anterior</span>
  if (!row.completeness) return <span className="text-xs text-[var(--color-text-subtle)]">—</span>
  const { complete, total } = row.completeness
  if (total === 0) return <span className="text-xs text-[var(--color-text-subtle)]">Sin riesgos</span>
  return (
    <span className="flex min-w-32 items-center gap-2">
      <Progress value={complete} max={total} size="sm" label={`${row.worksiteName}: ${complete} de ${total} completos`} className="flex-1" />
      <span className="text-xs tabular-nums">{complete}/{total}</span>
    </span>
  )
}

function CriticalWithoutControl({ row }: { row: MiperPortfolioRow }) {
  if (row.criticalWithoutControl === 0) return null
  return (
    <span className="block text-xs font-medium text-[var(--color-danger-ink)]">
      {countOf(row.criticalWithoutControl, "crítico sin control", "críticos sin control")}{row.vigente ? " en la vigente" : ""}
    </span>
  )
}

function CreateMatrixChoice({ worksites, currentYear, canManageCatalog, initialWorksiteId = null }: {
  worksites: CreationWorksite[]; currentYear: number; canManageCatalog: boolean; initialWorksiteId?: string | null
}) {
  const worksiteName = worksites.find((item) => item.id === initialWorksiteId)?.name
  return <CreateChoiceButton label="Crear matriz" title="Crear matriz de riesgos"
    description={worksiteName ? `Faena: ${worksiteName}. Elige cómo comenzar.` : "Elige cómo comenzar. En el siguiente paso indicarás la faena y el período."}
    choices={[
      { key: "manual", label: "Completar en la plataforma", description: "Crea las actividades y tareas, o copia una matriz vigente.", soloLabel: "Crear matriz",
        render: (props) => <NewMiperDialog {...props} worksites={worksites} currentYear={currentYear} initialWorksiteId={initialWorksiteId} /> },
      { key: "excel", label: "Importar desde Excel", description: "Revisa los riesgos y las medidas del archivo antes de incorporarlos.", soloLabel: "Importar desde Excel",
        render: (props) => <ImportMiperDialog {...props} hideTrigger worksites={worksites} currentYear={currentYear} initialWorksiteId={initialWorksiteId} canManageCatalog={canManageCatalog} /> },
    ]} />
}

function PendingWork({ row }: { row: MiperPortfolioRow }) {
  const pending = row.completeness ? row.completeness.total - row.completeness.complete : null
  return <div className="space-y-1 text-sm">
    {row.myActions.map((action) => <p key={action.matrixId} className="font-medium text-[var(--color-signal-ink)]">{actionLabel(action)}</p>)}
    <p>{!row.matrix ? "Crear la primera matriz" : row.matrix.isLegacy ? "Metodología anterior" : row.completeness?.total === 0 ? "Identificar las primeras tareas y riesgos" : pending === null ? "Consultar el documento" : pending > 0 ? `${countOf(pending, "riesgo")} con datos pendientes` : "Datos de riesgos completos"}</p>
    <CriticalWithoutControl row={row} />
    {row.matrix && !row.matrix.isLegacy && <details className="text-xs text-[var(--color-text-subtle)]">
      <summary className="cursor-pointer">Ver avance y datos</summary>
      <div className="mt-2 space-y-1"><Completeness row={row} />
        <p>{programLabel(row)}</p>
        <p>Dotación {row.headcount} · Actualizada {row.updatedAt ? formatDate(row.updatedAt) : "sin fecha"}</p>
      </div>
    </details>}
  </div>
}

/**
 * Portada del RE-04 por faena (spec §7, Fase B): una fila por faena en alcance
 * —con o sin MIPER—, la franja de cuatro cifras (A1), «Todas las faenas» /
 * «Requieren mi acción» y el filtro de estado. La búsqueda la da el TopBar
 * (D8), que alimenta a `DataTable`. Los filtros viven en la URL y se aplican
 * aquí sobre las faenas que el servicio ya acotó al alcance.
 */
export function MiperHome({ rows, creationWorksites, currentYear, permissions }: {
  rows: MiperPortfolioRow[]
  creationWorksites: CreationWorksite[]
  currentYear: number
  permissions: { canEdit: boolean; canManageCatalog: boolean }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = parsePortfolioParams(searchParams)
  const visible = filterPortfolioRows(rows, params)
  const summary = portfolioSummary(rows)
  const filtered = hasPortfolioFilters(params)
  // La búsqueda del TopBar la aplica `DataTable` sobre `visible`; aquí sólo importa para explicar una lista vacía.
  const { searchQuery, setSearchQuery } = useSafeShellHeader()
  const creatable = new Set(creationWorksites.map((worksite) => worksite.id))
  const actionsFor = (row: MiperPortfolioRow) => {
    if (!row.matrix) return permissions.canEdit && creatable.has(row.worksiteId)
      ? <CreateMatrixChoice worksites={creationWorksites} currentYear={currentYear} canManageCatalog={permissions.canManageCatalog} initialWorksiteId={row.worksiteId} /> : null
    const actions = row.myActions.length ? row.myActions : [{ matrixId: row.matrix.id, period: row.matrix.period, reason: "", kind: "continue" as const }]
    return <div className="flex flex-col items-start gap-2">{actions.map((action) => {
      const inReview = action.kind !== "continue"
      const label = action.kind === "review" ? "Revisar" : action.kind === "respond" ? "Responder" : permissions.canEdit ? "Continuar" : "Consultar"
      return <Button asChild size="sm" variant="secondary" key={action.matrixId}><Link href={inReview ? `/prevencion/miper/${action.matrixId}?tab=revision` : matrixHref(action.matrixId)} aria-label={`${label} · ${row.worksiteName} · ${periodLabel(action.period)}`}>{actions.length > 1 ? `${label} ${periodLabel(action.period)}` : label}</Link></Button>
    })}</div>
  }

  /** Filtrar es estado de la vista: `replace` y sin scroll. `portfolioHref` borra además el `tab` heredado. */
  const update = (patch: Record<string, string | null>) => router.replace(portfolioHref(searchParams, patch, pathname), { scroll: false })
  const clearAll = () => update({ vista: null, estado: null, sincontrol: null, faena: null })

  // Chips sólo para los filtros que no tienen control a la vista (A2): la faena que llega del PDTP y «sin control».
  const chips: ActiveFilterChip[] = []
  if (params.faena) chips.push({ key: "faena", label: "Faena", value: params.faena, displayValue: rows.find((row) => row.worksiteId === params.faena)?.worksiteName ?? "no disponible" })
  if (params.sinControl) chips.push({ key: "sincontrol", label: "Riesgos críticos", value: "1", displayValue: "sin control" })

  const withoutMiper = summary.total - summary.withMiper
  // A4: el vacío dice qué lo causó. Si los filtros dejan faenas y es la búsqueda la que las quita, se ofrece
  // borrarla; si los filtros ya vaciaron la lista, borrar la búsqueda no traería nada y mandan sus mensajes.
  const searchEmptied = searchQuery.trim() !== "" && visible.length > 0
  const empty = searchEmptied
    ? { title: "Ninguna faena coincide con la búsqueda", description: "Prueba con otro nombre de faena o de estado.", action: "search" as const }
    : params.vista === "mias" && params.estado === null && chips.length === 0
      ? { title: "No tienes MIPER pendientes", description: "Cuando una MIPER espere tu revisión, tu firma o tu respuesta, aparecerá aquí.", action: "filters" as const }
      : filtered
        ? { title: "Ninguna faena coincide con los filtros", description: "Quita algún filtro para ver las demás faenas.", action: "filters" as const }
        : { title: "No hay faenas a tu alcance", description: "Pide a Administración que te asigne una faena para ver o crear su MIPER.", action: null }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Matriz de riesgos"
        description="MIPER · RE-04. Identifica los peligros de cada tarea, define medidas y revisa su cumplimiento."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "MIPER" }]} />}
        actions={<div className="flex gap-2">
          {permissions.canManageCatalog && <Button asChild variant="ghost"><Link href="/prevencion/miper/factores">Administrar factores de riesgo</Link></Button>}
          {permissions.canEdit && (creationWorksites.length > 0
            ? <CreateMatrixChoice worksites={creationWorksites} currentYear={currentYear} canManageCatalog={permissions.canManageCatalog} />
            : <Button disabled title={NO_CREATION_HINT}>Crear matriz</Button>)}
        </div>}
      />
      <div className="space-y-4">
        <details className="text-sm text-[var(--color-text-muted)]">
          <summary className="w-fit cursor-pointer font-medium">Cómo se trabaja aquí</summary>
          <p className="mt-2 max-w-prose">Identificar peligros → Evaluar riesgos → Definir medidas → Revisar y dar seguimiento. Elige una faena y continúa donde quedó el trabajo; puedes empezar en la plataforma o importar un archivo Excel.</p>
        </details>
        <SummaryBar renderLink={ReplaceLink} stats={[
          {
            key: "con-miper", label: "Faenas con MIPER", value: `${summary.withMiper}/${summary.total}`,
            href: linkUnlessZero(summary.withMiper, PORTFOLIO_SUMMARY_HREF.withMiper),
            // Con 0/0 no hay «todas»: el estado vacío de la lista ya dice que no hay faenas a tu alcance.
            secondary: withoutMiper > 0 ? `${countOf(withoutMiper, "faena")} sin MIPER` : summary.total > 0 ? "Todas tienen MIPER" : undefined,
          },
          {
            key: "en-revision", label: "En revisión", value: summary.inReview, secondary: "Técnica o de Legal y RRHH",
            href: linkUnlessZero(summary.inReview, PORTFOLIO_SUMMARY_HREF.inReview),
          },
          {
            key: "mias", label: "Requieren mi acción", value: summary.mine, tone: "signal", secondary: "Tu revisión, tu firma o tu respuesta",
            href: linkUnlessZero(summary.mine, PORTFOLIO_SUMMARY_HREF.mine),
          },
          {
            key: "sin-control", label: "Riesgos críticos sin control", value: summary.critical, tone: "signal",
            href: linkUnlessZero(summary.critical, PORTFOLIO_SUMMARY_HREF.critical),
            secondary: "Intolerables vigentes sin control verificado o sin PDTP",
          },
        ]} />
        <FilterToolbar className="mb-0" activeChips={chips} onRemoveChip={(key) => update({ [key]: null })} onClearAll={clearAll} hasActiveFilters={filtered}>
          {/* A5: la cifra «Requieren mi acción» vive sólo en la franja; el segmento cambia la vista sin repetirla. */}
          <SegmentedControl ariaLabel="Qué faenas ver" variant="segmented" items={[
            { key: "todas", label: "Todas las faenas", active: params.vista === "todas", onClick: () => update({ vista: null }) },
            { key: "mias", label: "Requieren mi acción", active: params.vista === "mias", onClick: () => update({ vista: "mias" }) },
          ]} />
          <OptionSelect aria-label="Estado" emptyLabel="Todos los estados" className="w-56" value={params.estado ?? ""}
            options={PORTFOLIO_STATUS_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            onValueChange={(value) => update({ estado: value || null })} />
        </FilterToolbar>
        <DataTable
          caption="MIPER por faena"
          columns={COLUMNS}
          rows={visible}
          searchKeys={["worksiteName", "stateLabel"]}
          emptyTitle={empty.title}
          emptyDescription={empty.description}
          emptyAction={empty.action === "search"
            ? <Button type="button" variant="secondary" size="sm" onClick={() => setSearchQuery("")}>Limpiar búsqueda</Button>
            : empty.action === "filters"
              ? <Button type="button" variant="secondary" size="sm" onClick={clearAll}>Ver todas las faenas</Button>
              : undefined}
          renderRow={(row) => (
            <TableRow key={row.id} data-worksite-id={row.worksiteId}>
              <TableCell><Worksite row={row} /></TableCell>
              <TableCell><State row={row} /></TableCell>
              <TableCell><PendingWork row={row} /></TableCell>
              <TableCell>{actionsFor(row)}</TableCell>
            </TableRow>
          )}
          renderMobileCard={(row) => {
            const program = programLabel(row)
            return (
              <article aria-label={row.worksiteName} className="space-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <Worksite row={row} />
                <State row={row} />
                {actionsFor(row)}
                <Completeness row={row} />
                <p className="text-xs text-[var(--color-text-subtle)]">
                  Dotación {row.headcount} · Importantes e Intolerables {row.importantCount + row.intolerableCount}
                  {program && ` · ${row.programProgress?.planned === 0 ? program : `Programa ${program}`}`}
                </p>
                <CriticalWithoutControl row={row} />
              </article>
            )
          }}
        />
      </div>

    </PageContainer>
  )
}
