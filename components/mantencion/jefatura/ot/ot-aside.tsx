import Link from "next/link"
import { Clock, User } from "@phosphor-icons/react/dist/ssr"
import { MetaBadge } from "@/components/states/state-badge"
import type { WorkOrderDetail, WorkOrderEventDetail } from "@/lib/services/mantencion/work-orders/types"
import { formatDate, formatDateTime } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"
import { ACTION_TYPE_LABELS, SPECIALTY_LABELS, isActionType, type Specialty } from "@/lib/mantencion/action-type"
import { actionTypeText, laborHoursText, otEventLabel, OT_STATE_META, specialtiesText } from "./ot-labels"
import { sortEventsNewestFirst } from "./ot-format"

const LINK = "text-sm font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:underline"

/** Qué cambió, en una línea, para los eventos que traen un `changeSet` que importa. */
function changeText(event: WorkOrderEventDetail): string | null {
  const set = event.changeSet
  if (!set) return null
  if (event.type === "estimate_changed") {
    const from = typeof set.from === "string" ? formatDate(set.from) : null
    const to = typeof set.to === "string" ? formatDate(set.to) : null
    if (from && to) return `${from} → ${to}`
    if (to) return `Nueva fecha: ${to}`
  }
  return null
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {})

/**
 * Qué cambió en una corrección de clasificación, una línea por campo («Tipo de acción: Correctiva →
 * Preventiva»). El `changeSet` trae sólo los campos que cambiaron, con la faena también por nombre.
 */
export function classificationChanges(event: WorkOrderEventDetail): string[] {
  const set = event.changeSet
  if (event.type !== "edited" || set?.scope !== "clasificacion") return []
  const before = record(set.before)
  const after = record(set.after)
  const lines: string[] = []
  if ("actionType" in after) {
    const text = (value: unknown) => (isActionType(value) ? ACTION_TYPE_LABELS[value] : actionTypeText("sin_clasificar"))
    lines.push(`Tipo de acción: ${text(before.actionType)} → ${text(after.actionType)}`)
  }
  if ("specialties" in after) {
    const text = (value: unknown) => specialtiesText(Array.isArray(value) ? (value.filter((item): item is Specialty => typeof item === "string" && item in SPECIALTY_LABELS)) : [])
    lines.push(`Especialidades: ${text(before.specialties)} → ${text(after.specialties)}`)
  }
  if ("executionWorksiteId" in after) {
    const text = (name: unknown, id: unknown) => (typeof name === "string" ? name : typeof id === "string" ? id : "La del equipo")
    lines.push(`Faena de ejecución: ${text(before.executionWorksiteName, before.executionWorksiteId)} → ${text(after.executionWorksiteName, after.executionWorksiteId)}`)
  }
  if ("laborHours" in after) {
    const hours = (value: unknown) => laborHoursText(typeof value === "number" ? value : null)
    lines.push(`Horas hombre: ${hours(before.laborHours)} → ${hours(after.laborHours)}`)
  }
  return lines
}

/**
 * «Movimientos» de la OT, con TODOS sus eventos (asignaciones, cambios de fecha,
 * rechazos…), no sólo las transiciones de estado: por eso no usa
 * `EntityTimeline`, que sólo dibuja `from → to` de un estado. El motivo de un
 * rechazo o de una anulación se ve siempre.
 */
export function OtTimeline({ events }: { events: WorkOrderEventDetail[] }) {
  const sorted = sortEventsNewestFirst(events)
  return (
    <SectionCard title="Movimientos">
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Sin movimientos todavía.</p>
      ) : (
        <ol aria-label="Movimientos de la orden de trabajo" className="relative ml-3 space-y-5 border-l border-[var(--color-border)] pl-6">
          {sorted.map((event) => {
            const change = changeText(event)
            const classification = classificationChanges(event)
            return (
              <li key={event.id} className="relative">
                <span aria-hidden className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-surface)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-subtle)]" />
                </span>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-muted)]">
                  <Clock size={12} aria-hidden />
                  <time className="font-mono tabular-nums" dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1"><User size={12} aria-hidden />{event.actorName}</span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  {otEventLabel(event)}
                  {event.toStatus && event.fromStatus !== event.toStatus && (
                    <MetaBadge meta={OT_STATE_META[event.toStatus]} size="sm" />
                  )}
                </p>
                {change && <p className="mt-0.5 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{change}</p>}
                {classification.length > 0 && (
                  <ul aria-label="Qué cambió" className="mt-0.5 space-y-0.5 text-xs text-[var(--color-text-muted)]">
                    {classification.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
                {event.reason && (
                  <blockquote className="mt-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-xs text-[var(--color-text-muted)]">
                    <span className="sr-only">Motivo: </span>&ldquo;{event.reason}&rdquo;
                  </blockquote>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </SectionCard>
  )
}

/** Registros firmados enlazados (la correctiva o preventiva que el mecánico firmó contra esta OT) y el hallazgo de origen. */
export function OtLinks({ detail }: { detail: WorkOrderDetail }) {
  const records = detail.linkedRecords
  return (
    <SectionCard title="Registros y origen">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="mb-1.5 text-sm font-semibold text-[var(--color-text)]">Registros firmados</h3>
          {records.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Todavía no hay registros enlazados. El mecánico los firma desde su app o desde esta página.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {records.map((record) => {
                const kind = record.kind === "P" ? "Preventiva" : "Correctiva"
                const label = record.folio ?? "Sin folio"
                return (
                  <li key={record.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 text-sm">
                      {record.canOpen
                        ? <Link href={`/mantencion/registros/${record.id}`} className={`${LINK} font-mono`}>{label}</Link>
                        : <span className="font-mono font-semibold">{label}</span>}
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {kind} · {formatDate(record.workDate)}
                        {record.status === "anulado" && " · anulado"}
                        {!record.canOpen && " · sin acceso para abrirlo"}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {detail.inspectionFinding && (
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-[var(--color-text)]">Hallazgo de inspección</h3>
            <p className="text-sm">
              <Link href={`/prevencion/inspecciones/${detail.inspectionFinding.runId}`} className={LINK}>Ver la inspección de origen</Link>
            </p>
            {detail.inspectionFinding.capaActionId && (
              <p className="mt-1 text-sm">
                <Link href={`/prevencion/capa/${detail.inspectionFinding.capaActionId}`} className={LINK}>Ver la acción correctiva (CAPA)</Link>
              </p>
            )}
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Al dar la conformidad en faena, la acción correctiva se acredita y el hallazgo se cierra.</p>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

export function OtAside({ detail }: { detail: WorkOrderDetail }) {
  return (
    <aside aria-label="Movimientos y registros enlazados" className="flex min-w-0 flex-col gap-4">
      <OtTimeline events={detail.events} />
      <OtLinks detail={detail} />
    </aside>
  )
}
