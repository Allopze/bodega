import Link from "next/link"
import { formatLeadDays } from "@/components/charts/stage-duration-bar"
import type { SlowLeadTimeItem } from "@/lib/services/analytics-module/lead-time-shape"

/**
 * Qué enlaces puede seguir el usuario desde la lista. La solicitud y el expediente del ítem tienen su
 * propio permiso y su propio alcance: un enlace que el destino rechazaría es peor que no ofrecerlo, así
 * que sin el permiso el código y el producto se muestran como texto.
 */
export interface LeadTimeItemLinks {
  /** Puede abrir `/solicitudes/[id]`. */
  requests: boolean
  /** Puede abrir `/seguimiento/[itemId]` (`warehouse:view_traceability`). */
  tracking: boolean
}

export const NO_LEAD_TIME_LINKS: LeadTimeItemLinks = { requests: false, tracking: false }

const linkClass = "font-medium text-[var(--color-primary-ink)] hover:underline"

/**
 * CHART-029 · la fila individual detrás de las medianas: los ítems cerrados del período que más
 * tardaron, con los días de cada tramo. Las medianas dicen en qué tramo se demora el proceso; esta
 * lista dice **cuáles** ítems se atascaron y lleva a su solicitud para reclamar.
 *
 * Es un desplegable nativo (`<details>`, sin JS) al mismo nivel que «Ver datos», porque es el nivel
 * «registros» del drill-down y no debe empujar el gráfico bajo el pliegue.
 */
export function LeadTimeSlowestItems({ items, links = NO_LEAD_TIME_LINKS }: { items: readonly SlowLeadTimeItem[]; links?: LeadTimeItemLinks }) {
  if (items.length === 0) return null
  const stageHeaders = items[0]!.stages.map((stage) => stage.label)

  return (
    <details className="mt-3 text-xs">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8">
        Ítems más lentos ({items.length})
      </summary>
      <p className="mt-1 text-[var(--color-text-muted)] text-pretty">
        Los ítems cerrados en el período con el plazo total más largo, de la solicitud al cierre. Un tramo en «—» no se pudo medir (falta una fecha o están fuera de orden).
      </p>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-left text-[var(--color-text-muted)]">
          <caption className="sr-only">Ítems cerrados que más tardaron en el período, con los días de cada tramo</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 pr-3 font-semibold text-[var(--color-text)]">Solicitud</th>
              <th scope="col" className="py-1 pr-3 font-semibold text-[var(--color-text)]">Ítem</th>
              <th scope="col" className="py-1 pr-3 font-semibold text-[var(--color-text)]">Faena</th>
              {stageHeaders.map((header) => (
                <th key={header} scope="col" className="py-1 pr-3 text-right font-semibold text-[var(--color-text)]">{header}</th>
              ))}
              <th scope="col" className="py-1 text-right font-semibold text-[var(--color-text)]">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.itemId} className="border-t border-[var(--color-border)]">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {links.requests
                    ? <Link href={`/solicitudes/${item.requestId}`} className={linkClass}>{item.requestCode}</Link>
                    : <span className="font-medium text-[var(--color-text)]">{item.requestCode}</span>}
                </th>
                <td className="max-w-56 truncate py-1 pr-3" title={item.productName}>
                  {links.tracking
                    ? <Link href={`/seguimiento/${item.itemId}`} className={linkClass}>{item.productName}</Link>
                    : item.productName}
                </td>
                <td className="py-1 pr-3">{item.worksiteName}</td>
                {item.stages.map((stage) => (
                  <td key={stage.key} className="py-1 pr-3 text-right tabular-nums">{stage.days === null ? "—" : formatLeadDays(stage.days)}</td>
                ))}
                <td className="py-1 text-right font-semibold tabular-nums text-[var(--color-text)]">{formatLeadDays(item.totalDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
