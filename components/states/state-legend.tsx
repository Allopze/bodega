import * as React from "react"
import { CaretDown } from "@phosphor-icons/react/dist/ssr"
import { StateBadge, describeState, OC_STATE_META, type OcStatus } from "./state-badge"

/** Estados de recepción que aparecen en la bandeja, en orden de flujo. */
const RECEPTION_STATES: OcStatus[] = [
  "sent",
  "partially_office_received",
  "office_received",
  "partially_received",
  "received",
]

/**
 * Leyenda desplegable de los estados de recepción — explica las tres etapas
 * (pendiente / oficina / faena) y sus parciales sin obligar a memorizarlas.
 * Usa <details> nativo: sin JS ni estado de cliente.
 */
export function StateLegend({ officeName }: { officeName?: string }) {
  return (
    <details className="group rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] select-none">
        <CaretDown size={13} className="transition-transform group-open:rotate-180" />
        ¿Qué significa cada estado?
      </summary>
      <ul className="space-y-2 border-t border-[var(--color-border)] px-4 py-3">
        {RECEPTION_STATES.map((state) => (
          // `flex-wrap` + `basis-48`: el badge más largo ("Parcialmente
          // recibido en…") ocupa casi todo el ancho a 320 px y la descripción
          // quedaba en una columna de una palabra que se salía del pozo. Bajo
          // ese ancho la descripción pasa debajo del badge.
          <li key={state} className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <span className="shrink-0">
              <StateBadge state={state} entity="oc" size="sm" officeName={officeName} />
            </span>
            <span className="min-w-0 flex-1 basis-48 text-xs text-[var(--color-text-muted)]">
              {describeState(OC_STATE_META[state].description, officeName)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
