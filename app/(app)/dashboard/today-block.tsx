import Link from "next/link"
import { ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import type { DashboardAlert } from "./dashboard-control-center"
import { pendientesLinkLabel, type TodayItem } from "./dashboard-today"

/**
 * El bloque "Hoy": **lo primero que ve el usuario al abrir Inicio**.
 *
 * "Hoy arriba, panorama abajo" (decisión de producto, ronda UI/UX 2026-10-05):
 * antes la página abría con un tile relleno de dinero ("Inversión $0") y la
 * urgencia —215 tareas vencidas— quedaba en un lateral. Acá va primero en el DOM
 * y en pantalla, en móvil y en escritorio:
 *
 * - las alertas accionables ("Requiere atención"), cada una un enlace a su
 *   subconjunto, con la severidad **en texto** y no sólo en color;
 * - hasta cinco filas de la cola, con el vencimiento en palabras;
 * - **un** enlace a `/pendientes`.
 *
 * Es server component: sólo hay enlaces.
 */

const CRITICAL_META: StateMetaInput = { label: "Crítica", variant: "danger" }

const SEVERITY_META: Record<string, StateMetaInput> = {
  critical: CRITICAL_META,
  warning:  { label: "Atención", variant: "warning" },
  info:     { label: "Pendiente", variant: "info" },
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"

export function TodayBlock({
  alerts,
  items,
  pendingTotal,
  pendientesHref,
  queueVisible,
  scopeLabel,
}: {
  alerts: DashboardAlert[]
  /** Las filas más urgentes ya elegidas (`pickTodayItems`); vacío sin permiso de cola. */
  items: TodayItem[]
  /** Población completa de la cola en el alcance: el número del enlace. */
  pendingTotal: number
  /** Destino del enlace único, con la faena del alcance. */
  pendientesHref: string
  /** `false` sin `operations:view_work`: no hay cola a la que mandar. */
  queueVisible: boolean
  /** "Faena Norte" o "tus faenas": completa "Nada urgente hoy en …". */
  scopeLabel: string
}) {
  const empty = alerts.length === 0 && items.length === 0
  const link = queueVisible ? (
    <Link
      href={pendientesHref}
      className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-lg text-sm font-semibold text-[var(--color-primary)] hover:underline", FOCUS)}
    >
      {pendientesLinkLabel(pendingTotal)}
      <ArrowRight size={14} weight="bold" aria-hidden />
    </Link>
  ) : null

  // Sin chrome de tarjeta: "Hoy" es la banda principal del pozo y sus alertas
  // y pendientes ya son superficies propias; envolverlas en otra tarjeta las
  // anidaba (piso de calidad, 2026-10-05).
  return (
    <section aria-labelledby="hoy-titulo" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--color-border)] pb-3">
        <h2 id="hoy-titulo" className="text-h2 text-[var(--color-text)]">Hoy</h2>
        {!empty && link}
      </div>

      {empty ? (
        <EmptyState
          compact
          icon={<CheckCircle size={20} weight="fill" />}
          tone="success"
          title={`Nada urgente hoy en ${scopeLabel}`}
          description="No hay alertas ni pendientes vencidos o críticos."
          action={link ?? undefined}
        />
      ) : (
        <div className={cn("mt-4 grid grid-cols-1 gap-x-8 gap-y-6", items.length > 0 && alerts.length > 0 && "lg:grid-cols-2")}>
          {alerts.length > 0 && (
            <div className="min-w-0">
              <h3 id="alertas-operacionales" className="mb-2.5 flex items-baseline gap-2 text-sm font-semibold text-[var(--color-text)]">
                Requiere atención
                <span className="font-mono text-xs font-semibold text-[var(--color-text-muted)]">
                  {alerts.length} activa{alerts.length === 1 ? "" : "s"}
                </span>
              </h3>
              <ul aria-labelledby="alertas-operacionales" className="flex flex-col gap-2.5">
                {alerts.map((alert) => <li key={alert.key}><OperationalAlert alert={alert} /></li>)}
              </ul>
            </div>
          )}
          {items.length > 0 && (
            <div className="min-w-0">
              <h3 id="pendientes-urgentes" className="mb-2.5 text-sm font-semibold text-[var(--color-text)]">
                Lo más urgente de tus pendientes
              </h3>
              <ol aria-labelledby="pendientes-urgentes" className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
                {items.map((item) => <li key={item.id}><TodayRow item={item} /></li>)}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const DUE_TONE: Record<TodayItem["due"], string> = {
  overdue:  "text-[var(--color-danger-ink)]",
  today:    "text-[var(--color-warning-ink)]",
  upcoming: "text-[var(--color-text-muted)]",
  none:     "text-[var(--color-text-muted)]",
}

function TodayRow({ item }: { item: TodayItem }) {
  return (
    <Link
      href={item.href}
      data-pressable
      className={cn(
        "flex min-h-14 items-start justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]",
        "first:rounded-t-xl last:rounded-b-xl",
        FOCUS,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-[var(--color-text)]">{item.title}</span>
          {item.critical && <MetaBadge meta={CRITICAL_META} />}
        </span>
        {item.context && <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{item.context}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className={cn("block text-xs font-semibold", DUE_TONE[item.due])}>{item.dueLabel}</span>
        <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{item.ctaLabel}</span>
      </span>
    </Link>
  )
}

function OperationalAlert({ alert }: { alert: DashboardAlert }) {
  const meta = SEVERITY_META[alert.severity] ?? { label: alert.severity, variant: "default" as const }
  const content = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
        <WarningCircle size={17} weight={alert.severity === "critical" ? "fill" : "regular"} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums text-[var(--color-text)]">{alert.count}</span>
          <span className="text-sm font-semibold text-[var(--color-text)]">{alert.title}</span>
          <MetaBadge meta={meta} dot />
        </span>
        <span className="mt-1 block text-xs leading-5 text-[var(--color-text-muted)]">{alert.description}</span>
      </span>
    </>
  )
  const className = cn(
    "group flex min-h-16 items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left",
    "transition-[background-color,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] motion-safe:active:scale-[0.99]",
    FOCUS,
  )

  if (alert.href) return <Link href={alert.href} data-pressable className={className}>{content}</Link>
  return <div className={className}>{content}</div>
}
