"use client"

import * as React from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Tooltip } from "@/components/ui/tooltip"
import type { PdtpActivityStatus } from "@/lib/services/pdtp/period"

// ---------------------------------------------------------------------------
// PdtpStatusBadge
// ---------------------------------------------------------------------------

export function PdtpStatusBadge({
  status,
  overdueMonths = 0,
}: {
  status: PdtpActivityStatus
  overdueMonths?: number
}) {
  type StatusConfig = { label: string; variant: "default" | "success" | "danger" | "outline" | "warning" }
  const STATUS_BADGE: Record<PdtpActivityStatus, StatusConfig> = {
    executed: { label: "Ejecutado", variant: "success" },
    pending: { label: "Pendiente", variant: "default" },
    overdue: { label: "Atrasado", variant: "danger" },
    not_scheduled: { label: "—", variant: "outline" },
  }
  const { label, variant } = STATUS_BADGE[status]

  let displayLabel = label
  if (status === "overdue" && overdueMonths > 0) {
    displayLabel = `Atrasado · ${overdueMonths} ${overdueMonths === 1 ? "mes" : "meses"}`
  }

  const showDot = status === "overdue" || status === "pending"

  return (
    <Badge variant={variant} dot={showDot} size={status === "overdue" && overdueMonths > 0 ? "lg" : "default"}>
      {displayLabel}
    </Badge>
  )
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
  const items: Array<{
    key: PdtpActivityStatus | "all"
    label: string
    count: number
    variant: "success" | "default" | "danger" | "outline"
    dot: boolean
  }> = [
    { key: "all", label: "Todas", count: counts.executed + counts.pending + counts.overdue + counts.not_scheduled, variant: "outline", dot: false },
    { key: "executed", label: "Ejecutadas", count: counts.executed, variant: "success", dot: false },
    { key: "pending", label: "Pendientes", count: counts.pending, variant: "default", dot: true },
    { key: "overdue", label: "Atrasadas", count: counts.overdue, variant: "danger", dot: true },
    { key: "not_scheduled", label: "Sin programar", count: counts.not_scheduled, variant: "outline", dot: false },
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
            <Badge variant={item.variant} dot={item.dot} size="sm">
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

export function usePdtpDensity(): ["compact" | "comfortable", () => void] {
  const [density, setDensity] = React.useState<"compact" | "comfortable">(() => {
    if (typeof window === "undefined") return "comfortable"
    return (localStorage.getItem(DENSITY_KEY) as "compact" | "comfortable") ?? "comfortable"
  })

  const toggle = React.useCallback(() => {
    setDensity((prev) => {
      const next = prev === "compact" ? "comfortable" : "compact"
      localStorage.setItem(DENSITY_KEY, next)
      return next
    })
  }, [])

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
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        aria-label={density === "compact" ? "Cambiar a vista cómoda" : "Cambiar a vista compacta"}
      >
        {density === "compact" ? (
          // Rows spacious icon
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <rect x="1" y="2" width="12" height="2.5" rx="0.5" fill="currentColor" />
            <rect x="1" y="5.75" width="12" height="2.5" rx="0.5" fill="currentColor" />
            <rect x="1" y="9.5" width="12" height="2.5" rx="0.5" fill="currentColor" />
          </svg>
        ) : (
          // Rows compact icon
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <rect x="1" y="1.5" width="12" height="1.5" rx="0.5" fill="currentColor" />
            <rect x="1" y="4.25" width="12" height="1.5" rx="0.5" fill="currentColor" />
            <rect x="1" y="7" width="12" height="1.5" rx="0.5" fill="currentColor" />
            <rect x="1" y="9.75" width="12" height="1.5" rx="0.5" fill="currentColor" />
            <rect x="1" y="12.5" width="12" height="0" rx="0.5" fill="currentColor" />
          </svg>
        )}
      </button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Navigation pickers
// ---------------------------------------------------------------------------

const PDT_BASE = "/prevencion/pdtp"

export function PdtpWorksitePicker({
  current,
  sheetCode,
  worksites,
  programId,
}: {
  current?: string
  sheetCode: string
  worksites: Array<{ id: string; name: string }>
  programId?: string
}) {
  return (
    <SegmentedControl
      eyebrow="Faena"
      ariaLabel="Seleccionar faena"
      variant="pills"
      items={worksites.map((worksite) => ({
        key: worksite.id,
        label: worksite.name,
        href: programId
          ? `${PDT_BASE}/${programId}?hoja=${sheetCode}&faena=${worksite.id}`
          : `${PDT_BASE}?hoja=${sheetCode}&faena=${worksite.id}`,
        active: worksite.id === current,
      }))}
    />
  )
}

export function PdtpViewToggle({
  current,
  sheetCode,
  worksiteId,
  programId,
}: {
  current: "semana" | "anual"
  sheetCode: string
  worksiteId?: string
  programId?: string
}) {
  const options: Array<{ value: "semana" | "anual"; label: string }> = [
    { value: "semana", label: "Esta semana" },
    { value: "anual", label: "Vista anual" },
  ]
  return (
    <SegmentedControl
      eyebrow="Vista"
      ariaLabel="Cambiar vista"
      variant="segmented"
      items={options.map((option) => ({
        key: option.value,
        label: option.label,
        href: programId
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
}: {
  current: string
  options: Array<{ code: string; label: string }>
  programId?: string
}) {
  return (
    <SegmentedControl
      eyebrow="Hoja"
      ariaLabel="Seleccionar hoja"
      variant="pills"
      items={options.map((option) => ({
        key: option.code,
        label: option.label,
        href: programId
          ? `${PDT_BASE}/${programId}?hoja=${option.code}`
          : `${PDT_BASE}?hoja=${option.code}`,
        active: option.code === current,
      }))}
    />
  )
}

// ---------------------------------------------------------------------------
// formatQuantity
// ---------------------------------------------------------------------------

export function formatQuantity(value: number) {
  if (value === 0) return "-"
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
