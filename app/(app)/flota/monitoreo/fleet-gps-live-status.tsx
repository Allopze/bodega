"use client"

import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr"
import type { OnwayLiveStatus } from "./use-onway-live-refresh"

const MESSAGE: Record<OnwayLiveStatus["kind"], string> = {
  ok: "",
  failed: "OnWay no respondió en la última actualización; se reintenta en un minuto.",
  disabled: "La sincronización con OnWay está desactivada: se muestra la última lectura.",
}

/**
 * Estado del refresco en vivo de Monitoreo GPS. La hora de la última lectura
 * no se repite aquí: ya está en «Última consulta» del resumen (A5). Si OnWay
 * está atrasado no se promete una actualización cada minuto (F6).
 */
export function FleetGpsLiveStatus({ refreshing, status, stale = false }: { refreshing: boolean; status: OnwayLiveStatus; stale?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-0.5 text-xs sm:items-end">
      {/* Con la fuente atrasada «cada minuto» sería falso: los datos tienen días y eso lo dice «Estado de las fuentes». */}
      {status.kind !== "disabled" && !stale ? (
        <p className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
          <ArrowClockwise size={14} aria-hidden className={refreshing ? "motion-safe:animate-spin" : undefined} />
          Actualización automática cada minuto
        </p>
      ) : null}
      {/* Región permanente: un `role="status"` que aparece recién con el texto no siempre se anuncia. */}
      <p
        role="status"
        title={status.kind === "failed" ? status.code : undefined}
        className={status.kind === "failed" ? "text-[var(--color-warning-ink)]" : "text-[var(--color-text-muted)]"}
      >
        {MESSAGE[status.kind]}
      </p>
    </div>
  )
}
