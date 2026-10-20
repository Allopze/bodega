"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_ORIGIN_LABELS,
  runStatusBadgeVariant,
} from "@/lib/prevention/inspections"
import {
  formatComplianceBasisPoints,
  formatInspectionSubject,
} from "@/lib/prevention/inspection-answer-format"
import { inspectionTaskStatusLabel } from "@/lib/prevention/inspection-list-query"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { RunViewModel } from "./run-view-types"

export type RunFactsModel = Pick<
  RunViewModel,
  | "run" | "templateKind" | "worksiteName" | "assigneeName" | "executorName" | "summary" | "coords"
  | "pdtpActivityNumbers" | "pdtpReviewActivityNumbers"
  | "requiredItems" | "answeredRequired" | "answeredCount" | "items"
>

/** Los datos de contexto de la inspección, en el orden en que se muestran. */
export function buildRunFacts(model: RunFactsModel): { label: string; value: string }[] {
  const { run, templateKind, worksiteName, assigneeName, executorName, summary, coords, pdtpActivityNumbers, pdtpReviewActivityNumbers } = model
  return [
    { label: "Estado", value: inspectionTaskStatusLabel(run.status) },
    { label: "Tipo", value: INSPECTION_KIND_LABELS[templateKind] ?? templateKind },
    { label: "Origen", value: INSPECTION_ORIGIN_LABELS[run.origin] ?? run.origin },
    { label: "Faena", value: worksiteName },
    { label: "Sujeto", value: formatInspectionSubject(run.subjectType, run.subjectLabel) },
    { label: "Asignada a", value: assigneeName ?? "Sin asignar" },
    { label: "Programada para", value: run.scheduledFor ? formatDate(run.scheduledFor) : "Sin fecha" },
    { label: "Ejecutada por", value: executorName ? `${executorName} · ${formatDateTime(run.executedAt!)}` : "Sin ejecutar" },
    {
      label: "Resultado oficial",
      value: formatComplianceBasisPoints(run.officialComplianceBasisPoints ?? summary.officialComplianceBasisPoints, "Sin fórmula en el documento"),
    },
    {
      label: "Resultado normalizado",
      value: formatComplianceBasisPoints(run.normalizedComplianceBasisPoints ?? summary.normalizedComplianceBasisPoints, "Aún no calculable"),
    },
    { label: "Ubicación", value: coords ? `${coords.lat}, ${coords.lon} · dato de apoyo opcional` : "No capturada · opcional" },
    // Qué acredita en el programa anual, y en qué etapa. El estado del run dice
    // si ya ocurrió: `completed` cierra la primera, `reviewed` la segunda.
    {
      label: "Acredita en el PDTP",
      value: [
        pdtpActivityNumbers.length > 0 ? `N° ${pdtpActivityNumbers.join(", ")} al ejecutar` : null,
        pdtpReviewActivityNumbers.length > 0 ? `N° ${pdtpReviewActivityNumbers.join(", ")} al revisar` : null,
      ].filter(Boolean).join(" · ") || "No acredita ninguna actividad",
    },
  ]
}

/**
 * La ficha de contexto: en el teléfono una tarjeta con «Ver contexto completo»
 * plegado; desde `md`, una rejilla con todos los datos. Son dos nodos hermanos
 * (uno oculto por CSS), así que el componente devuelve un fragmento.
 */
export function RunFacts({ model }: { model: RunFactsModel }) {
  const { run, worksiteName, assigneeName, requiredItems, answeredRequired, answeredCount, items } = model
  const facts = buildRunFacts(model)
  return (
    <>
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow">Trabajo actual</p>
            <p className="mt-1 text-base font-semibold">{worksiteName}{run.subjectLabel ? ` · ${run.subjectLabel}` : ""}</p>
          </div>
          <MetaBadge meta={{ label: `${inspectionTaskStatusLabel(run.status)}`, variant: runStatusBadgeVariant(run.status) }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div><span className="block text-[var(--color-text-subtle)]">Responsable</span><span className="mt-0.5 block font-medium">{assigneeName ?? "Sin asignar"}</span></div>
          {/* I-02: sin obligatorios efectivos (instrumento de un solo ítem de
              texto libre) "0 de N obligatorios" mentía igual que antes, sólo
              que al revés — se muestra el avance total en su lugar. */}
          <div>
            <span className="block text-[var(--color-text-subtle)]">{requiredItems.length > 0 ? "Avance obligatorio" : "Avance"}</span>
            <span className="mt-0.5 block font-medium">{requiredItems.length > 0 ? `${answeredRequired} de ${requiredItems.length}` : `${answeredCount} de ${items.length}`}</span>
          </div>
        </div>
        <details className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm">
          <summary className="cursor-pointer font-medium">Ver contexto completo</summary>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {facts.slice(1).map((fact) => <div key={fact.label}><dt className="text-xs text-[var(--color-text-subtle)]">{fact.label}</dt><dd className="mt-0.5 text-xs font-medium">{fact.value}</dd></div>)}
          </dl>
        </details>
      </section>

      <div className="hidden grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>
    </>
  )
}
