import * as React from "react"
import { CaretDown } from "@phosphor-icons/react/dist/ssr"
import { StateBadge, OC_STATE_META, type OcStatus } from "./state-badge"

/** Estados de recepción que aparecen en la bandeja, en orden de flujo. */
const RECEPTION_STATES: OcStatus[] = [
  "sent",
  "partially_office_received",
  "office_received",
  "partially_received",
  "received",
]

/**
 * Leyenda desplegable de los estados de recepción — explica la jerga
 * (En oficina / Oficina parcial / Rec. parcial…) sin obligar a memorizarla.
 * Usa <details> nativo: sin JS ni estado de cliente.
 */
export function StateLegend() {
  return (
    <details className="group rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] select-none">
        <CaretDown size={13} className="transition-transform group-open:rotate-180" />
        ¿Qué significa cada estado?
      </summary>
      <ul className="space-y-2 border-t border-[var(--color-border)] px-4 py-3">
        {RECEPTION_STATES.map((state) => (
          <li key={state} className="flex items-start gap-3">
            <span className="shrink-0">
              <StateBadge state={state} entity="oc" size="sm" />
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">
              {OC_STATE_META[state].description}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
