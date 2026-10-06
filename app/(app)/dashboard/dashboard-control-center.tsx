import * as React from "react"
import Link from "next/link"
import { DashboardGrid } from "@/components/ui/dashboard-grid"
import { periodFlowTitle, type DashboardScope } from "./dashboard-scope"
import type { TodayItem } from "./dashboard-today"
import { TodayBlock } from "./today-block"
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
  /** Definición o nombre completo de la sigla (A6); lo muestra `KpiCard.glossary`. */
  glossary?: string
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
  /** Nombre completo de una sigla o definición del rótulo (A6); va como `title`. */
  hint?: string
  /** Serie diaria real; sólo la traen las entradas con instantáneas. */
  sparkline?: number[]
}

interface DashboardResumenBodyProps {
  /** Alcance global vigente: todas las cifras ya vienen consultadas con él. */
  scope: DashboardScope
  metrics: DashboardMetric[]
  /** Alertas accionables: viven en el bloque "Hoy", no en el panorama. */
  alerts: DashboardAlert[]
  /** Las filas más urgentes de la cola ("Hoy"); vacío sin permiso de cola. */
  todayItems?: TodayItem[]
  /** Total de la cola en el alcance: el número de "Ver todos mis pendientes". */
  pendingTotal?: number
  /** Destino de ese enlace, con la faena del alcance. */
  pendientesHref?: string
  /** `false` sin `operations:view_work`: no hay cola a la que mandar. */
  queueVisible?: boolean
  periodSummary: OperationalPeriodSummaryEntry[]
  backlogSummary: OperationalPeriodSummaryEntry[]
  /** Contenido extra de la columna principal (gráficos, actividad). */
  mainSlot?: React.ReactNode
  /** Contenido extra del lateral, antes de las métricas del período. */
  asideSlot?: React.ReactNode
}

/**
 * Cuerpo de la vista Resumen: **"Hoy" arriba, panorama abajo**.
 *
 * "Hoy" (`TodayBlock`) es lo primero en el DOM y en pantalla: alertas
 * accionables, las filas más urgentes de la cola y un enlace a `/pendientes`.
 * Debajo, el panorama: los KPIs por ranura, los gráficos y las lecturas de
 * apoyo, todos al mismo peso (sin tile relleno).
 *
 * Era `DashboardControlCenter` y montaba también el saludo (que pasó por un
 * `dashboard-header.tsx` intermedio y hoy es el título que emite `PageHeader`
 * hacia la TopBar) y la cola de trabajo, que ya no existe en Inicio: vive en
 * `/pendientes`.
 *
 * Deja de ser `"use client"`: sin la cola no queda estado ni handler, sólo
 * enlaces.
 */
export function DashboardResumenBody({
  scope,
  metrics,
  alerts,
  todayItems = [],
  pendingTotal = 0,
  pendientesHref = "/pendientes",
  queueVisible = true,
  periodSummary,
  backlogSummary,
  mainSlot,
  asideSlot,
}: DashboardResumenBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      <TodayBlock
        alerts={alerts}
        items={todayItems}
        pendingTotal={pendingTotal}
        pendientesHref={pendientesHref}
        queueVisible={queueVisible}
        scopeLabel={scope.worksiteName ?? "tus faenas"}
      />
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
            {asideSlot}

            {/* ── Métricas del período (lectura de apoyo) ── */}
            {periodSummary.length > 0 && (
              <CompactMetricList id="flujo-mensual" title={periodFlowTitle(scope.period)} entries={periodSummary} />
            )}
            {backlogSummary.length > 0 && (
              <CompactMetricList id="backlog-comparado" title="Pendientes comparados" entries={backlogSummary} />
            )}
          </>
        }
      />
    </div>
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
                <span title={entry.hint} className="block text-xs font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)]">
                  {entry.label}: <span className="font-mono tabular-nums">{entry.value}</span>
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{entry.comparison}</span>
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
