import { MetaBadge } from "@/components/states/state-badge"
import { RE20_QUALITY_CRITERIA, RE20_QUALITY_RESULTS } from "@/lib/prevention/incidents"
import { formatDateTime } from "@/lib/utils"
import { Re20Block } from "../../fields"
import type { Re20QualityReview } from "../../types"
import { DECISION_LABELS, QUALITY_ID, reviewerRoleLabel } from "./rules"

const DECISION_VARIANT = { approved: "success", approved_with_observations: "warning", changes_required: "danger" } as const
const RESULT_LABEL: Record<string, string> = Object.fromEntries(RE20_QUALITY_RESULTS.map((result) => [result.id, result.label]))

/** Revisiones anteriores, la más reciente primero: fecha, rol, decisión, observación y criterios con nota. */
export function QualityReviewHistory({ reviews }: { reviews: Re20QualityReview[] }) {
  const sorted = [...reviews].sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))
  return (
    <Re20Block
      id={QUALITY_ID("block-history")}
      title="Revisiones anteriores"
      summary={sorted.length === 0 ? "Aún no hay revisiones" : `${sorted.length} ${sorted.length === 1 ? "revisión" : "revisiones"} · la última ${DECISION_LABELS[sorted[0]?.decision ?? ""]?.toLowerCase() ?? ""}`}
      defaultOpen={sorted.length > 0}
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Cuando alguien registre una revisión aparecerá aquí con su decisión y sus observaciones.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {sorted.map((review) => {
            const counts = RE20_QUALITY_RESULTS.map((result) => ({ label: result.label, n: review.criteria.filter((item) => item.result === result.id).length })).filter((item) => item.n > 0)
            const notes = review.criteria.filter((item) => item.observation?.trim())
            return (
              <li key={review.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <MetaBadge meta={{ label: DECISION_LABELS[review.decision] ?? "Decisión anterior", variant: DECISION_VARIANT[review.decision as keyof typeof DECISION_VARIANT] ?? "neutral" }} />
                  <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDateTime(review.reviewedAt)}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{review.reviewerName ? `${review.reviewerName} · ` : ""}{reviewerRoleLabel(review.reviewerRole)}</span>
                </div>
                <p className="text-xs text-[var(--color-text-subtle)]">{counts.map((item) => `${item.n} ${item.label.toLowerCase()}`).join(" · ")} · sobre la versión {review.workspaceVersion} del expediente</p>
                {review.observation && <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{review.observation}</p>}
                {notes.length > 0 && (
                  <details className="text-sm">
                    <summary className="min-h-11 cursor-pointer py-2.5 text-[var(--color-primary-ink)] underline underline-offset-2">
                      Notas por criterio ({notes.length})
                    </summary>
                    <ul className="space-y-2 pb-1">
                      {notes.map((item) => {
                        const criterion = RE20_QUALITY_CRITERIA.find((entry) => entry.id === item.id)
                        return (
                          <li key={item.id}>
                            <p className="font-medium text-[var(--color-text)]">{criterion?.criterion ?? "Criterio"} · {RESULT_LABEL[item.result] ?? ""}</p>
                            <p className="whitespace-pre-wrap text-[var(--color-text-muted)]">{item.observation}</p>
                          </li>
                        )
                      })}
                    </ul>
                  </details>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Re20Block>
  )
}
