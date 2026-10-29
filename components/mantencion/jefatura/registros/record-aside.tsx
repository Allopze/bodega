import type { ReactNode } from "react"
import Link from "next/link"
import { formatReading, recordKindText } from "@/lib/mantencion/format"
import type { RecordDetail } from "@/lib/services/mantencion/records-detail"
import { formatDate, formatDateTime } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"

/**
 * Columna lateral del detalle: fotos de respaldo, firmas, observaciones con su
 * respuesta e historial del equipo. Las fotos llegan ya armadas (`photos`) para
 * que esta pieza siga siendo de servidor y sólo la galería sea de cliente.
 */
export function RecordAside({ detail, photos }: { detail: RecordDetail; photos: ReactNode }) {
  return (
    <aside aria-label="Fotos, firmas e historial" className="flex min-w-0 flex-col gap-4">
      <SectionCard title="Fotos de respaldo" description="Toca una foto para verla a pantalla completa.">
        {photos}
      </SectionCard>

      <SectionCard title="Firmas">
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-[var(--color-border-strong)] px-4 py-3">
            <p className="text-eyebrow">Mecánico</p>
            <p className="mt-1 text-base font-semibold text-[var(--color-text)]">{detail.registeredByName}</p>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Firmado con su cuenta · <span className="font-mono tabular-nums">{formatDateTime(detail.signedAt)}</span>
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-[var(--color-border-control)] px-4 py-3">
            <p className="text-eyebrow">Jefatura · segunda etapa</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">La firma de jefatura queda para una segunda etapa, después de probar este flujo.</p>
          </div>
        </div>
      </SectionCard>

      {detail.observations.length > 0 && (
        <SectionCard title="Observaciones" description="Lo que se pidió revisar y lo que respondió el mecánico.">
          <ul className="flex flex-col gap-4">
            {detail.observations.map((observation) => (
              <li key={observation.id} className="text-sm">
                <p className="text-[var(--color-text)]">{observation.text}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {observation.userName} · <span className="font-mono tabular-nums">{formatDateTime(observation.createdAt)}</span>
                </p>
                {observation.response ? (
                  <div className="mt-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2">
                    <p className="text-[var(--color-text)]">{observation.response}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      Respondió {observation.respondedByName} · <span className="font-mono tabular-nums">{observation.respondedAt ? formatDateTime(observation.respondedAt) : ""}</span>
                    </p>
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs font-medium text-[var(--color-signal-ink)]">Aún sin respuesta del mecánico.</p>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Historial del equipo" description="Los últimos registros vigentes de este equipo que puedes ver.">
        {detail.history.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Este es el único registro del equipo.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {detail.history.map((item) => (
              <li key={item.id}>
                <Link href={`/mantencion/registros/${item.id}`} className="flex items-baseline justify-between gap-3 rounded-md px-1 py-2.5 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]">
                  <span className="min-w-0 text-sm">
                    <strong className="font-semibold">{recordKindText(item.kind, item.intervalValue, item.unit)}</strong>
                    <span className="block truncate text-[var(--color-text-muted)]">
                      <span className="font-mono tabular-nums">{formatReading(item.reading, item.unit)}</span> · {item.folio ?? "Sin folio"}
                    </span>
                  </span>
                  <time className="shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDate(item.workDate)}</time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </aside>
  )
}
