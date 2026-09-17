"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ListDashes, Rows } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip } from "@/components/ui/tooltip"
import type { PdtpActivityStatus, PdtpActivityStatusFilter } from "@/lib/services/pdtp/period"
import { pdtpExecutionStatusLabel } from "@/lib/prevention/pdtp"
import { countOf } from "@/lib/utils"
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state"
import { MONTH_LABELS } from "@/lib/utils"

// ---------------------------------------------------------------------------
// PdtpStatusBadge
// ---------------------------------------------------------------------------

type StatusConfig = { label: string; variant: "default" | "success" | "danger" | "outline" | "warning" }
const STATUS_BADGE: Record<PdtpActivityStatus, StatusConfig> = {
  executed: { label: "Ejecutado", variant: "success" },
  pending: { label: "Pendiente", variant: "default" },
  overdue: { label: "Atrasado", variant: "danger" },
  not_scheduled: { label: "No programada en este período", variant: "outline" },
  // Ámbar, no rojo: hay un motivo declarado. Sigue sin ejecutarse y sigue
  // contando en cero para el indicador, pero no es lo mismo que una deuda
  // sin explicación.
  not_performed: { label: "No realizada (con motivo)", variant: "warning" },
}

export function PdtpStatusBadge({
  status,
  overdueMonths = 0,
  /** Motivos declarados del mes; se muestran en el tooltip del badge "No realizada". */
  notPerformedReasons,
}: {
  status: PdtpActivityStatus
  overdueMonths?: number
  notPerformedReasons?: string[]
}) {
  const { label, variant } = STATUS_BADGE[status]

  let displayLabel = label
  if (status === "overdue" && overdueMonths > 0) {
    displayLabel = `Atrasado · ${countOf(overdueMonths, "mes")}`
  }

  const showDot = status === "overdue" || status === "pending"

  const badge = (
    <MetaBadge meta={{ label: displayLabel, variant }} dot={showDot} size={status === "overdue" && overdueMonths > 0 ? "lg" : "default"}>
      {displayLabel}
    </MetaBadge>
  )

  // El badge dice que hay un motivo; el tooltip dice cuál. Sin esto, "con
  // motivo" obliga a abrir otra vista para saber de qué motivo se habla.
  if (status === "not_performed" && notPerformedReasons && notPerformedReasons.length > 0) {
    return (
      <Tooltip side="top" content={notPerformedReasons.join(" · ")}>
        <span className="inline-flex">{badge}</span>
      </Tooltip>
    )
  }

  return badge
}

// ---------------------------------------------------------------------------
// PdtpExecutionStatusBadge — estado de una ejecución registrada
// ---------------------------------------------------------------------------

const EXECUTION_STATUS_VARIANT: Record<string, "default" | "success" | "danger" | "warning"> = {
  draft:     "default",
  submitted: "warning",
  approved:  "success",
  rejected:  "danger",
}

export function PdtpExecutionStatusBadge({ status }: { status: string }) {
  return <MetaBadge meta={{ label: pdtpExecutionStatusLabel(status), variant: EXECUTION_STATUS_VARIANT[status] ?? "default" }} />
}

// ---------------------------------------------------------------------------
// PdtpResponsibleChips
// ---------------------------------------------------------------------------

export function PdtpResponsibleChips({ display }: { display: string }) {
  const parts = display.split(",").map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return <span className="text-[var(--color-text-faint)]">—</span>

  const [first, ...rest] = parts

  if (rest.length === 0) {
    return (
      <span className="block max-w-[14rem] truncate text-sm text-[var(--color-text-muted)]" title={first}>
        {first}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="max-w-[11rem] truncate text-sm text-[var(--color-text-muted)]" title={first}>
        {first}
      </span>
      <Tooltip side="top" content={rest.join(", ")}>
        <span className="cursor-default">
          <MetaBadge meta={{ label: `+${rest.length}`, variant: "outline" }} />
        </span>
      </Tooltip>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PdtpProgressRing
// ---------------------------------------------------------------------------

export function PdtpProgressRing({
  percent,
  size = 56,
  strokeWidth = 5,
}: {
  percent: number | null
  size?: number
  strokeWidth?: number
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const pct = percent === null ? 0 : Math.min(100, Math.max(0, percent))
  const offset = circumference - (pct / 100) * circumference

  const color =
    percent === null ? "var(--color-border)"
    : pct >= 80 ? "var(--color-success)"
    : pct >= 50 ? "var(--color-warning-ink)"
    : "var(--color-danger)"

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden
    >
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-surface-2)"
        strokeWidth={strokeWidth}
      />
      {/* Progress */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.3s ease" }}
      />
      {/* Center text */}
      <text
        x={size / 2}
        y={size / 2}
        dominantBaseline="middle"
        textAnchor="middle"
        fontSize={size < 50 ? "10" : "11"}
        fontFamily="var(--font-mono, monospace)"
        fontWeight="600"
        fill={color}
      >
        {percent === null ? "—" : `${Math.round(pct)}%`}
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// PdtpMetric
// ---------------------------------------------------------------------------

type MetricVariant = "neutral" | "success" | "warning" | "danger"

const METRIC_ACCENT: Record<MetricVariant, string> = {
  neutral: "border-l-[var(--color-border)]",
  success: "border-l-[var(--color-success)]",
  warning: "border-l-[var(--color-warning-ink)]",
  danger: "border-l-[var(--color-danger)]",
}

const METRIC_VALUE_COLOR: Record<MetricVariant, string> = {
  neutral: "text-[var(--color-text)]",
  success: "text-[var(--color-success)]",
  warning: "text-[var(--color-warning-ink)]",
  danger: "text-[var(--color-danger)]",
}

export function PdtpMetric({
  label,
  value,
  subtitle,
  icon,
  variant = "neutral",
  ring,
}: {
  label: string
  value: number | string
  subtitle?: string
  icon?: React.ReactNode
  variant?: MetricVariant
  ring?: React.ReactNode
}) {
  const isEmpty = value === "-" || value === "0%" || value === 0

  return (
    <div
      className={[
        "rounded-lg border border-l-4 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3",
        METRIC_ACCENT[variant],
        "transition-colors",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {icon && (
              <span className="shrink-0 text-[var(--color-text-faint)]">{icon}</span>
            )}
            <p className="text-xs text-[var(--color-text-subtle)]">{label}</p>
          </div>
          <p
            className={[
              "mt-1 text-lg font-semibold tabular-nums",
              isEmpty ? "text-[var(--color-text-faint)]" : METRIC_VALUE_COLOR[variant],
            ].join(" ")}
          >
            {isEmpty && typeof value === "string" ? (
              <span className="text-sm font-normal italic text-[var(--color-text-faint)]">Sin registros</span>
            ) : (
              value
            )}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-[10px] text-[var(--color-text-faint)]">{subtitle}</p>
          )}
        </div>
        {ring && <div className="shrink-0">{ring}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PdtpActivitySummary — mini dashboard por estado
// ---------------------------------------------------------------------------

export type PdtpStatusCounts = {
  executed: number
  pending: number
  overdue: number
  not_scheduled: number
  /** Actividades con un desvío "no realizada" declarado este mes. Es una
   * quinta categoría exclusiva (sale de `deriveActivityStatus`), a diferencia
   * de `zero`. */
  not_performed: number
  /** `pending ∪ overdue`, excluidas `coverage`/`closed_on_time` — el mismo
   * criterio que `zeroActivityIds` en `compliance.ts`. Se superpone a
   * `pending`/`overdue` a propósito (no es una quinta categoría exclusiva):
   * es el filtro que corresponde a "actividades en cero" del indicador. No
   * se suma a `all` para no contar dos veces las mismas filas. */
  zero: number
}

export function PdtpActivitySummary({
  counts,
  activeFilter,
  onFilter,
}: {
  counts: PdtpStatusCounts
  activeFilter: PdtpActivityStatusFilter | "all"
  onFilter: (s: PdtpActivityStatusFilter | "all") => void
}) {
  // Misma dimensión (estado de actividad) → mismo tratamiento tipográfico:
  // antes convivían 4 estilos de chip en la misma fila de filtros
  // (UI/UX 2026-08-05, M1). "Pendientes" usa `signal`, el tono reservado
  // para "pendiente" en el sistema de tokens.
  const items: Array<{
    key: PdtpActivityStatusFilter | "all"
    label: string
    count: number
    variant: "success" | "signal" | "danger" | "neutral"
    title?: string
  }> = [
    { key: "all", label: "Todas", count: counts.executed + counts.pending + counts.overdue + counts.not_scheduled + counts.not_performed, variant: "neutral" },
    { key: "executed", label: "Ejecutadas", count: counts.executed, variant: "success" },
    { key: "pending", label: "Pendientes", count: counts.pending, variant: "signal" },
    { key: "overdue", label: "Atrasadas", count: counts.overdue, variant: "danger" },
    {
      key: "not_performed",
      label: "No realizadas",
      count: counts.not_performed,
      variant: "signal",
      title: "Planificadas este mes, sin ejecutar y con un motivo declarado. Siguen contando en el indicador: el motivo se registra, lo planificado no cambia.",
    },
    {
      key: "en_cero",
      label: "En cero",
      count: counts.zero,
      variant: "danger",
      title: "Planificadas este mes sin ninguna ejecución aprobada (pendientes + atrasadas). Es lo mismo que cuenta el indicador de cumplimiento mensual.",
    },
    { key: "not_scheduled", label: "Sin programar", count: counts.not_scheduled, variant: "neutral" },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por estado">
      {items.map((item) => {
        const isActive = activeFilter === item.key
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onFilter(item.key)}
            title={item.title}
            className={[
              "inline-flex items-center gap-1.5 rounded-[var(--radius-full)] px-2.5 py-1 text-[11px] font-medium transition-all",
              isActive
                ? "ring-2 ring-[var(--color-primary)] ring-offset-1"
                : "opacity-70 hover:opacity-100",
            ].join(" ")}
            aria-pressed={isActive}
          >
            <MetaBadge meta={item} size="sm">
              {item.label} {item.count}
            </MetaBadge>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PdtpDensityToggle
// ---------------------------------------------------------------------------

const DENSITY_KEY = "pdtp-table-density"

/**
 * La preferencia se lee en un efecto, no en el initializer de `useState`: leerla
 * durante el primer render hace que el servidor emita el default y el cliente
 * hidrate con otro valor (mismatch de hidratación). El patrón vive en
 * `useLocalStorageState`.
 */
const densityParse = (stored: string) => (stored === "compact" || stored === "comfortable" ? stored : null)

export function usePdtpDensity(): ["compact" | "comfortable", () => void] {
  const [density, setDensity] = useLocalStorageState<"compact" | "comfortable">(DENSITY_KEY, "comfortable", densityParse)

  const toggle = React.useCallback(() => {
    setDensity(density === "compact" ? "comfortable" : "compact")
  }, [density, setDensity])

  return [density, toggle]
}

export function PdtpDensityToggle({
  density,
  onToggle,
}: {
  density: "compact" | "comfortable"
  onToggle: () => void
}) {
  return (
    <Tooltip side="top" content={density === "compact" ? "Vista cómoda" : "Vista compacta"}>
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        aria-label={density === "compact" ? "Cambiar a vista cómoda" : "Cambiar a vista compacta"}
      >
        {density === "compact" ? (
          <Rows size={14} aria-hidden />
        ) : (
          <ListDashes size={14} aria-hidden />
        )}
      </button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// PdtpMonthWindow — colapsar meses en vista anual
// ---------------------------------------------------------------------------

const MONTH_WINDOW_KEY = "pdtp-month-window"
const monthWindowParse = (stored: string) => (stored === "1" ? true : stored === "0" ? false : null)
const monthWindowSerialize = (next: boolean) => (next ? "1" : "0")

/**
 * Vista anual: por defecto muestra solo el mes actual ±1 mes alrededor.
 * El usuario puede expandir para ver los 12 meses. La preferencia se
 * persiste en localStorage.
 */
export function usePdtpMonthWindow(
  currentMonth: number,
): [number[], boolean, () => void] {
  const [expanded, setExpanded] = useLocalStorageState(MONTH_WINDOW_KEY, false, monthWindowParse, monthWindowSerialize)

  const toggle = React.useCallback(() => {
    setExpanded(!expanded)
  }, [expanded, setExpanded])

  const visibleMonths = React.useMemo(() => {
    if (expanded) return MONTH_INDICES
    const start = Math.max(0, currentMonth - 2) // mes actual ±1
    const end = Math.min(11, currentMonth)
    return MONTH_INDICES.slice(start, end + 1)
  }, [expanded, currentMonth])

  return [visibleMonths, expanded, toggle]
}

const MONTH_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
export { MONTH_INDICES as PDT_SHEET_MONTH_INDICES }

// ---------------------------------------------------------------------------
// Navigation pickers
// ---------------------------------------------------------------------------

const PDT_BASE = "/prevencion/pdtp"

/** Mes del período PDTP (1–12); etiqueta en `MONTH_LABELS[mes - 1]`. */
const PDTP_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export function PdtpWorksitePicker({
  current,
  sheetCode,
  worksites,
  programId,
  viewMode = "semana",
  hrefBase,
  year,
  status,
  month,
  week,
  allHref,
  objetivo,
}: {
  current?: string
  sheetCode: string
  worksites: Array<{ id: string; name: string }>
  programId?: string
  viewMode?: "semana" | "anual"
  /** Ruta del visor transversal. Sin ella se conserva la ruta de detalle. */
  hrefBase?: string
  year?: number
  status?: string
  month?: number
  week?: number
  allHref?: string
  /** Id de objetivo seleccionado (`?objetivo=`); se conserva al cambiar de faena. */
  objetivo?: string
}) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Faena</span>
      <Select
        value={current ?? "all"}
        onValueChange={(worksiteId) => {
          if (worksiteId === "all" && allHref) {
            router.replace(allHref, { scroll: false })
            return
          }
          const params = new URLSearchParams({ hoja: sheetCode, vista: viewMode })
          if (year) params.set("anio", String(year))
          if (status && status !== "all") params.set("estado", status)
          if (month) params.set("mes", String(month))
          if (week) params.set("semana", String(week))
          if (worksiteId !== "all") params.set("faena", worksiteId)
          if (hrefBase && programId) params.set("programa", programId)
          if (objetivo) params.set("objetivo", objetivo)
          router.replace(hrefBase ? `${hrefBase}?${params}` : programId ? `${PDT_BASE}/${programId}?${params}` : `${PDT_BASE}?${params}`, { scroll: false })
        }}
      >
        <SelectTrigger className="w-56" aria-label="Seleccionar faena"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las faenas autorizadas</SelectItem>
          {worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

const PDTP_VIEW_TOGGLE_OPTIONS: Array<{ value: "semana" | "anual"; label: string }> = [
  { value: "semana", label: "Esta semana" },
  { value: "anual", label: "Vista anual" },
]

export function PdtpViewToggle({
  current,
  sheetCode,
  worksiteId,
  programId,
  hrefBase,
  year,
  status,
  month,
  week,
  objetivo,
}: {
  current: "semana" | "anual"
  sheetCode: string
  worksiteId?: string
  programId?: string
  hrefBase?: string
  year?: number
  status?: string
  month?: number
  week?: number
  /** Id de objetivo seleccionado (`?objetivo=`); se conserva al cambiar de vista. */
  objetivo?: string
}) {
  return (
    <SegmentedControl
      eyebrow="Vista"
      ariaLabel="Cambiar vista"
      variant="segmented"
      items={PDTP_VIEW_TOGGLE_OPTIONS.map((option) => ({
        key: option.value,
        label: option.label,
        href: hrefBase && programId
          ? `${hrefBase}?programa=${programId}&hoja=${sheetCode}${worksiteId ? `&faena=${worksiteId}` : ""}&vista=${option.value}${year ? `&anio=${year}` : ""}${month ? `&mes=${month}` : ""}${week ? `&semana=${week}` : ""}${status && status !== "all" ? `&estado=${status}` : ""}${objetivo ? `&objetivo=${objetivo}` : ""}`
          : programId
          ? `${PDT_BASE}/${programId}?hoja=${sheetCode}${worksiteId ? `&faena=${worksiteId}` : ""}&vista=${option.value}`
          : `${PDT_BASE}?hoja=${sheetCode}${worksiteId ? `&faena=${worksiteId}` : ""}&vista=${option.value}`,
        active: option.value === current,
      }))}
    />
  )
}

export function PdtpSheetPicker({
  current,
  options,
  programId,
  worksiteId,
  viewMode = "semana",
  hrefBase,
  year,
  status,
  month,
  week,
  objetivo,
}: {
  current: string
  options: Array<{ code: string; label: string }>
  programId?: string
  worksiteId?: string
  viewMode?: "semana" | "anual"
  hrefBase?: string
  year?: number
  status?: string
  month?: number
  week?: number
  /** Id de objetivo seleccionado (`?objetivo=`); se conserva al cambiar de hoja. */
  objetivo?: string
}) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Hoja</span>
      <Select
        value={current}
        onValueChange={(sheetCode) => {
          const params = new URLSearchParams({ hoja: sheetCode, vista: viewMode })
          if (year) params.set("anio", String(year))
          if (status && status !== "all") params.set("estado", status)
          if (month) params.set("mes", String(month))
          if (week) params.set("semana", String(week))
          if (worksiteId) params.set("faena", worksiteId)
          if (hrefBase && programId) params.set("programa", programId)
          if (objetivo) params.set("objetivo", objetivo)
          router.replace(hrefBase ? `${hrefBase}?${params}` : programId ? `${PDT_BASE}/${programId}?${params}` : `${PDT_BASE}?${params}`, { scroll: false })
        }}
      >
        <SelectTrigger className="w-64" aria-label="Seleccionar hoja"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.code} value={option.code}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * Filtro por objetivo del programa (`?objetivo=`). Solo tiene sentido
 * renderizarlo cuando el programa tiene al menos un objetivo declarado; el
 * llamador decide eso, no este componente.
 */
export function PdtpObjectivePicker({
  current,
  objectives,
  programId,
  sheetCode,
  worksiteId,
  viewMode = "semana",
  hrefBase,
  year,
  status,
  month,
  week,
}: {
  current?: string
  objectives: Array<{ id: string; code: string; name: string }>
  programId: string
  sheetCode: string
  worksiteId?: string
  viewMode?: "semana" | "anual"
  hrefBase: string
  year?: number
  status?: string
  month?: number
  week?: number
}) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Objetivo</span>
      <Select
        value={current ?? "all"}
        onValueChange={(objectiveId) => {
          const params = new URLSearchParams({ programa: programId, hoja: sheetCode, vista: viewMode })
          if (year) params.set("anio", String(year))
          if (status && status !== "all") params.set("estado", status)
          if (month) params.set("mes", String(month))
          if (week) params.set("semana", String(week))
          if (worksiteId) params.set("faena", worksiteId)
          if (objectiveId !== "all") params.set("objetivo", objectiveId)
          router.replace(`${hrefBase}?${params}`, { scroll: false })
        }}
      >
        <SelectTrigger className="w-64" aria-label="Seleccionar objetivo"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los objetivos</SelectItem>
          {objectives.map((objective) => <SelectItem key={objective.id} value={objective.id}>{objective.code} · {objective.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export function PdtpProgramPicker({
  current,
  programs,
  hrefBase,
  sheetCode,
  worksiteId,
  viewMode,
  year,
  status,
  month,
  week,
  objetivo,
}: {
  current: string
  programs: Array<{ id: string; title: string; year: number; version: number }>
  hrefBase: string
  sheetCode: string
  worksiteId?: string
  viewMode: "semana" | "anual"
  year?: number
  status?: string
  month?: number
  week?: number
  /** Id de objetivo seleccionado (`?objetivo=`); se conserva al cambiar de programa. */
  objetivo?: string
}) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Programa</span>
      <Select value={current} onValueChange={(programId) => {
        const params = new URLSearchParams({ programa: programId, hoja: sheetCode, vista: viewMode })
        if (year) params.set("anio", String(year))
        if (status && status !== "all") params.set("estado", status)
        if (month) params.set("mes", String(month))
        if (week) params.set("semana", String(week))
        if (worksiteId) params.set("faena", worksiteId)
        if (objetivo) params.set("objetivo", objetivo)
        router.replace(`${hrefBase}?${params}`, { scroll: false })
      }}>
        <SelectTrigger className="w-64" aria-label="Seleccionar programa"><SelectValue /></SelectTrigger>
        <SelectContent>
          {programs.map((program) => <SelectItem key={program.id} value={program.id}>{program.title} · {program.year} · v{program.version}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export function PdtpYearPicker({
  current,
  years,
  hrefBase,
  programId,
  sheetCode,
  worksiteId,
  viewMode,
  status,
  month,
  week,
  objetivo,
}: {
  current: number
  years: number[]
  hrefBase: string
  programId?: string
  sheetCode?: string
  worksiteId?: string
  viewMode?: "semana" | "anual"
  status?: string
  month?: number
  week?: number
  /** Id de objetivo seleccionado (`?objetivo=`); se conserva al cambiar de año. */
  objetivo?: string
}) {
  const router = useRouter()
  const options = [...new Set([...years, current])].sort((a, b) => b - a)
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Año</span>
      <Select value={String(current)} onValueChange={(value) => {
        const params = new URLSearchParams({ anio: value })
        if (programId) params.set("programa", programId)
        if (sheetCode) params.set("hoja", sheetCode)
        if (worksiteId) params.set("faena", worksiteId)
        if (viewMode) params.set("vista", viewMode)
        if (status && status !== "all") params.set("estado", status)
        if (month) params.set("mes", String(month))
        if (week) params.set("semana", String(week))
        if (objetivo) params.set("objetivo", objetivo)
        router.replace(`${hrefBase}?${params}`, { scroll: false })
      }}>
        <SelectTrigger className="w-28" aria-label="Seleccionar año"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={String(option)}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export function PdtpPeriodPicker({
  month,
  week,
  hrefBase,
  programId,
  sheetCode,
  worksiteId,
  viewMode,
  year,
  status,
  objetivo,
}: {
  month: number
  week: number
  hrefBase: string
  programId: string
  sheetCode: string
  worksiteId?: string
  viewMode: "semana" | "anual"
  year: number
  status?: string
  /** Id de objetivo seleccionado (`?objetivo=`); se conserva al cambiar de período. */
  objetivo?: string
}) {
  const router = useRouter()
  const navigate = (nextMonth: number, nextWeek: number) => {
    const params = new URLSearchParams({ programa: programId, hoja: sheetCode, vista: viewMode, anio: String(year), mes: String(nextMonth), semana: String(nextWeek) })
    if (worksiteId) params.set("faena", worksiteId)
    if (status && status !== "all") params.set("estado", status)
    if (objetivo) params.set("objetivo", objetivo)
    router.replace(`${hrefBase}?${params}`, { scroll: false })
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Período</span>
      <Select value={String(month)} onValueChange={(value) => navigate(Number(value), week)}>
        <SelectTrigger className="w-28" aria-label="Seleccionar mes"><SelectValue /></SelectTrigger>
        <SelectContent>{PDTP_MONTHS.map((month) => <SelectItem key={MONTH_LABELS[month - 1]} value={String(month)}>{MONTH_LABELS[month - 1]}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={String(week)} onValueChange={(value) => navigate(month, Number(value))}>
        <SelectTrigger className="w-24" aria-label="Seleccionar semana"><SelectValue /></SelectTrigger>
        <SelectContent>{[1, 2, 3, 4, 5].map((value) => <SelectItem key={value} value={String(value)}>Sem {value}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// formatQuantity
// ---------------------------------------------------------------------------

export function formatQuantity(value: number) {
  if (value === 0) return "-"
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
