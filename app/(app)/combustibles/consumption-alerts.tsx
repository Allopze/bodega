import Link from "next/link"
import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { SeverityBadge } from "@/app/(app)/analitica/analytics-ranking-table"
import type { WatchItem } from "@/lib/combustibles/consumption-watch"

/**
 * «Patentes para mirar»: las alertas de consumo (consumo alto, muchas
 * transacciones, rendimiento cero, patentes sin vincular, variación fuerte) y a
 * dónde lleva cada una. Un clic abre la ficha del equipo, que es donde se
 * decide si hay algo que hacer; las patentes que no son un equipo filtran el
 * análisis de tarjetas y las sin vincular van a «Por revisar».
 *
 * Server-safe: los destinos ya vienen armados (con el período y la faena).
 */
export function ConsumptionWatchList({ items }: { items: WatchItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Ninguna patente se sale de lo habitual con estos filtros.</p>
  }
  return (
    <ul aria-label="Patentes para mirar" className="grid gap-2 md:grid-cols-2">
      {items.map((item) => {
        const body = (
          <>
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--color-text)]">{item.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-muted)]">{item.reason}</span>
              </span>
              <SeverityBadge severity={item.severity} />
            </span>
            <span className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-[var(--color-text)]">{item.action}</span>
              {item.href && item.hrefLabel ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-[var(--color-primary-ink)]">
                  {item.hrefLabel}
                  <CaretRight size={12} weight="bold" aria-hidden />
                </span>
              ) : null}
            </span>
          </>
        )
        const rowClass = "block h-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className={`${rowClass} transition-colors hover:border-[var(--color-border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]`}>
                {body}
              </Link>
            ) : (
              <div className={rowClass}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
