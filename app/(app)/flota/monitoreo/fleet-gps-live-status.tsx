"use client"

import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr"
import type { GpsLiveStatus, GpsLiveStatusByProvider } from "./use-gps-live-refresh"

/** Un aviso por proveedor con algo que decir; «ok» y «módulo apagado» no dicen nada. */
function messageFor(provider: "OnWay" | "Wialon", status: GpsLiveStatus): string | null {
  if (status.kind === "failed") {
    return `${provider} no respondió en la última actualización; se reintenta automáticamente.`
  }
  // Sin token no hay nada que avisar (hay cuentas sin Wialon); con token y el
  // interruptor apagado, sí: lo que se ve es la última lectura.
  if (status.kind === "disabled" && status.reason === "sync_disabled") {
    return `La actualización automática de ${provider} está desactivada: se muestra la última lectura.`
  }
  if (status.kind === "disabled" && status.reason === "credentials" && provider === "OnWay") {
    return "La sincronización con OnWay está desactivada: se muestra la última lectura."
  }
  return null
}

/**
 * Estado del refresco en vivo de Monitoreo GPS. La hora de la última lectura
 * no se repite aquí: ya está en «Última consulta» del resumen (A5). Si OnWay
 * está atrasado no se promete su actualización en vivo (F6).
 */
export function FleetGpsLiveStatus({ refreshing, status, stale = false }: { refreshing: boolean; status: GpsLiveStatusByProvider; stale?: boolean }) {
  const messages = [messageFor("OnWay", status.onway), messageFor("Wialon", status.wialon)]
    .filter((message): message is string => message !== null)
  // Con OnWay atrasado su refresco sería una promesa falsa (los datos tienen
  // días y eso lo dice «Estado de las fuentes»); Wialon sí sigue en vivo.
  const anyActive = (status.onway.kind !== "disabled" && !stale) || status.wialon.kind !== "disabled"
  const failed = status.onway.kind === "failed" || status.wialon.kind === "failed"
  const failedCodes = [status.onway, status.wialon]
    .flatMap((entry) => entry.kind === "failed" ? [entry.code] : [])
    .join(", ")
  return (
    <div className="flex flex-col items-start gap-0.5 text-xs sm:items-end">
      {anyActive ? (
        <p className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
          <ArrowClockwise size={14} aria-hidden className={refreshing ? "motion-safe:animate-spin" : undefined} />
          Actualización automática en vivo
        </p>
      ) : null}
      {/* Región permanente: un `role="status"` que aparece recién con el texto no siempre se anuncia. */}
      <p
        role="status"
        title={failed ? failedCodes : undefined}
        className={failed ? "text-[var(--color-warning-ink)]" : "text-[var(--color-text-muted)]"}
      >
        {messages.join(" ")}
      </p>
    </div>
  )
}
