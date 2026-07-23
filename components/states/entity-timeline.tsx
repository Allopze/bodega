import * as React from "react"
import { Clock, ArrowRight, User } from "@phosphor-icons/react/dist/ssr"
import { formatDate } from "@/lib/utils"
import {
  REQUEST_STATE_META, OC_STATE_META, ITEM_STATE_META, PPA_STATE_META, FUEL_STATE_META,
  type RequestStatus, type OcStatus,
} from "./state-badge"
import type { ItemStatus } from "@/lib/services/item-state"

export interface TimelineEvent {
  id:         string
  fromStatus: string | null
  toStatus:   string
  changedBy:  string | null
  changedAt:  string
  reason:     string | null
  userName:   string | null
  userEmail:  string | null
}

export type TimelineEntityType = "request" | "oc" | "item" | "ppa" | "fuel_log" | "prevention" | "generic"

interface EntityTimelineProps {
  entityType: TimelineEntityType
  events:     TimelineEvent[]
  title?:     string
  description?: string
  className?: string
}

function getStatusLabel(status: string, entityType: TimelineEntityType) {
  switch (entityType) {
    case "request":  return REQUEST_STATE_META[status as RequestStatus]?.label ?? status
    case "oc":       return OC_STATE_META[status as OcStatus]?.label ?? status
    case "ppa":      return PPA_STATE_META[status]?.label ?? status
    case "fuel_log": return FUEL_STATE_META[status]?.label ?? status
    case "item":     return ITEM_STATE_META[status as ItemStatus]?.label ?? status
    default:         return status
  }
}

const EntityTimelineInner = React.memo(function EntityTimelineInner({
  entityType,
  events,
  title = "Historial de cambios",
  description = "Registro de transiciones y auditoría",
  className,
}: EntityTimelineProps) {
  return (
    <section className={`rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <h2 className="text-h2">{title}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {description}
          </p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
          <Clock size={16} />
        </div>
      </div>

      <div className="px-4 py-5">
        {events.length === 0 ? (
          <p className="text-xs text-[var(--color-text-subtle)] italic">Sin registros en el historial.</p>
        ) : (
          <div className="relative border-l border-[var(--color-border)] ml-3 pl-6 space-y-6">
            {events.map((event) => {
              const labelFrom = event.fromStatus ? getStatusLabel(event.fromStatus, entityType) : null
              const labelTo   = getStatusLabel(event.toStatus, entityType)

              return (
                <div key={event.id} className="relative group">
                  {/* Timeline dot */}
                  <span className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-surface)] border-2 border-[var(--color-border)] group-hover:border-[var(--color-primary)] transition-colors duration-[var(--duration-fast)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-subtle)] group-hover:bg-[var(--color-primary)] transition-colors duration-[var(--duration-fast)]" />
                  </span>

                  <div>
                    {/* Timestamp & User */}
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-muted)]">
                      <span className="font-medium">{formatDate(event.changedAt)}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <User size={12} className="text-[var(--color-text-subtle)]" />
                        {event.userName ?? event.userEmail ?? "Sistema"}
                      </span>
                    </div>

                    {/* Transition */}
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      {labelFrom && (
                        <>
                          <span className="text-[var(--color-text-muted)]">{labelFrom}</span>
                          <ArrowRight size={12} className="text-[var(--color-text-subtle)]" />
                        </>
                      )}
                      <span className="font-semibold text-[var(--color-text)]">{labelTo}</span>
                    </div>

                    {/* Reason */}
                    {event.reason && (
                      <div className="mt-1.5 p-2 rounded-[var(--radius)] bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-l-2 border-[var(--color-warning)] italic">
                        &ldquo;{event.reason}&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
})

export const EntityTimeline = EntityTimelineInner
