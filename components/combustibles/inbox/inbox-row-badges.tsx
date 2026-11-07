import { MetaBadge } from "@/components/states/state-badge"
import {
  ANOMALY_SEVERITY_LABELS,
  ANOMALY_STATUS_LABELS,
  anomalySeverityVariant,
  type AnomalyCaseStatus,
  type AnomalySeverity,
} from "@/lib/combustibles/anomaly-labels"
import type { FuelInboxDecided, FuelInboxKind } from "@/lib/combustibles/inbox/types"
import { cn } from "@/lib/utils"

/** El desenlace en rojo: lo que NO cuenta o se descartó. El resto de lo decidido (Cuenta, Resuelto, Vinculada, Revisado) va en verde. */
function decidedVariant(outcome: string): "danger" | "success" {
  return outcome === "No cuenta" || outcome === "Descartado" ? "danger" : "success"
}

/**
 * Las insignias de una fila de la bandeja, en la lista y en la cabecera de la hoja
 * de decisión: qué es (la etiqueta principal, la que la pantalla elija), cuán grave,
 * en qué quedó o en qué estado está. El punto «Nuevo» de la lista va delante.
 *
 * Una sola de las dos últimas: un caso cerrado ya dice «Resuelto» o «Descartado» en su
 * desenlace, así que su estado no se repite al lado. Sin hooks: sirve igual en el
 * servidor y en el cliente.
 */
export function InboxRowBadges({
  label,
  kind,
  severity,
  caseStatus,
  decided,
  fresh = false,
  className,
}: {
  /** La etiqueta principal: «Lectura menor a la anterior», «Sello repetido»… */
  label: string
  kind: FuelInboxKind
  severity?: AnomalySeverity | null
  /** Estado del caso (sólo para `kind="caso"`); se muestra mientras nadie lo haya decidido. */
  caseStatus?: AnomalyCaseStatus | null
  decided?: Pick<FuelInboxDecided, "outcome"> | null
  /** Llegó después de la última visita y no se abrió: lleva el punto «Nuevo». */
  fresh?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {fresh ? <span className="inline-block size-2 rounded-full bg-[var(--color-accent)]" role="img" aria-label="Nuevo" /> : null}
      <MetaBadge
        meta={{ label, variant: kind === "caso" ? "danger" : kind === "patente" ? "info" : "signal" }}
        size="sm"
        // La etiqueta principal puede ser una frase («Lectura menor a la anterior»):
        // sólo ella puede partirse en dos líneas en vez de cortarse.
        className="whitespace-normal"
      />
      {severity ? <MetaBadge meta={{ label: ANOMALY_SEVERITY_LABELS[severity], variant: anomalySeverityVariant(severity) }} size="sm" /> : null}
      {caseStatus && !decided ? <MetaBadge meta={{ label: ANOMALY_STATUS_LABELS[caseStatus], variant: "outline" }} size="sm" /> : null}
      {decided ? <MetaBadge meta={{ label: decided.outcome, variant: decidedVariant(decided.outcome) }} size="sm" /> : null}
    </div>
  )
}
