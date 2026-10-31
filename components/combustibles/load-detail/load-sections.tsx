import * as React from "react"
import Link from "next/link"
import { ArrowRight, Lock, Warning } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { Card } from "@/components/ui/card"
import { DetailItem } from "@/components/ui/detail-item"
import { MetaBadge, StateBadge } from "@/components/states/state-badge"
import { FLAG_REASON_LABELS, REVIEW_STATUS_LABELS, type FlagReason, type ReviewStatus } from "@/lib/combustibles/control/contracts"
import { FUEL_LOAD_ORIGIN_LABEL, PERSONAL_DATA_LABEL, type FuelLoadOriginSlug } from "@/lib/combustibles/fuel-log-shared"
import type { LoadReviewState } from "@/lib/combustibles/fuel-log-detail"
import type { LoadTimelineEvent, TimelineTone } from "@/lib/combustibles/fuel-log-timeline"
import { fuelInboxHref, fuelLoadHref, withFuelContext } from "@/lib/combustibles/routes"
import { inboxRowKey } from "@/lib/combustibles/inbox/types"
import { DecideLoadButtons } from "@/components/combustibles/inbox/decide-load-buttons"
import { ReopenDecisionButton } from "@/components/combustibles/inbox/reopen-decision-button"
import { cn, formatDateTime } from "@/lib/utils"

/** Una sección de la ficha: tarjeta con su título (un `h2`, para navegar con lector de pantalla). */
export function LoadSection({
  title,
  description,
  actions,
  id,
  className,
  bare = false,
  children,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  id?: string
  className?: string
  /** Sin tarjeta propia: para contenido que ya trae sus tarjetas (el formulario de la factura). */
  bare?: boolean
  children: React.ReactNode
}) {
  if (bare) {
    return (
      <section id={id} aria-label={title} className={cn("scroll-mt-4", className)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h3 text-[var(--color-text)]">{title}</h2>
          {actions}
        </div>
        {description && <p className="mt-1 text-sub">{description}</p>}
        <div className="mt-3">{children}</div>
      </section>
    )
  }
  return (
    <Card id={id} className={cn("scroll-mt-4 p-5", className)} role="region" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3 text-[var(--color-text)]">{title}</h2>
        {actions}
      </div>
      {description && <p className="mt-1 text-sub">{description}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  )
}

export interface LoadFact {
  label: string
  value: React.ReactNode
  mono?: boolean
}

/** La tira de datos de la carga: cada uno con su rótulo arriba. */
export function LoadFacts({ items, className }: { items: LoadFact[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5", className)}>
      {items.map((item) => (
        <DetailItem key={item.label} label={item.label} value={item.value} layout="stacked" mono={item.mono} />
      ))}
    </dl>
  )
}

/** Lo que ve en lugar del dato quien no tiene `view_personal`. */
export function ReservedValue() {
  return (
    <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]" title="Requiere el permiso para ver datos personales">
      <Lock size={12} aria-hidden />
      {PERSONAL_DATA_LABEL}
    </span>
  )
}

export function LoadOriginBadge({ origin }: { origin: FuelLoadOriginSlug }) {
  return <Badge variant="outline" size="sm">{FUEL_LOAD_ORIGIN_LABEL[origin]}</Badge>
}

/** El estado de la carga en palabras (el mismo `Badge` de la lista). */
export function LoadStatusBadge({ origen, status }: { origen: "terreno" | "factura" | "planilla"; status: string }) {
  if (origen === "planilla") return <Badge variant="default" size="sm">Importada</Badge>
  return <StateBadge state={status} entity="fuel_log" size="sm" />
}

const TONE_BORDER: Record<TimelineTone, string> = {
  default: "border-[var(--color-border-strong)]",
  signal: "border-[var(--color-signal)]",
  success: "border-[var(--color-success)]",
  danger: "border-[var(--color-danger)]",
}

/** La línea de tiempo de la carga, en palabras. */
export function LoadTimeline({ events, emptyText = "Todavía no hay movimientos para mostrar." }: { events: LoadTimelineEvent[]; emptyText?: string }) {
  if (events.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">{emptyText}</p>
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.key} className={cn("border-l-2 pl-3", TONE_BORDER[event.tone])}>
          <p className="text-sm text-[var(--color-text)]">{event.text}</p>
          {event.note ? <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">«{event.note}»</p> : null}
          <p className="mt-0.5 font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{formatDateTime(event.at)}</p>
        </li>
      ))}
    </ol>
  )
}

const FLAG_EFFECT_TEXT = "Mientras nadie decide, sus litros cuentan, pero la carga no entra al promedio del equipo."

/**
 * El estado de revisión de la plataforma: «Por decidir» (con el motivo y el
 * enlace a la bandeja), «Cuenta» / «No cuenta» (con quién y por qué) o «Sin
 * observaciones». Decidir y deshacer se hacen desde «Por revisar»; la ficha sólo
 * lo cuenta y enlaza.
 */
export function LoadReviewStatus({
  review,
  search,
  canDecide = false,
  equipmentLabel,
}: {
  review: LoadReviewState | null
  /** Parámetros de la URL actual, para que el enlace a la bandeja conserve período y faena. */
  search?: Record<string, string | string[] | undefined>
  /** `combustibles:approve_flagged`: ofrece «Cuenta / No cuenta» y «Deshacer decisión» aquí mismo. */
  canDecide?: boolean
  /** A quién se refiere la decisión, para los nombres accesibles. */
  equipmentLabel?: string
}) {
  const decisionLabel = equipmentLabel ?? "esta carga"
  if (!review) {
    return <p className="text-sm text-[var(--color-text-muted)]">La plataforma todavía no revisa esta carga.</p>
  }
  const status = (Object.hasOwn(REVIEW_STATUS_LABELS, review.reviewStatus) ? review.reviewStatus : "ok") as ReviewStatus
  const reasons = review.flagReasons.map((code) => (Object.hasOwn(FLAG_REASON_LABELS, code) ? FLAG_REASON_LABELS[code as FlagReason] : code))

  if (status === "flagged") {
    const href = withFuelContext(fuelInboxHref({ tipo: "carga", item: inboxRowKey("carga", review.equipmentLoadId) }), search ?? {})
    return (
      <Callout tone="warning" role="status" icon={<Warning size={16} />} title="Esta carga espera una decisión">
        {reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5">
            {reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        <p className="mt-2">{FLAG_EFFECT_TEXT}</p>
        {canDecide ? (
          <div className="mt-3 rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-3 text-[var(--color-text)]">
            <DecideLoadButtons loadIds={[review.equipmentLoadId]} reasonCodes={review.flagReasons} label={decisionLabel} />
          </div>
        ) : null}
        <p className="mt-2">
          <Link href={href} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
            {canDecide ? "Verla en «Por revisar»" : "Decidir en «Por revisar»"} <ArrowRight size={12} aria-hidden />
          </Link>
        </p>
      </Callout>
    )
  }
  if (status === "approved" || status === "rejected") {
    return (
      <div className="space-y-1 text-sm">
        <p>
          <MetaBadge meta={{ label: REVIEW_STATUS_LABELS[status], variant: status === "approved" ? "success" : "danger" }} size="sm" />
          <span className="ml-2 text-[var(--color-text-muted)]">
            {review.reviewedByName ? `Lo decidió ${review.reviewedByName}` : "Se decidió"}
            {review.reviewedAt ? ` el ${formatDateTime(review.reviewedAt)}` : ""}.
          </span>
        </p>
        {review.reviewNote ? <p className="text-[var(--color-text-muted)]">«{review.reviewNote}»</p> : null}
        {reasons.length > 0 && <p className="text-xs text-[var(--color-text-subtle)]">Motivo de la revisión: {reasons.join("; ")}.</p>}
        {canDecide ? <div className="pt-2"><ReopenDecisionButton loadId={review.equipmentLoadId} label={decisionLabel} /></div> : null}
      </div>
    )
  }
  return <p className="text-sm text-[var(--color-text-muted)]">{REVIEW_STATUS_LABELS.ok}: la plataforma no encontró nada que decidir en esta carga.</p>
}

/** El pedido de revisión abierto, en el cuerpo de la ficha (el botón vive en la cabecera). */
export function OpenRequestNotice({
  request,
  search,
}: {
  request: { note: string | null; markedByName: string | null; createdAt: string }
  search?: Record<string, string | string[] | undefined>
}) {
  return (
    <Callout tone="info" role="status" title="Hay un pedido de revisión abierto">
      <p>
        {request.markedByName ? <>{request.markedByName} pidió que la revisen el {formatDateTime(request.createdAt)}</> : <>Piden que la revisen desde el {formatDateTime(request.createdAt)}</>}
        {request.note ? <>: «{request.note}»</> : "."}
      </p>
      <p className="mt-1">
        <Link href={withFuelContext(fuelInboxHref({ tipo: "pedido" }), search ?? {})} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
          Verlo en «Por revisar» <ArrowRight size={12} aria-hidden />
        </Link>
      </p>
    </Callout>
  )
}

export interface NeighborLoad {
  id: string
  loadedAt: string
  liters: number
  meterReading: number | null
  meterUnit: string
  state: string | null
}

/** La carga anterior y la siguiente del mismo equipo (enlaces a sus fichas). */
export function NeighborLoads({
  previous,
  next,
  current,
  search,
}: {
  previous: NeighborLoad | null
  next: NeighborLoad | null
  current: { loadedAt: string; liters: number; meterReading: number | null; meterUnit: string }
  search?: Record<string, string | string[] | undefined>
}) {
  const line = (item: { liters: number; meterReading: number | null; meterUnit: string }, state?: string | null) =>
    `${item.liters.toLocaleString("es-CL")} L${item.meterReading != null ? ` · ${item.meterReading.toLocaleString("es-CL")} ${item.meterUnit}` : ""}${state ? ` · ${state}` : ""}`
  const href = (id: string) => withFuelContext(fuelLoadHref({ origen: "terreno", id }), search ?? {})
  return (
    <ul className="space-y-3 text-sm">
      <li>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{previous ? formatDateTime(previous.loadedAt) : "—"}</span>
        <span className="block">
          {previous ? <Link href={href(previous.id)} className="text-[var(--color-primary-ink)] hover:underline">{line(previous, previous.state)}</Link> : <span className="text-[var(--color-text-muted)]">Todavía no hay una carga anterior.</span>}
        </span>
      </li>
      <li>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{formatDateTime(current.loadedAt)}</span>
        <span className="block font-semibold">{line(current)} · esta carga</span>
      </li>
      <li>
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">{next ? formatDateTime(next.loadedAt) : "—"}</span>
        <span className="block">
          {next ? <Link href={href(next.id)} className="text-[var(--color-primary-ink)] hover:underline">{line(next, next.state)}</Link> : <span className="text-[var(--color-text-muted)]">Todavía no hay una carga siguiente.</span>}
        </span>
      </li>
    </ul>
  )
}
