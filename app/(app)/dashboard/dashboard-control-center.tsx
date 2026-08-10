import * as React from "react"
import Link from "next/link"
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { DashboardGrid } from "@/components/ui/dashboard-grid"
import { EmptyState } from "@/components/ui/empty-state"
import { periodFlowTitle, type DashboardScope } from "./dashboard-scope"
import { OperationalMetricsStrip } from "./operational-metrics-strip"
import { MiniSparkline } from "@/components/ui/mini-sparkline"
import { CHART_COLORS } from "@/lib/chart-palette"

export interface DashboardMetric {
  key: string
  label: string
  value: string | number
  description: string
  icon: "tasks" | "critical" | "approvals" | "receipts" | "deliveries" | "stock" | "investment" | "rate"
  tone?: "neutral" | "signal" | "danger"
  href?: string
  sparkline?: number[]
}

export interface DashboardAlert {
  key: string
  title: string
  description: string
  count: number
  severity: "critical" | "warning" | "info"
  href?: string
}

export interface OperationalPeriodSummaryEntry {
  key: string
  label: string
  value: string | number
  comparison: string
  href: string
  /** Serie diaria real; sólo la traen las entradas con instantáneas. */
  sparkline?: number[]
}

interface DashboardResumenBodyProps {
  /** Alcance global vigente: todas las cifras ya vienen consultadas con él. */
  scope: DashboardScope
  metrics: DashboardMetric[]
  alerts: DashboardAlert[]
  periodSummary: OperationalPeriodSummaryEntry[]
  backlogSummary: OperationalPeriodSummaryEntry[]
  /** Contenido extra de la columna principal (gráficos, actividad). */
  mainSlot?: React.ReactNode
  /** Contenido extra del lateral, entre alertas y métricas del período. */
  asideSlot?: React.ReactNode
}

const SEVERITY_META = {
  critical: { label: "Crítica", variant: "danger" as const },
  warning:  { label: "Atención", variant: "warning" as const },
  info:     { label: "Pendiente", variant: "info" as const },
}

/**
 * Cuerpo de la vista Resumen: KPIs de ranura, alertas y lecturas de apoyo.
 *
 * Era `DashboardControlCenter` y montaba también el saludo (que pasó por un
 * `dashboard-header.tsx` intermedio y hoy es el título que emite `PageHeader`
 * hacia la TopBar) y la cola de trabajo (que se fue a `views/trabajo-view.tsx`,
 * su propia vista). Lo que queda es lo transversal: una cifra por dominio y lo
 * que requiere atención ahora.
 *
 * Deja de ser `"use client"`: sin la cola no queda estado ni handler, sólo
 * enlaces.
 */
export function DashboardResumenBody({
  scope,
  metrics,
  alerts,
  periodSummary,
  backlogSummary,
  mainSlot,
  asideSlot,
}: DashboardResumenBodyProps) {
  return (
    <DashboardGrid
      main={
        <>
          {/* ── KPIs accionables (tira editorial) ── */}
          {metrics.length > 0 && <OperationalMetricsStrip metrics={metrics} />}
          {mainSlot}
        </>
      }
      aside={
        <>
          {/* ── Requiere atención ── */}
          <section aria-labelledby="alertas-operacionales" className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
              <h2 id="alertas-operacionales" className="text-h3 text-[var(--color-text)]">Requiere atención</h2>
              {alerts.length > 0 && <span className="font-mono text-xs font-semibold text-[var(--color-text-muted)]">{alerts.length} activa{alerts.length === 1 ? "" : "s"}</span>}
            </div>
            {alerts.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {alerts.map((alert) => <OperationalAlert key={alert.key} alert={alert} />)}
              </div>
            ) : (
              <div className="py-2">
                <EmptyState
                  compact
                  align="start"
                  icon={<CheckCircle size={20} weight="fill" />}
                  tone="success"
                  title="No hay alertas operacionales activas"
                  description="No se detectaron pendientes críticos en los módulos que puedes revisar desde este dashboard."
                />
              </div>
            )}
          </section>

          {asideSlot}

          {/* ── Métricas del período (lectura de apoyo) ── */}
          {periodSummary.length > 0 && (
            <CompactMetricList id="flujo-mensual" title={periodFlowTitle(scope.period)} entries={periodSummary} />
          )}
          {backlogSummary.length > 0 && (
            <CompactMetricList id="backlog-comparado" title="Backlog comparado" entries={backlogSummary} />
          )}
        </>
      }
    />
  )
}

/**
 * Lista compacta de métricas del período para el lateral del dashboard.
 */
function CompactMetricList({ id, title, entries }: {
  id: string
  title: string
  entries: OperationalPeriodSummaryEntry[]
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <h2 id={id} className="text-h3 text-[var(--color-text)] border-b border-[var(--color-border)] pb-3">{title}</h2>
      <ul className="mt-2 divide-y divide-[var(--color-border)]">
        {entries.map((entry) => (
          <li key={entry.key}>
            <Link
              href={entry.href}
              className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-[var(--color-surface-2)] rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)]">
                  {entry.label}: <span className="font-mono tabular-nums">{entry.value}</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">{entry.comparison}</span>
              </span>
              {/* Sólo con serie real; sin ella la fila conserva su layout. */}
              {entry.sparkline && entry.sparkline.length >= 2 && (
                <span title={`Últimos ${entry.sparkline.length} días con instantánea completa`} className="shrink-0">
                  <MiniSparkline data={entry.sparkline} color={CHART_COLORS.brand} className="h-6 w-14" />
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function OperationalAlert({ alert }: { alert: DashboardAlert }) {
  const meta = SEVERITY_META[alert.severity]
  const content = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
        <WarningCircle size={17} weight={alert.severity === "critical" ? "fill" : "regular"} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums text-[var(--color-text)]">{alert.count}</span>
          <span className="text-sm font-semibold text-[var(--color-text)]">{alert.title}</span>
          <Badge variant={meta.variant} size="sm" dot>{meta.label}</Badge>
        </span>
        <span className="mt-1 block text-xs leading-5 text-[var(--color-text-muted)]">{alert.description}</span>
      </span>
    </>
  )
  const className = "group flex min-h-20 items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 text-left transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] motion-safe:active:scale-[0.99]"

  if (alert.href) return <Link href={alert.href} data-pressable className={className}>{content}</Link>
  return <div className={className}>{content}</div>
}
