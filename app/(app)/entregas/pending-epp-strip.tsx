import Link from "next/link"
import { Button } from "@/components/ui/button"
import { formatQty } from "@/lib/utils"
import type { DeliverableEppOption } from "./delivery-form.types"

export type PendingEppRow = DeliverableEppOption & { worksiteName: string }

/** Cuántas filas se pintan antes de plegar el resto: la lista no debe empujar el historial fuera de pantalla. */
const VISIBLE_ROWS = 5

/**
 * EPP ya recibido en faena que espera entrega a un trabajador. Era la mitad
 * del trabajo de Entregas que la pantalla calculaba y no mostraba: el
 * bodeguero tenía que adivinar qué entregar. Oculto cuando no hay nada
 * pendiente (no ocupa lugar para decir "0").
 *
 * "Entregar" abre el formulario ya cargado con la faena, el producto y el
 * saldo; sólo falta elegir al trabajador.
 */
export function PendingEppStrip({ items, canCreate }: { items: PendingEppRow[]; canCreate: boolean }) {
  if (items.length === 0) return null
  const visible = items.slice(0, VISIBLE_ROWS)
  const hidden = items.slice(VISIBLE_ROWS)

  const renderRow = (item: PendingEppRow) => (
    <li key={item.requestItemId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm font-medium text-[var(--color-text)]">{item.productName}</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {item.worksiteName} · Solicitud <span className="font-mono">{item.requestCode}</span>
        </p>
      </div>
      <p className="text-sm tabular-nums text-[var(--color-text)]">
        <span className="font-semibold">{formatQty(item.remainingQuantity, item.unitOfMeasure)}</span>
        <span className="text-[var(--color-text-muted)]"> por entregar</span>
      </p>
      {canCreate && (
        <Button asChild variant="secondary" size="sm" className="max-sm:min-h-11">
          <Link
            href={`/entregas?${new URLSearchParams({ faena: item.worksiteId, item: item.requestItemId, nueva: "1" }).toString()}`}
            scroll={false}
            aria-label={`Entregar ${item.productName} (${item.requestCode})`}
          >
            Entregar
          </Link>
        </Button>
      )}
    </li>
  )

  return (
    <section aria-labelledby="pending-epp-title" className="flex flex-col gap-3">
      <div>
        <h2 id="pending-epp-title" className="text-base font-semibold text-[var(--color-text)]">
          EPP por entregar <span className="font-normal text-[var(--color-text-muted)]">({items.length})</span>
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Recibido en faena, con stock en bodega y saldo pendiente de entrega a trabajadores.
        </p>
      </div>
      <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <ul className="divide-y divide-[var(--color-border)]">{visible.map(renderRow)}</ul>
        {hidden.length > 0 && (
          <details className="border-t border-[var(--color-border)]">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-[var(--color-primary)]">
              Ver {hidden.length} más
            </summary>
            <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">{hidden.map(renderRow)}</ul>
          </details>
        )}
      </div>
    </section>
  )
}
