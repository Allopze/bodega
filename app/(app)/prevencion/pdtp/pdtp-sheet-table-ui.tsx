"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ListDashes, Rows } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip } from "@/components/ui/tooltip"
import type { PdtpActivityStatus } from "@/lib/services/pdtp/period"
import { pdtpExecutionStatusLabel } from "@/lib/prevention/pdtp"
import { countOf } from "@/lib/utils"

// ---------------------------------------------------------------------------
// PdtpStatusBadge
// ---------------------------------------------------------------------------

type StatusConfig = { label: string; variant: "default" | "success" | "danger" | "outline" | "warning" }
const STATUS_BADGE: Record<PdtpActivityStatus, StatusConfig> = {
  executed: { label: "Ejecutado", variant: "success" },
  pending: { label: "Pendiente", variant: "default" },
  overdue: { label: "Atrasado", variant: "danger" },
  not_scheduled: { label: "No programada en este período", variant: "outline" },
}

export function PdtpStatusBadge({
  status,
  overdueMonths = 0,
}: {
  status: PdtpActivityStatus
  overdueMonths?: number
}) {
  const { label, variant } = STATUS_BADGE[status]

  let displayLabel = label
  if (status === "overdue" && overdueMonths > 0) {
    displayLabel = `Atrasado · ${countOf(overdueMonths, "mes")}`
  }

  const showDot = status === "overdue" || status === "pending"

  return (
    <Badge variant={variant} dot={showDot} size={status === "overdue" && overdueMonths > 0 ? "lg" : "default"}>
      {displayLabel}
    </Badge>
  )
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
  return <Badge variant={EXECUTION_STATUS_VARIANT[status] ?? "default"} size="sm">{pdtpExecutionStatusLabel(status)}</Badge>
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
          <Badge variant="outline" size="sm">+{rest.length}</Badge>
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
}

export function PdtpActivitySummary({
  counts,
  activeFilter,
  onFilter,
}: {
  counts: PdtpStatusCounts
  activeFilter: PdtpActivityStatus | "all"
  onFilter: (s: PdtpActivityStatus | "all") => void
}) {
  // Misma dimensión (estado de actividad) → mismo tratamiento tipográfico:
  // antes convivían 4 estilos de chip en la misma fila de filtros
  // (UI/UX 2026-08-05, M1). "Pendientes" usa `signal`, el tono reservado
  // para "pendiente" en el sistema de tokens.
  const items: Array<{
    key: PdtpActivityStatus | "all"
    label: string
    count: number
    variant: "success" | "signal" | "danger" | "neutral"
  }> = [
    { key: "all", label: "Todas", count: counts.executed + counts.pending + counts.overdue + counts.not_scheduled, variant: "neutral" },
    { key: "executed", label: "Ejecutadas", count: counts.executed, variant: "success" },
    { key: "pending", label: "Pendientes", count: counts.pending, variant: "signal" },
    { key: "overdue", label: "Atrasadas", count: counts.overdue, variant: "danger" },
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
            className={[
              "inline-flex items-center gap-1.5 rounded-[var(--radius-full)] px-2.5 py-1 text-[11px] font-medium transition-all",
              isActive
                ? "ring-2 ring-[var(--color-primary)] ring-offset-1"
                : "opacity-70 hover:opacity-100",
            ].join(" ")}
            aria-pressed={isActive}
          >
            <Badge variant={item.variant} size="sm">
              {item.label} {item.count}
            </Badge>
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
 * hidrate con otro valor (mismatch de hidratación). Mismo patrón que
 * `PersistedDetails`.
 */
export function usePdtpDensity(): ["compact" | "comfortable", () => void] {
  const [density, setDensity] = React.useState<"compact" | "comfortable">("comfortable")

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(DENSITY_KEY)
      if (stored === "compact" || stored === "comfortable") setDensity(stored)
    } catch {}
  }, [])

  const toggle = React.useCallback(() => {
    const next = density === "compact" ? "comfortable" : "compact"
    setDensity(next)
    try { localStorage.setItem(DENSITY_KEY, next) } catch {}
  }, [density])

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

/**
 * Vista anual: por defecto muestra solo el mes actual ±1 mes alrededor.
 * El usuario puede expandir para ver los 12 meses. La preferencia se
 * persiste en localStorage.
 */
export function usePdtpMonthWindow(
  currentMonth: number,
): [number[], boolean, () => void] {
  // Preferencia leída en efecto, no en el initializer: ver nota en usePdtpDensity.
  const [expanded, setExpanded] = React.useState(false)

  React.useEffect(() => {
    try {
      if (localStorage.getItem(MONTH_WINDOW_KEY) === "1") setExpanded(true)
    } catch {}
  }, [])

  const toggle = React.useCallback(() => {
    const next = !expanded
    setExpanded(next)
    try { localStorage.setItem(MONTH_WINDOW_KEY, next ? "1" : "0") } catch {}
  }, [expanded])

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
const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

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
}) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Faena</span>
      <Select
        value={current ?? "all"}
        onValueChange={(worksiteId) => {
          if (worksiteId === "all" && allHref) {
            router.push(allHref)
            return
          }
          const params = new URLSearchParams({ hoja: sheetCode, vista: viewMode })
          if (year) params.set("anio", String(year))
          if (status && status !== "all") params.set("estado", status)
          if (month) params.set("mes", String(month))
          if (week) params.set("semana", String(week))
          if (worksiteId !== "all") params.set("faena", worksiteId)
          if (hrefBase && programId) params.set("programa", programId)
          router.push(hrefBase ? `${hrefBase}?${params}` : programId ? `${PDT_BASE}/${programId}?${params}` : `${PDT_BASE}?${params}`)
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
          ? `${hrefBase}?programa=${programId}&hoja=${sheetCode}${worksiteId ? `&faena=${worksiteId}` : ""}&vista=${option.value}${year ? `&anio=${year}` : ""}${month ? `&mes=${month}` : ""}${week ? `&semana=${week}` : ""}${status && status !== "all" ? `&estado=${status}` : ""}`
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
          router.push(hrefBase ? `${hrefBase}?${params}` : programId ? `${PDT_BASE}/${programId}?${params}` : `${PDT_BASE}?${params}`)
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
}: {
  current: string
  programs: Array<{ id: string; title: string; year: number }>
  hrefBase: string
  sheetCode: string
  worksiteId?: string
  viewMode: "semana" | "anual"
  year?: number
  status?: string
  month?: number
  week?: number
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
        router.push(`${hrefBase}?${params}`)
      }}>
        <SelectTrigger className="w-64" aria-label="Seleccionar programa"><SelectValue /></SelectTrigger>
        <SelectContent>
          {programs.map((program) => <SelectItem key={program.id} value={program.id}>{program.title} · {program.year}</SelectItem>)}
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
        router.push(`${hrefBase}?${params}`)
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
}) {
  const router = useRouter()
  const navigate = (nextMonth: number, nextWeek: number) => {
    const params = new URLSearchParams({ programa: programId, hoja: sheetCode, vista: viewMode, anio: String(year), mes: String(nextMonth), semana: String(nextWeek) })
    if (worksiteId) params.set("faena", worksiteId)
    if (status && status !== "all") params.set("estado", status)
    router.push(`${hrefBase}?${params}`)
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-eyebrow shrink-0 text-[var(--color-text-faint)]">Período</span>
      <Select value={String(month)} onValueChange={(value) => navigate(Number(value), week)}>
        <SelectTrigger className="w-28" aria-label="Seleccionar mes"><SelectValue /></SelectTrigger>
        <SelectContent>{MONTH_LABELS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}</SelectContent>
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
