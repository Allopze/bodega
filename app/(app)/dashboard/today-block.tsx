import Link from "next/link"
import {
  ArrowRight,
  CaretRight,
  CheckCircle,
  CheckSquare,
  Clock,
  HardHat,
  Package,
  Prohibit,
  ShieldWarning,
  Truck,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr"
import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { DashboardPanel, PanelBlock } from "@/components/ui/dashboard-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import { ChartFrame } from "./charts/chart-frame"
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
 * Rediseño del tablero: las dos listas son bloques de **un solo panel** con una
 * línea fina entre ellos, y cada fila es una línea compacta (icono · título ·
 * pista · cifra · flecha) en vez de una tarjeta alta con borde propio. Con
 * cinco alertas las tarjetas empujaban los indicadores bajo el pliegue.
 *
 * Es server component: sólo hay enlaces.
 */

const CRITICAL_META: StateMetaInput = { label: "Crítica", variant: "danger" }

/**
 * La severidad ya no es una insignia repetida en cada fila ("CRÍTICA" cinco
 * veces seguidas era ruido): la dicen el color del icono y de la cifra, y la
 * palabra sigue en el enlace como texto solo para lector de pantalla — el e2e
 * `dashboard.spec.ts` y quien no distingue colores dependen de ella.
 *
 * Texto con tokens `-ink` (AGENTS.md regla 8): los base no pasan AA.
 */
const SEVERITY_META: Record<DashboardAlert["severity"], { label: string; tile: string; pill: string }> = {
  critical: {
    label: "Crítica",
    tile: "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
    pill: "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
  },
  warning: {
    label: "Atención",
    tile: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
    pill: "bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
  },
  info: {
    label: "Pendiente",
    tile: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
    pill: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
}

/** El icono dice de qué trata la alerta; el color, cuán grave es. */
const ALERT_ICON = {
  critical: WarningCircle,
  overdue: Clock,
  blocked: Prohibit,
  capa: ShieldWarning,
  approvals: CheckSquare,
  receipts: Truck,
  deliveries: Package,
  epp: HardHat,
} as const

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"

/** Fila de lista compacta: el hover se extiende 8px más allá del texto. */
const ROW = cn(
  "group -mx-2 flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]",
  FOCUS,
)

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
  // Con una sola lista ocupa la fila entera; con las dos, mitad y mitad.
  const span = alerts.length > 0 && items.length > 0 ? "lg:col-span-6" : "lg:col-span-12"

  return (
    <section aria-labelledby="hoy-titulo" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="hoy-titulo" className="text-h2 text-[var(--color-text)]">Hoy</h2>
        {!empty && link}
      </div>

      {empty ? (
        <DashboardPanel>
          <PanelBlock padding="none">
            <EmptyState
              compact
              icon={<CheckCircle size={20} weight="fill" />}
              tone="success"
              title={`Nada urgente hoy en ${scopeLabel}`}
              description="No hay alertas ni pendientes vencidos o críticos."
              action={link ?? undefined}
            />
          </PanelBlock>
        </DashboardPanel>
      ) : (
        <DashboardPanel cols="twelve">
          {alerts.length > 0 && (
            <PanelBlock padding="none" className={span}>
              <ChartFrame
                title="Requiere atención"
                description={`${alerts.length} activa${alerts.length === 1 ? "" : "s"}`}
              >
                <ul aria-label="Requiere atención" className="divide-y divide-[var(--color-border)]">
                  {alerts.map((alert) => <li key={alert.key}><OperationalAlert alert={alert} /></li>)}
                </ul>
              </ChartFrame>
            </PanelBlock>
          )}
          {items.length > 0 && (
            <PanelBlock padding="none" className={span}>
              <ChartFrame title="Lo más urgente de tus pendientes">
                <ol aria-label="Lo más urgente de tus pendientes" className="divide-y divide-[var(--color-border)]">
                  {items.map((item) => <li key={item.id}><TodayRow item={item} /></li>)}
                </ol>
              </ChartFrame>
            </PanelBlock>
          )}
        </DashboardPanel>
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
    <Link href={item.href} data-pressable className={cn(ROW, "min-h-14 items-start justify-between")}>
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
  const meta = SEVERITY_META[alert.severity]
  const AlertIcon = ALERT_ICON[alert.key as keyof typeof ALERT_ICON] ?? WarningCircle
  const content = (
    <>
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", meta.tile)}>
        <AlertIcon size={16} weight={alert.severity === "critical" ? "fill" : "regular"} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        {/* La cifra va a la derecha, en la píldora, pero se lee primero: el
            título dice "tareas vencidas" y sin el número delante no significa
            nada ("215 tareas vencidas"). El `sr-only` la antepone al nombre del
            enlace y la píldora se oculta para no leerla dos veces. Va como
            hermano y no dentro del título para que `first-letter` capitalice
            el texto visible y no el número. */}
        <span className="sr-only">{alert.count} </span>
        {/* Desde `sm` el título no se parte: lo que cede espacio es la pista, que
            se trunca. Bajo `sm` la pista no se muestra y el título puede envolver. */}
        <span className="min-w-0 text-sm font-semibold text-[var(--color-text)] first-letter:uppercase sm:shrink-0">
          {alert.title}
          <span className="sr-only"> · {meta.label}</span>
        </span>
        <span title={alert.description} className="hidden min-w-0 truncate text-[13px] text-[var(--color-text-muted)] sm:block">
          {alert.description}
        </span>
      </span>
      <span aria-hidden className={cn("shrink-0 rounded-full px-2 py-0.5 text-[13px] font-bold tabular-nums", meta.pill)}>
        {alert.count}
      </span>
      <CaretRight
        size={16}
        aria-hidden
        className="shrink-0 text-[var(--color-text-subtle)] transition-[transform,color] duration-[var(--duration-fast)] ease-[var(--ease-out)] group-hover:text-[var(--color-text)] motion-safe:group-hover:translate-x-0.5"
      />
    </>
  )

  if (alert.href) return <Link href={alert.href} data-pressable className={ROW}>{content}</Link>
  return <div className={ROW}>{content}</div>
}
