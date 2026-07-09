import { CheckCircle, UserCircle } from "@phosphor-icons/react/dist/ssr"
import { formatDate } from "@/lib/utils"
import {
  decisionTypeLabel,
  personLabel,
  roleContextLabel,
  summarizeRequestPeople,
  type RequestDecisionSummary,
} from "./request-people-panel.helpers"

interface RequestPeoplePanelProps {
  requesterName: string | null | undefined
  requesterEmail: string | null | undefined
  createdAt: string
  submittedAt: string | null
  decisions: RequestDecisionSummary[]
}

export function RequestPeoplePanel({
  requesterName,
  requesterEmail,
  createdAt,
  submittedAt,
  decisions,
}: RequestPeoplePanelProps) {
  const summary = summarizeRequestPeople({ requesterName, requesterEmail, decisions })

  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="grid gap-3 border-b border-[var(--color-border)] px-4 py-3 md:grid-cols-2">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
            <UserCircle size={17} weight="bold" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">Solicita</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{summary.requester}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Creada {formatDate(createdAt)}
              {submittedAt ? ` · Enviada ${formatDate(submittedAt)}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-success-tint)] text-[var(--color-success)]">
            <CheckCircle size={17} weight="bold" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">Última decisión</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">
              {summary.latestDecisionLabel} · {summary.latestDecisionBy}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {decisions.length > 0 ? `${decisions.length} decisión(es) registradas` : "Todavía no hay aprobaciones, rechazos ni devoluciones."}
            </p>
          </div>
        </div>
      </div>

      {decisions.length > 0 && (
        <div className="divide-y divide-[var(--color-border)]">
          {decisions.map((decision) => (
            <div key={decision.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <div className="min-w-0">
                <p className="font-medium text-[var(--color-text)]">
                  {decisionTypeLabel(decision.type)} {decision.itemName}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {personLabel(decision.decidedByName, decision.decidedByEmail)} · {roleContextLabel(decision.roleContext)}
                  {decision.modifiedQty != null ? ` · Cantidad: ${decision.modifiedQty}` : ""}
                </p>
                {decision.reason && (
                  <p className="mt-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-text-muted)]">
                    {decision.reason}
                  </p>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-subtle)] md:text-right">{formatDate(decision.decidedAt)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
