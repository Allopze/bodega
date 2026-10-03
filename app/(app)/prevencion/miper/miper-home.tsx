"use client"

import Link from "next/link"
import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge, metaFor, type StateMetaInput } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
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
  { key: "headcount", label: "Dotación", numeric: true, sortable: true },
  { key: "completeness", label: "Completitud" },
  { key: "graves", label: "Importantes e Intolerables", numeric: true },
  { key: "programProgress", label: "Programa" },
  { key: "updatedAt", label: "Actualizada", sortable: true },
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

const matrixHref = (matrixId: string) => `/prevencion/miper/${matrixId}`
const periodLabel = (period: number | null) => (period === null ? "sin período" : String(period))
const actionLabel = (action: MiperPortfolioAction) => `${action.reason} · MIPER ${periodLabel(action.period)}`

function vigenteLabel(matrix: MiperPortfolioMatrix) {
  if (matrix.isLegacy) return `Vigente · metodología anterior (${periodLabel(matrix.period)})`
  return `Vigente ${matrix.versionNumber ? `v${matrix.versionNumber} ` : ""}(${periodLabel(matrix.period)})`
}

/**
 * Avance del programa de la vigente (o de la MIPER de la fila). `null` es una
 * faena sin MIPER; sin nada planificado —sin programa o sin ocurrencias— se
 * dice «Sin programa», nunca un 0 % que se leería como atraso.
 */
function programLabel(row: MiperPortfolioRow): string | null {
  const progress = row.programProgress
  if (!progress) return null
  if (progress.planned === 0) return NO_PROGRAM
  return `${Math.round((progress.ratio ?? 0) * 100)}% · ${progress.done}/${progress.planned}`
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
      {row.myActions.map((action) => (
        <p key={action.matrixId} className="text-xs font-semibold">
          <Link href={matrixHref(action.matrixId)} className="text-[var(--color-signal-ink)] hover:underline">{actionLabel(action)}</Link>
        </p>
      ))}
    </div>
  )
}

function State({ row, onCreate }: { row: MiperPortfolioRow; onCreate: (() => void) | null }) {
  const meta = metaFor(STATUS_META, row.status)
  const detail = [row.matrix && row.stateLabel !== meta.label ? row.stateLabel : null, row.submittedByName ? `enviada por ${row.submittedByName}` : null].filter(Boolean).join(" · ")
  return (
    <div className="flex flex-col items-start gap-1">
      <MetaBadge meta={meta} />
      {detail && <p className="text-xs text-[var(--color-text-subtle)]">{detail}</p>}
      {/* El nombre empieza con el texto visible y nombra la faena (WCAG 2.5.3): cada fila tiene el suyo. */}
      {onCreate && <Button size="sm" variant="secondary" onClick={onCreate} aria-label={`Crear MIPER de ${row.worksiteName}`}>Crear MIPER</Button>}
    </div>
  )
}

function Headcount({ row }: { row: MiperPortfolioRow }) {
  return (
    <span className="block">
      <span className="tabular-nums">{row.headcount}</span>
      <span className="block text-xs text-[var(--color-text-subtle)]">{row.headcountSource === "ficha" ? "según la ficha" : "trabajadores activos"}</span>
    </span>
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

function Graves({ row }: { row: MiperPortfolioRow }) {
  return (
    <span className="block">
      <span className="tabular-nums">{row.importantCount + row.intolerableCount}</span>
      <CriticalWithoutControl row={row} />
    </span>
  )
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
  // El alta vive aquí: la abren la cabecera («Nueva MIPER») y la fila de una faena sin MIPER («Crear MIPER»).
  const [creating, setCreating] = useState<{ worksiteId: string | null } | null>(null)
  const creatable = new Set(creationWorksites.map((worksite) => worksite.id))
  const createFor = (row: MiperPortfolioRow) =>
    permissions.canEdit && !row.matrix && creatable.has(row.worksiteId) ? () => setCreating({ worksiteId: row.worksiteId }) : null

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
        title="Matriz IPER (MIPER)"
        description="Identificación de peligros y evaluación de riesgos por faena y período, con revisión técnica y aprobación Legal y RRHH."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "MIPER" }]} />}
        actions={<div className="flex gap-2">
          {permissions.canManageCatalog && <Button asChild variant="secondary"><Link href="/prevencion/miper/factores">Factores de riesgo</Link></Button>}
          {permissions.canEdit && <ImportMiperDialog worksites={creationWorksites} currentYear={currentYear} canManageCatalog={permissions.canManageCatalog} />}
          {permissions.canEdit && (
            <Button onClick={() => setCreating({ worksiteId: null })} disabled={creationWorksites.length === 0}
              title={creationWorksites.length === 0 ? NO_CREATION_HINT : undefined}>
              Nueva MIPER
            </Button>
          )}
        </div>}
      />
      <div className="space-y-4">
        <SummaryBar renderLink={ReplaceLink} stats={[
          {
            key: "con-miper", label: "Faenas con MIPER", value: `${summary.withMiper}/${summary.total}`,
            href: linkUnlessZero(summary.withMiper, PORTFOLIO_SUMMARY_HREF.withMiper),
            secondary: withoutMiper > 0 ? `${countOf(withoutMiper, "faena")} sin MIPER` : "Todas tienen MIPER",
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
              <TableCell><State row={row} onCreate={createFor(row)} /></TableCell>
              <TableCell className="text-right"><Headcount row={row} /></TableCell>
              <TableCell><Completeness row={row} /></TableCell>
              <TableCell className="text-right"><Graves row={row} /></TableCell>
              <TableCell className="text-sm">{programLabel(row) ?? <span className="text-xs text-[var(--color-text-subtle)]">—</span>}</TableCell>
              <TableCell>{row.updatedAt ? formatDate(row.updatedAt) : "—"}</TableCell>
            </TableRow>
          )}
          renderMobileCard={(row) => {
            const program = programLabel(row)
            return (
              <article aria-label={row.worksiteName} className="space-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <Worksite row={row} />
                <State row={row} onCreate={createFor(row)} />
                <Completeness row={row} />
                <p className="text-xs text-[var(--color-text-subtle)]">
                  Dotación {row.headcount} · Importantes e Intolerables {row.importantCount + row.intolerableCount}
                  {program && ` · ${program === NO_PROGRAM ? program : `Programa ${program}`}`}
                </p>
                <CriticalWithoutControl row={row} />
              </article>
            )
          }}
        />
      </div>
      <NewMiperDialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null) }}
        worksites={creationWorksites} currentYear={currentYear} initialWorksiteId={creating?.worksiteId ?? null} />
    </PageContainer>
  )
}
