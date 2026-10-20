"use client"

import * as React from "react"
import { Callout } from "@/components/ui/callout"
import { RemindReviewButton } from "./run-detail-controls"
import type { RunViewModel } from "./run-view-types"

export type RunBlockersModel = Pick<RunViewModel, "channel" | "jumpToItem">

/**
 * Lo que el servidor todavía no tiene mientras se edita: las filas retenidas en
 * el dispositivo (guardar sigue funcionando; sólo estas quedan sin enviar). Cada
 * línea salta al ítem. Lo que falta para declarar ejecutada ya no es un muro
 * rojo aquí (P2-1): es el resumen del progreso (`RunProgress`). Sin filas
 * retenidas, no pinta nada.
 */
export function RunBlockers({ model }: { model: RunBlockersModel }) {
  const { channel, jumpToItem } = model
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
                <button type="button" className="min-h-11 text-left underline md:min-h-0" onClick={() => jumpToItem(row.key, row.reason === "invalid" ? "comment" : undefined)}>{row.problem}</button>
              </li>
            ))}
          </ul>
        </Callout>
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
