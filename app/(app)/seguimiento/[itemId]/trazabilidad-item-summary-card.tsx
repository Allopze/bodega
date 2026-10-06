import { formatQty, formatDate } from "@/lib/utils"
import { quantitySummary } from "./trazabilidad-item-page.helpers"
import { StateBadge } from "@/components/states/state-badge"
import type { ItemDetailData } from "@/lib/services/trazabilidad-item"

interface SummaryCardProps {
  item: ItemDetailData["item"]
  totalOrdered: number
  totalReceivedAtFaena: number
  totalDelivered: number
  totalReturned: number
}

export function ItemSummaryCard({
  item,
  totalOrdered,
  totalReceivedAtFaena,
  totalDelivered,
  totalReturned,
}: SummaryCardProps) {
  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-6">
      <h2 className="text-h2 text-[var(--color-text)] mb-4">Resumen del ítem</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-[var(--color-text-subtle)] text-xs">Solicitado por</dt>
          <dd className="text-[var(--color-text)] mt-0.5">{item.requesterName}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)] text-xs">Faena</dt>
          <dd className="text-[var(--color-text)] mt-0.5">{item.worksiteName}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)] text-xs">Estado</dt>
          <dd className="mt-0.5"><StateBadge state={item.status} entity="item" size="sm" /></dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)] text-xs">Cantidad solicitada</dt>
          <dd className="font-mono tabular-nums text-[var(--color-text)] mt-0.5">{formatQty(item.quantity, item.unitOfMeasure)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)] text-xs">En OC</dt>
          <dd className="font-mono tabular-nums text-[var(--color-text)] mt-0.5">{formatQty(totalOrdered, item.unitOfMeasure)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)] text-xs">Recibido en faena</dt>
          <dd className="mt-0.5">{quantitySummary(totalReceivedAtFaena, item.quantity, item.unitOfMeasure)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)] text-xs">Entregado a trabajadores</dt>
          <dd className="font-mono tabular-nums text-[var(--color-text)] mt-0.5">
            {formatQty(totalDelivered, item.unitOfMeasure)}
            {totalReturned > 0 && (
              <span className="ml-1 text-xs text-[var(--color-text-subtle)]">
                (devueltos {formatQty(totalReturned, item.unitOfMeasure)})
              </span>
            )}
          </dd>
        </div>
        {item.urgency && (
          <div>
            <dt className="text-[var(--color-text-subtle)] text-xs">Urgencia</dt>
            <dd className="text-[var(--color-text)] mt-0.5 capitalize">{item.urgency}</dd>
          </div>
        )}
        {item.requiredDate && (
          <div>
            <dt className="text-[var(--color-text-subtle)] text-xs">Fecha requerida</dt>
            <dd className="text-[var(--color-text)] mt-0.5">{formatDate(item.requiredDate)}</dd>
          </div>
        )}
      </dl>
      {item.attributes.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-subtle)] mb-2">Atributos</p>
          <div className="flex flex-wrap gap-2">
            {item.attributes.map((attr) => (
              <span
                key={attr.name}
                className="inline-flex items-center gap-1 rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-xs"
              >
                <span className="text-[var(--color-text-subtle)]">{attr.name}:</span>
                <span className="font-medium text-[var(--color-text)]">{attr.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {item.notes && (
        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-subtle)] mb-1">Notas</p>
          <p className="text-sm text-[var(--color-text)]">{item.notes}</p>
        </div>
      )}
    </section>
  )
}
