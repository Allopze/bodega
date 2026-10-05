"use client"

/**
 * TIUX-48 — la entrega de referencia en la devolución. Quien recibe el equipo
 * compara contra cómo salió: sin esto tenía que abrir la ficha en otra pestaña
 * para saber qué accesorios se llevó el trabajador y en qué estado.
 */

import Image from "next/image"
import { MetaBadge } from "@/components/states/state-badge"
import { formatDateTime } from "@/lib/utils"
import { IT_PHYSICAL_STATE_META } from "@/lib/services/ti/constants"

export interface DeliveryReference {
  deliveredAt: string
  physicalState: string
  accessories: string[]
  photos: { id: string; caption: string | null }[]
}

export function AssignmentReference({ reference }: { reference: DeliveryReference }) {
  const state = IT_PHYSICAL_STATE_META[reference.physicalState]
  return (
    <section aria-label="Entrega de referencia" className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <p className="text-eyebrow text-[var(--color-text-faint)]">Así se entregó</p>
      <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--color-text-subtle)]">Entregado el</dt>
          <dd className="text-[var(--color-text)]">{formatDateTime(reference.deliveredAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-subtle)]">Estado físico</dt>
          <dd>{state ? <MetaBadge meta={state} /> : reference.physicalState}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-[var(--color-text-subtle)]">Accesorios entregados</dt>
          <dd className="text-[var(--color-text)]">
            {reference.accessories.length > 0 ? reference.accessories.join(", ") : "Sin accesorios"}
          </dd>
        </div>
      </dl>
      {reference.photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-4 gap-2" aria-label="Fotos de la entrega">
          {reference.photos.slice(0, 8).map((photo) => (
            <li key={photo.id}>
              <a href={`/api/ti/photos/${photo.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-[var(--color-border)]">
                <Image unoptimized src={`/api/ti/photos/${photo.id}`} alt={photo.caption || "Foto de la entrega"} width={160} height={120} className="aspect-[4/3] w-full object-cover" />
                <span className="sr-only"> (se abre en una pestaña nueva)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
