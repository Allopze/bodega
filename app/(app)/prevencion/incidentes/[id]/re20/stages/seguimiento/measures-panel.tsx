"use client"

import { ClipboardText } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import { re20DeadlineState } from "../../deadlines"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { LEVEL_LABELS, measureLevel, type FollowupRecord, type MeasureLevel, type Re20Measure } from "./model"

export const MEASURE_ROW_ID = (measureId: string) => `re20-seguimiento-measure-${measureId}`

const LEVEL_VARIANT = { pending: "signal", implemented: "info", verified: "primary", effective: "success" } as const

export function LevelBadge({ level }: { level: MeasureLevel }) {
  return <MetaBadge meta={{ label: LEVEL_LABELS[level], variant: LEVEL_VARIANT[level] }} />
}

export function responsibleName(ws: Re20WorkspaceApi, measure: Re20Measure) {
  return ws.people.find((person) => person.id === measure.responsibleUserId)?.name ?? measure.responsibleRole?.trim() ?? "Sin responsable"
}

export function causeText(ws: Re20WorkspaceApi, measure: Re20Measure) {
  return ws.data.causalTree.events.find((event) => event.id === measure.rootCauseId)?.description.trim() ?? ""
}

function Empty({ ws }: { ws: Re20WorkspaceApi }) {
  return (
    <EmptyState
      compact
      align="start"
      as="p"
      icon={<ClipboardText aria-hidden className="size-5" />}
      title="Todavía no hay medidas que seguir"
      description="Las medidas salen de las causas raíz de la investigación. Cuando el equipo las escriba, aquí se les hace seguimiento cada 14 días."
      action={<Button type="button" onClick={() => ws.setStage("investigacion")}>Ir a la investigación</Button>}
    />
  )
}

/** Lista de medidas con su estado y la acción de seguimiento (`mode="followup"`) o de verificación (`mode="verify"`). */
export function MeasuresPanel({ ws, records, mode, onOpen }: {
  ws: Re20WorkspaceApi
  records: FollowupRecord[]
  mode: "followup" | "verify"
  onOpen: (measure: Re20Measure, level: MeasureLevel) => void
}) {
  const measures = ws.data.measures.filter((measure) => measure.description.trim())
  if (measures.length === 0) return <Empty ws={ws} />
  const firstOpen = measures.find((measure) => measureLevel(measure, records) !== "effective")
  return (
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {measures.map((measure) => {
        const level = measureLevel(measure, records)
        const overdue = level !== "effective" && measure.dueAt ? re20DeadlineState(measure.dueAt, ws.now) === "overdue" : false
        const verifier = ws.people.find((person) => person.id === measure.verifierUserId)?.name
        const result = measure.effectiveness?.result?.trim()
        return (
          <li key={measure.id} id={MEASURE_ROW_ID(measure.id)} tabIndex={-1} className="grid gap-3 py-4 outline-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-[var(--color-text)]">{measure.description}</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                {causeText(ws, measure) ? `Causa raíz: ${causeText(ws, measure)} · ` : ""}
                {responsibleName(ws, measure)}
                {measure.controlType ? ` · ${measure.controlType}` : ""}
              </p>
              {mode === "followup" ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <LevelBadge level={level} />
                  <span className={overdue ? "font-medium text-[var(--color-signal-ink)]" : undefined}>
                    {measure.dueAt ? `${overdue ? "Vencida: " : "Compromiso: "}` : "Sin fecha compromiso"}
                    {measure.dueAt && <span className="font-mono tabular-nums">{formatDate(measure.dueAt)}</span>}
                  </span>
                </p>
              ) : (
                <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <LevelBadge level={level} />
                  {verifier ? <span>Verificó {verifier}{measure.verifiedAt ? <> el <span className="font-mono tabular-nums">{formatDate(measure.verifiedAt)}</span></> : null}</span> : <span>Sin verificador</span>}
                  {result && <span>· Resultado: {result}</span>}
                  {measure.effectiveness?.residualRisk && <span>· Riesgo residual: {measure.effectiveness.residualRisk}</span>}
                </p>
              )}
            </div>
            {!ws.readOnly && (
              <Button
                type="button"
                variant={mode === "followup" && measure.id === firstOpen?.id ? "primary" : "secondary"}
                aria-label={`${mode === "followup" ? "Registrar seguimiento de" : "Verificar eficacia de"} ${measure.description}`}
                onClick={() => onOpen(measure, mode === "verify" ? (level === "effective" || level === "verified" ? level : "verified") : level)}
              >
                {mode === "followup" ? "Registrar seguimiento" : level === "effective" ? "Volver a verificar" : "Verificar eficacia"}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
