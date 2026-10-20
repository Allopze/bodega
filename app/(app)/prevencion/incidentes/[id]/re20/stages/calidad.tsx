"use client"

import { CheckCircle, ShieldCheck, UsersThree } from "@phosphor-icons/react"
import { Callout } from "@/components/ui/callout"
import { RE20_QUALITY_CRITERIA } from "@/lib/prevention/incidents"
import { formatDateTime } from "@/lib/utils"
import type { Re20StageModule, Re20StageProgress, Re20StageProps } from "../stages"
import type { Re20WorkspaceApi } from "../use-re20-workspace"
import { QualityReviewForm } from "./calidad/review-form"
import { QualityReviewHistory } from "./calidad/review-history"
import {
  DECISION_LABELS,
  QUALITY_DRAFT_KEY,
  evaluatedCount,
  isApprovingDecision,
  qualityBlockers,
  readQualityDraft,
  reviewerRoleLabel,
} from "./calidad/rules"

/* Etapa 5 — Revisión de calidad (RE-20-13, hoja REVISIÓN DE CALIDAD).
 * Una persona distinta del equipo y de quien editó por última vez evalúa los 13
 * criterios y decide. Sin permiso o siendo del equipo, ve quién puede hacerlo. */

function latestReview(ws: Pick<Re20WorkspaceApi, "qualityReviews">) {
  return [...ws.qualityReviews].sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))[0] ?? null
}

function progress(ws: Re20WorkspaceApi): Re20StageProgress {
  const latest = latestReview(ws)
  if (latest && isApprovingDecision(latest.decision)) return { done: 1, total: 1, missing: [] }
  // Quien no puede revisar no ve el formulario: listarle los 13 criterios como
  // «Falta…» lo mandaba a campos que no existen en su pantalla.
  const inTeam = ws.data.team.some((member) => member.userId === ws.currentUser.id)
  if (!ws.permissions.canReview || inTeam || ws.incident.status === "closed") return { done: 0, total: 1, missing: [] }
  const draft = readQualityDraft(ws.extras[QUALITY_DRAFT_KEY])
  const blockers = qualityBlockers(draft)
  const total = RE20_QUALITY_CRITERIA.length + 2
  const incoherent = blockers.filter((item) => item.fieldId === "re20-calidad-decision" && draft.decision !== null)
  const pendingBase = blockers.filter((item) => !incoherent.includes(item))
  return {
    done: Math.max(0, total - pendingBase.length),
    total,
    missing: blockers.map(({ label, fieldId }) => ({ label, fieldId })),
  }
}

function CalidadStage({ ws }: Re20StageProps) {
  const team = ws.data.team.filter((member) => member.userId)
  const teamIds = new Set(team.map((member) => member.userId))
  const inTeam = teamIds.has(ws.currentUser.id)
  const closed = ws.incident.status === "closed"
  const canReview = ws.permissions.canReview && !closed
  const nameOf = (userId: string) => ws.people.find((person) => person.id === userId)?.name ?? "Integrante sin acceso a esta faena"
  const latest = latestReview(ws)
  const approved = latest !== null && isApprovingDecision(latest.decision)
  const editedByMe = Boolean(ws.remoteUpdatedByName) && ws.remoteUpdatedByName === ws.currentUser.name
  const reviewerBlocked = !canReview || inTeam
  const definitiveDone = ws.task("definitive_report").status === "completed"
  const draft = readQualityDraft(ws.extras[QUALITY_DRAFT_KEY])

  return (
    <div className="space-y-3">
      <Callout tone="info" icon={<ShieldCheck aria-hidden className="size-4" weight="fill" />} title="Quién puede revisar">
        <p>Revisa una persona distinta del equipo investigador y de quien editó por última vez. Así la revisión es independiente de quien escribió el informe.</p>
      </Callout>

      {approved && latest && (
        <Callout tone="success" icon={<CheckCircle aria-hidden className="size-4" weight="fill" />} title={`Revisión ${DECISION_LABELS[latest.decision]?.toLowerCase()}`}>
          <p>
            Registrada el <span className="font-mono tabular-nums">{formatDateTime(latest.reviewedAt)}</span> por {latest.reviewerName ? `${latest.reviewerName} (${reviewerRoleLabel(latest.reviewerRole)})` : reviewerRoleLabel(latest.reviewerRole)}.
            Desde ahí corren las 24 h de la difusión.
          </p>
        </Callout>
      )}

      {!approved && !definitiveDone && (
        <Callout tone="warning" title="El informe definitivo todavía no está cerrado">
          <p>La revisión se hace sobre un informe terminado. Si la registras ahora, quedará ligada a la versión {ws.version} del expediente.</p>
        </Callout>
      )}

      {!approved && reviewerBlocked && (
        <section aria-labelledby="re20-calidad-blocked" className="space-y-2 border-y border-[var(--color-border)] py-4">
          <h3 id="re20-calidad-blocked" className="flex items-center gap-2 font-medium text-[var(--color-text)]">
            <UsersThree aria-hidden className="size-4 text-[var(--color-text-subtle)]" />
            {closed ? "El caso está cerrado" : inTeam ? "Integras el equipo investigador: no puedes revisar este informe" : "No tienes el permiso para revisar la calidad"}
          </h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            {closed
              ? "Un caso cerrado ya no admite nuevas revisiones."
              : "Pídele la revisión a la Jefa del Dpto. de Prevención de Riesgos o a otra persona con permiso de revisión de calidad que no esté en el equipo."}
          </p>
          {team.length > 0 && (
            <div className="text-sm">
              <p className="text-[var(--color-text-subtle)]">No pueden revisarla, por integrar el equipo:</p>
              <ul className="mt-1 list-inside list-disc text-[var(--color-text)]">
                {team.map((member) => <li key={member.userId}>{nameOf(member.userId)}{member.role ? ` · ${member.role}` : ""}</li>)}
              </ul>
            </div>
          )}
          {ws.remoteUpdatedByName && <p className="text-sm text-[var(--color-text-subtle)]">Tampoco puede revisarla quien guardó por última vez: {ws.remoteUpdatedByName}.</p>}
        </section>
      )}

      {!reviewerBlocked && !approved && (
        <>
          {editedByMe && (
            <Callout tone="warning" title="Fuiste quien guardó el expediente por última vez">
              <p>El sistema rechazará tu revisión mientras seas el autor de la última versión. Si otra persona no ha editado desde entonces, pídele que la haga.</p>
            </Callout>
          )}
          {draft.decision === null && evaluatedCount(draft) === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">Evalúa cada criterio, elige la decisión y registra. Tu avance se conserva en esta pantalla hasta que registres.</p>
          )}
          <QualityReviewForm ws={ws} />
        </>
      )}

      <QualityReviewHistory reviews={ws.qualityReviews} />
    </div>
  )
}

export const calidadStage: Re20StageModule = { Component: CalidadStage, progress }
