"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { runStatusBadgeVariant } from "@/lib/prevention/inspections"
import {
  formatComplianceBasisPoints,
  formatInspectionSubject,
} from "@/lib/prevention/inspection-answer-format"
import { inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import { formatDate, formatDateTime } from "@/lib/utils"
import { buildRunFacts, FactLabel, type RunFactId, type RunFactsModel } from "./run-facts"
import { progressText } from "./run-progress"
import type { RunViewModel } from "./run-view-types"
import type { CancellationInfo } from "./types"

export type RunReadSummaryModel = RunFactsModel & Pick<RunViewModel, "findings" | "closingAct" | "reviewerName" | "cancellation">

/** Lo que el resumen ya dice (o tiene su propio lugar) y no se repite entre «Ver más datos». */
const SHOWN_ELSEWHERE: ReadonlySet<RunFactId> = new Set([
  "status", "worksite", "subject", "assignee", "executed", "officialResult", "normalizedResult", "location",
])

/** Una vez declarada ejecutada hay cumplimiento, conteos y hallazgos que resumir. */
function isClosed(status: string) {
  return status === "completed" || status === "reviewed"
}

/** «Cumple 5 · Regular 1 · No cumple 2 · No aplica 3»: sólo lo que no es cero. */
export function itemCountsText(run: Pick<RunViewModel["run"], "conformingCount" | "partialCount" | "nonConformingCount" | "notApplicableCount">): string {
  const parts: string[] = []
  if (run.conformingCount > 0) parts.push(`Cumple ${run.conformingCount}`)
  if (run.partialCount > 0) parts.push(`Regular ${run.partialCount}`)
  if (run.nonConformingCount > 0) parts.push(`No cumple ${run.nonConformingCount}`)
  if (run.notApplicableCount > 0) parts.push(`No aplica ${run.notApplicableCount}`)
  return parts.join(" · ")
}

/** «1 abierto de 3» / «3 cerrados» / «Sin hallazgos». */
export function findingsSummaryText(findings: readonly { status: string }[]): string {
  if (findings.length === 0) return "Sin hallazgos"
  const open = findings.filter((finding) => finding.status === "open").length
  if (open === 0) return `${findings.length} ${findings.length === 1 ? "cerrado o con CAPA" : "cerrados o con CAPA"}`
  return `${open} ${open === 1 ? "abierto" : "abiertos"} de ${findings.length}`
}

/** «Cancelada por Ana Soto el 20-10-2026: Se duplicó la inspección.» */
export function cancellationText(cancellation: CancellationInfo): string {
  const reason = cancellation.reason?.trim()
  return `Cancelada por ${cancellation.byName ?? "—"} el ${formatDate(cancellation.at)}${reason ? `: ${reason}` : "."}`
}

/* 44 px de alto en el teléfono con padding y margen negativo: el objetivo crece sin mover el texto. */
const GROUP_LINK_CLASS = "-my-3.5 block rounded-[var(--radius-sm)] py-3.5 underline underline-offset-2 md:-my-1.5 md:py-1.5"

/**
 * La cabecera del modo lectura y revisión: UNA tarjeta en todos los anchos. Lo
 * primero es dónde y de quién (faena · sujeto · responsable), el estado una sola
 * vez y, con el permiso, «Revisar y cerrar»; después lo que quien lee o revisa
 * necesita saber antes de bajar —el resultado, los conteos, cuántos hallazgos
 * quedan abiertos, el acta y las firmas— y quién ejecutó y quién revisó. El
 * resto del contexto (tipo, origen, programada, programa anual) queda plegado.
 */
export function RunReadSummary({ model, onReview, reviewLabel }: {
  model: RunReadSummaryModel
  /** Abre el diálogo de revisión (que se monta una vez, afuera). Sin él no hay botón. */
  onReview?: () => void
  reviewLabel?: string
}) {
  const { run, worksiteName, assigneeName, executorName, reviewerName, summary, coords, findings, closingAct, cancellation } = model
  const closed = isClosed(run.status)
  const facts = buildRunFacts(model).filter((fact) => !SHOWN_ELSEWHERE.has(fact.id))
  const where = [worksiteName, formatInspectionSubject(run.subjectType, run.subjectLabel, "")].filter(Boolean).join(" · ")
  const counts = itemCountsText(run)
  const signed = run.closingSignatures?.length ?? 0
  const closingResult = closingAct
    ? closingAct.resultOptions.find((option) => option.value === run.closingResult)?.label ?? run.closingResult
    : null

  const official = formatComplianceBasisPoints(run.officialComplianceBasisPoints ?? summary.officialComplianceBasisPoints, "Sin fórmula en el documento")
  const normalized = formatComplianceBasisPoints(run.normalizedComplianceBasisPoints ?? summary.normalizedComplianceBasisPoints, "Aún no calculable")

  return (
    <section aria-label="Resumen de la inspección" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug md:text-base">{where}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Responsable: {assigneeName ?? "Sin asignar"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MetaBadge meta={{ label: inspectionTaskStatusLabel(run.status), variant: runStatusBadgeVariant(run.status) }} />
          {onReview && (
            <Button type="button" size="sm" className="hidden md:inline-flex" onClick={onReview}>{reviewLabel ?? "Revisar y cerrar"}</Button>
          )}
        </div>
      </div>

      {closed ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--color-border)] pt-3 md:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Resultado normalizado</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums">{normalized}</dd>
            <dd className="mt-0.5 text-xs text-[var(--color-text-muted)]">Oficial: {official}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Ítems</dt>
            <dd className="mt-0.5 text-sm font-medium">{counts || "Sin ítems evaluados"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Hallazgos</dt>
            <dd className="mt-0.5 text-sm font-medium">
              {findings.length > 0
                ? <a href="#hallazgos" className={GROUP_LINK_CLASS}>{findingsSummaryText(findings)}</a>
                : findingsSummaryText(findings)}
            </dd>
          </div>
          {closingAct && (
            <div>
              <dt className="text-xs text-[var(--color-text-subtle)]">{closingAct.title}</dt>
              <dd className="mt-0.5 text-sm font-medium">
                <a href="#acta-cierre" className={GROUP_LINK_CLASS}>
                  {closingResult ?? "Sin declarar"}{closingAct.signatureRoles.length > 0 ? ` · ${signed} de ${closingAct.signatureRoles.length} firmas` : ""}
                </a>
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm">
          <p className="text-[var(--color-text-muted)]">
            {run.status === "cancelled" ? "No tiene cumplimiento ni hallazgos." : progressText(model)}
          </p>
          {/* R-02: el motivo que se obliga a escribir al cancelar, con su autor y su fecha. */}
          {run.status === "cancelled" && cancellation && (
            <p className="mt-1 whitespace-pre-wrap break-words font-medium">{cancellationText(cancellation)}</p>
          )}
        </div>
      )}

      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
        <span>
          <span className="text-[var(--color-text-subtle)]">Ejecutó: </span>
          {executorName ? `${executorName} · ${formatDateTime(run.executedAt!)}` : "Sin ejecutar"}
        </span>
        {run.status === "reviewed" && (
          <span>
            <span className="text-[var(--color-text-subtle)]">Revisó: </span>
            {reviewerName ?? "—"}{run.reviewedAt ? ` · ${formatDateTime(run.reviewedAt)}` : ""}
          </span>
        )}
      </p>
      {run.status === "reviewed" && run.reviewComment && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{run.reviewComment}</p>
      )}

      <details className="group mt-1 text-sm">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center font-medium md:min-h-9 [&::-webkit-details-marker]:hidden">
          Ver más datos
        </summary>
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.id}>
              <dt className="text-xs text-[var(--color-text-subtle)]"><FactLabel fact={fact} /></dt>
              <dd className="mt-0.5 text-xs font-medium">{fact.value}</dd>
            </div>
          ))}
          {coords && (
            <div>
              <dt className="text-xs text-[var(--color-text-subtle)]">Ubicación</dt>
              <dd className="mt-0.5 text-xs font-medium">{coords.lat}, {coords.lon}</dd>
            </div>
          )}
        </dl>
      </details>
    </section>
  )
}
