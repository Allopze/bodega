/**
 * Historial de envíos de una ejecución PDTP (PREV-I04).
 *
 * Lee la bitácora que escriben submit, reenvío, aprobación, rechazo y
 * reversión (`listPdtpExecutionHistory`, D10 = audit_log). Es lo que permite
 * reconstruir qué evidencia se presentó en cada intento, quién la rechazó y
 * por qué: la fila de la ejecución sólo guarda el intento vigente.
 */
import { MetaBadge } from "@/components/states/state-badge"
import type { PdtpExecutionHistoryEntry } from "@/lib/services/pdtp/execution-history"
import { formatDateTime } from "@/lib/utils"
import { PdtpEvidenceThumbs } from "../../../pdtp-evidence-thumbs"

const CHANGE_META: Record<string, { label: string; variant: "neutral" | "warning" | "success" | "danger" | "info" }> = {
  submitted: { label: "Enviado", variant: "warning" },
  resubmitted: { label: "Reenviado", variant: "warning" },
  approved: { label: "Aprobado", variant: "success" },
  rejected: { label: "Rechazado", variant: "danger" },
  revoked: { label: "Revertido", variant: "neutral" },
}

export function SubmissionHistory({ entries }: { entries: PdtpExecutionHistoryEntry[] }) {
  return (
    <section aria-labelledby="historial-envios-titulo" className="space-y-3">
      <h2 id="historial-envios-titulo" className="text-sm font-semibold text-(--color-text)">Historial de envíos</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">
          Esta ejecución no tiene envíos registrados en el historial. Los envíos anteriores a la bitácora de
          septiembre de 2026 solo conservan su estado actual.
        </p>
      ) : (
        <ol aria-label="Historial de envíos" className="space-y-3">
          {entries.map((entry) => {
            const meta = CHANGE_META[entry.changeType] ?? { label: entry.changeType, variant: "neutral" as const }
            const [main, ...previous] = entry.files
            return (
              <li key={entry.id} className="rounded-(--radius) border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <MetaBadge meta={meta} />
                  <span className="text-(--color-text)">{entry.actorName ?? (entry.actorUserId ? "Usuario no disponible" : "Sistema (integración)")}</span>
                  <span className="text-(--color-text-muted)">· {formatDateTime(entry.at)}</span>
                  {entry.attempt !== null && <span className="text-(--color-text-muted)">· Intento {entry.attempt}</span>}
                  {entry.executedQuantity !== null && (entry.changeType === "submitted" || entry.changeType === "resubmitted") && (
                    <span className="text-(--color-text-muted)">· Cantidad {entry.executedQuantity}</span>
                  )}
                </div>
                {entry.reason && (
                  <p className="mt-1 text-(--color-text-muted)">
                    <span className="font-medium text-(--color-text)">Motivo:</span> {entry.reason}
                  </p>
                )}
                {(entry.changeType === "submitted" || entry.changeType === "resubmitted") && main && (
                  <div className="mt-2">
                    <PdtpEvidenceThumbs
                      evidenceUrl={main}
                      evidencePhotos={previous}
                      evidenceText={entry.evidenceText}
                      max={10}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
