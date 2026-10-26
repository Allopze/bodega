import * as React from "react"
import Link from "next/link"
import { DashboardPanel, PanelBlock, ChartSlot } from "@/components/ui/dashboard-panel"
import { Delta, type DeltaPolarity } from "@/components/ui/delta"
import { MiniSparkline } from "@/components/ui/mini-sparkline"
import { CHART_COLORS } from "@/lib/chart-palette"
import { cn } from "@/lib/utils"
import { ChartFrame } from "./charts/chart-frame"
import { periodComparisonLabel, periodFlowTitle, type DashboardScope } from "./dashboard-scope"
import type { TodayItem } from "./dashboard-today"
import { TodayBlock } from "./today-block"
import { OperationalMetricsStrip } from "./operational-metrics-strip"

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
  /**
   * Variación real contra una comparación que existe (período anterior, corte
   * mensual). `null`/ausente: no se dibuja; nunca se inventa una tendencia.
   */
  trend?: number | null
  /** Qué significa que suba: gasto y atraso, `up-bad`. */
  trendPolarity?: DeltaPolarity
  /** `percent` (default de `KpiCard`) o `number` para variaciones en unidades. */
  trendFormat?: "percent" | "number"
  /** Contra qué se compara ("vs. sep", "vs. 07-09"). */
  trendLabel?: string
  /** Tile sin dato (A1): dice qué significa y, si hay permiso, cómo salir del vacío. */
  empty?: { message: string; actionLabel?: string }
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
  /**
   * Texto de la comparación. Es el **respaldo**: con `delta.value` numérico lo
   * dibuja `<Delta>`; sin él ("Sin período comparable") se muestra esto.
   */
  comparison: string
  href: string
  /** Nombre completo de una sigla o definición del rótulo (A6); va como `title`. */
  hint?: string
  /** Serie diaria real; sólo la traen las entradas con instantáneas. */
  sparkline?: number[]
  /**
   * Variación numérica contra la comparación de la fila. Los flujos del período
   * (solicitudes, OC emitidas, recepciones, entregas) son volúmenes: `neutral`.
   * Los pendientes comparados son atraso acumulado: `up-bad`.
   */
  delta?: {
    value: number | null
    polarity: DeltaPolarity
    format?: "number" | "percent"
    /** "vs. sep", "vs. 07-09": contra qué se compara. */
    label?: string
  }
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
  /**
   * Tendencia operativa (fila de gráficos, ancho 8/12). Sólo se pasa cuando el
   * gráfico va a dibujar algo: un gráfico que se oculta solo dejaría un hueco en
   * la fila, porque el ancho del medidor depende de si hay tendencia.
   */
  trendSlot?: React.ReactNode
  /** Medidor de cumplimiento (fila de gráficos, ancho 4/12). */
  gaugeSlot?: React.ReactNode
  /** Actividad reciente: el último bloque de la fila de apoyo. */
  activitySlot?: React.ReactNode
}

/** Ancho de cada bloque de la fila de apoyo según cuántos hay: sin huecos. */
const SUPPORT_SPAN: Record<number, string> = {
  1: "lg:col-span-12",
  2: "lg:col-span-6",
  3: "lg:col-span-4",
}

/**
 * Cuerpo de la vista Resumen: **"Hoy" arriba, panorama abajo**.
 *
 * "Hoy" (`TodayBlock`) es lo primero en el DOM y en pantalla: alertas
 * accionables, las filas más urgentes de la cola y un enlace a `/pendientes`.
 * Debajo, el panorama: los KPIs por ranura y, en **un solo panel** con líneas
 * finas entre bloques, los gráficos (tendencia 8 + medidor 4) y la fila de
 * lecturas de apoyo (flujo del período · pendientes comparados · actividad).
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
  trendSlot,
  gaugeSlot,
  activitySlot,
}: DashboardResumenBodyProps) {
  // Si falta uno de los dos gráficos, el otro ocupa la fila entera en vez de
  // dejar media fila en blanco. Lo mismo en la fila de apoyo.
  const trendSpan = gaugeSlot ? "lg:col-span-8" : "lg:col-span-12"
  const gaugeSpan = trendSlot ? "lg:col-span-4" : "lg:col-span-12"
  const supportCount = [periodSummary.length > 0, backlogSummary.length > 0, Boolean(activitySlot)].filter(Boolean).length
  const supportSpan = SUPPORT_SPAN[supportCount]

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
      <div className="flex flex-col gap-4">
        {/* ── KPIs accionables ── */}
        {metrics.length > 0 && <OperationalMetricsStrip metrics={metrics} />}

        {/* ── Gráficos y lecturas de apoyo: un panel, cada bloque con su ancho ── */}
        <DashboardPanel cols="twelve">
          {trendSlot && <ChartSlot className={trendSpan}>{trendSlot}</ChartSlot>}
          {gaugeSlot && <PanelBlock padding="none" className={gaugeSpan}>{gaugeSlot}</PanelBlock>}
          {periodSummary.length > 0 && (
            <PanelBlock padding="none" className={supportSpan}>
              <CompactMetricList
                title={periodFlowTitle(scope.period)}
                description={`Variación ${periodComparisonLabel(scope.period)}`}
                entries={periodSummary}
              />
            </PanelBlock>
          )}
          {backlogSummary.length > 0 && (
            <PanelBlock padding="none" className={supportSpan}>
              <CompactMetricList
                title="Pendientes comparados"
                description="Contra el último corte mensual"
                entries={backlogSummary}
              />
            </PanelBlock>
          )}
          {activitySlot && <PanelBlock padding="none" className={supportSpan}>{activitySlot}</PanelBlock>}
        </DashboardPanel>
      </div>
    </div>
  )
}

/**
 * Lista compacta de cifras con su variación: el valor (sans, tabular, 17 px) y,
 * al lado, un `<Delta>` — la única forma de mostrar una variación en el tablero.
 *
 * Era una cadena ya formateada ("+2 vs. mes anterior") en una línea aparte,
 * pintada igual para subas buenas y malas. Con `Delta` el color depende de la
 * polaridad de la fila: los flujos son volúmenes (neutros) y los pendientes
 * acumulados son `up-bad`.
 *
 * El nombre de la región se toma de `aria-label` porque `ChartFrame` no expone
 * un `id` en su título; el rótulo es el mismo que el visible.
 */
function CompactMetricList({ title, description, entries }: {
  title: string
  description: string
  entries: OperationalPeriodSummaryEntry[]
}) {
  return (
    <section aria-label={title} className="h-full min-w-0">
      <ChartFrame title={title} description={description}>
        <ul className="divide-y divide-[var(--color-border)]">
          {entries.map((entry) => {
            const hasDelta = entry.delta != null && entry.delta.value !== null
            return (
              <li key={entry.key}>
                <Link
                  href={entry.href}
                  className={cn(
                    // Rejilla de dos columnas: rótulo | cifra. El texto de
                    // respaldo cae a la segunda fila bajo el rótulo, pero queda
                    // **después** de la cifra en el DOM (se lee "Solicitudes
                    // activas 4, sin corte mensual comparable").
                    "group -mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-[var(--radius-md)] px-2 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
                  )}
                >
                  <span title={entry.hint} className="block min-w-0 truncate text-sm text-[var(--color-text)] group-hover:text-[var(--color-primary)]">
                    {entry.label}
                  </span>
                  <span className="flex items-center gap-2.5">
                    {/* Sólo con serie real; sin ella la fila conserva su layout. */}
                    {entry.sparkline && entry.sparkline.length >= 2 && (
                      <span title={`Últimos ${entry.sparkline.length} días con instantánea completa`} className="shrink-0">
                        <MiniSparkline data={entry.sparkline} color={CHART_COLORS.brand} className="h-6 w-14" />
                      </span>
                    )}
                    <span className="text-[17px] font-semibold leading-none tabular-nums text-[var(--color-text)]">{entry.value}</span>
                    {hasDelta && entry.delta && (
                      <Delta
                        value={entry.delta.value}
                        format={entry.delta.format ?? "number"}
                        polarity={entry.delta.polarity}
                        comparisonLabel={entry.delta.label}
                      />
                    )}
                  </span>
                  {/* Sin comparación real no hay variación que dibujar: se dice
                      con palabras, como siempre, bajo el rótulo. */}
                  {!hasDelta && <span className="mt-0.5 block min-w-0 text-xs text-[var(--color-text-muted)]">{entry.comparison}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      </ChartFrame>
    </section>
  )
}
