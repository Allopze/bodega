"use client"

import * as React from "react"
import { Callout } from "@/components/ui/callout"
import { RemindReviewButton } from "./run-detail-controls"
import type { RunViewModel } from "./run-view-types"

export type RunBlockersModel = Pick<RunViewModel, "channel" | "pendingLines" | "jumpToItem">

/**
 * Lo que impide avanzar mientras se edita, en dos avisos que NO se mezclan
 * (P2-1): lo que el servidor todavía no tiene (filas retenidas en el
 * dispositivo; guardar sigue funcionando) y lo que falta para declarar
 * ejecutada. Cada línea salta al ítem. Sin nada que mostrar, no pinta nada.
 */
export function RunBlockers({ model }: { model: RunBlockersModel }) {
  const { channel, pendingLines, jumpToItem } = model
  return (
    <>
      {/* Lo que el servidor todavía no tiene. Aparte de lo que impide cerrar:
          guardar sigue funcionando, sólo estas filas quedan en el dispositivo. */}
      {channel.held.length > 0 && (
        <Callout tone="warning" role="status" title="Respuestas que todavía no se guardan">
          <p>Las demás sí se guardan; estas quedan en este dispositivo hasta que las completes.</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {channel.held.map((row) => (
              <li key={row.key}>
                <button type="button" className="min-h-11 text-left underline md:min-h-0" onClick={() => jumpToItem(row.key)}>{row.problem}</button>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {pendingLines.length > 0 && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">Para declarar ejecutada falta:</p>
          {/* I-06: lista completa con scroll interno, no un "y N más…" mudo. */}
          <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-y-auto pl-4">
            {pendingLines.map((line) => (
              <li key={`${line.key ?? "acta"}:${line.text}`}>
                {line.key
                  ? <button type="button" className="min-h-11 text-left underline md:min-h-0" onClick={() => jumpToItem(line.key!)}>{line.text}</button>
                  : line.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

export type ReviewBlockedNoticeModel = Pick<RunViewModel, "run" | "reviewers" | "selfReviewBlocked">

/**
 * I-08: quien ejecutó la inspección no puede cerrarla (con o sin permiso de
 * revisión). Antes sólo se bloqueaba la auto-revisión y quien no tenía el
 * permiso no veía ningún mensaje; ahora cambia sólo el texto. El componente
 * se monta únicamente cuando `reviewBlocked`.
 */
export function ReviewBlockedNotice({ model }: { model: ReviewBlockedNoticeModel }) {
  const { run, reviewers, selfReviewBlocked } = model
  return (
    <div className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-warning-ink)]">
      <p>
        {selfReviewBlocked
          ? "Tú ejecutaste esta inspección: debe revisarla y cerrarla otra persona con permiso de revisión."
          : "Ejecutaste esta inspección y no tienes permiso para revisarla. Debe cerrarla otra persona con permiso de revisión."}
        {reviewers.length > 0 && ` Puede cerrarla: ${reviewers.map((reviewer) => reviewer.name).join(", ")}.`}
      </p>
      {reviewers.length > 0 && <RemindReviewButton runId={run.id} />}
      {reviewers.length === 0 && <p className="mt-1">Nadie con permiso de revisión está asignado a esta faena. Avisa a Prevención.</p>}
    </div>
  )
}
