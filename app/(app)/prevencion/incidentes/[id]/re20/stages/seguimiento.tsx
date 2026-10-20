"use client"

import { useState } from "react"
import { ClockCountdown } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { re20ApplicableTaskIds } from "@/lib/prevention/incidents"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { Re20StageModule, Re20StageProgress, Re20StageProps } from "../stages"
import { re20DeadlineState, re20RelativeTime } from "../deadlines"
import { Re20Block } from "../fields"
import type { Re20WorkspaceApi } from "../use-re20-workspace"
import { FollowupSheet } from "./seguimiento/followup-sheet"
import { MeetingBlock, MEETING_ID } from "./seguimiento/meeting-block"
import { LevelBadge, MEASURE_ROW_ID, MeasuresPanel, causeText } from "./seguimiento/measures-panel"
import {
  FOLLOWUP_FORM_CODE,
  followupKind,
  levelFromFlags,
  measureLevel,
  measureVerified,
  nextFollowupDue,
  type FollowupRecord,
  type MeasureLevel,
  type Re20Measure,
} from "./seguimiento/model"

/* Etapa 7 — Seguimiento y eficacia (RE-20-08 / RE-20-09, PASO A PASO 9, 10 y 11).
 * Reunión al reintegro, seguimiento de cada medida cada N días hasta que sea eficaz y
 * verificación por una persona distinta del responsable. */

const MEASURES_ID = "re20-seguimiento-measures"

function meetingApplies(ws: Pick<Re20WorkspaceApi, "incident" | "data">) {
  return re20ApplicableTaskIds(ws.incident.eventType, {
    nearMissPotential: ws.data.nearMiss?.potential ?? null,
    isFatalOrSerious: ws.incident.isFatalOrSerious === true,
  }).includes("post_accident_meeting")
}

function progress(ws: Re20WorkspaceApi): Re20StageProgress {
  const checks: Array<{ ok: boolean; label: string; fieldId: string }> = []
  if (meetingApplies(ws)) {
    const meeting = ws.task("post_accident_meeting")
    checks.push(
      { ok: Boolean(meeting.dueAt), label: "Fecha de reintegro de la persona accidentada", fieldId: MEETING_ID("reintegration") },
      { ok: meeting.status === "completed", label: "Reunión post accidente realizada", fieldId: MEETING_ID("meeting-causes") },
    )
  }
  const measures = ws.data.measures.filter((measure) => measure.description.trim())
  if (measures.length === 0) checks.push({ ok: false, label: "Medidas del plan de acción para hacerles seguimiento", fieldId: MEASURES_ID })
  for (const measure of measures) {
    checks.push({ ok: measureVerified(measure), label: `Verificar la eficacia de «${measure.description.trim().slice(0, 60)}»`, fieldId: MEASURE_ROW_ID(measure.id) })
  }
  return { done: checks.filter((check) => check.ok).length, total: checks.length, missing: checks.filter((check) => !check.ok).map(({ label, fieldId }) => ({ label, fieldId })) }
}

/** Seguimientos que el servidor ya conoce, si la pantalla los entrega (`ws.followups`), más los de esta sesión. */
function knownFollowups(ws: Re20WorkspaceApi): FollowupRecord[] {
  return ws.followups
}

function SeguimientoStage({ ws, stage }: Re20StageProps) {
  const [session, setSession] = useState<FollowupRecord[]>([])
  const [editing, setEditing] = useState<{ measure: Re20Measure; level: MeasureLevel } | null>(null)
  const ids = new Set(knownFollowups(ws).map((record) => record.id))
  const records = [...knownFollowups(ws), ...session.filter((record) => !ids.has(record.id))]
  const kind = followupKind(ws.incident.eventType)
  const measures = ws.data.measures.filter((measure) => measure.description.trim())
  const effectiveLabel = ws.options.find((option) => option.category === "effectiveness" && option.isActive && /^eficaz$/i.test(option.name.trim()))?.name ?? "Eficaz"
  const allEffective = measures.length > 0 && measures.every((measure) => measureLevel(measure, records) === "effective")
  const nextDue = allEffective ? null : nextFollowupDue(records, ws.policy, ws.deadlines.seguimiento?.dueAt ?? null)
  const nextState = nextDue ? re20DeadlineState(nextDue, ws.now) : null
  const verified = measures.filter(measureVerified).length
  const sortedRecords = [...records].sort((a, b) => Date.parse(`${b.followupDate}T12:00:00Z`) - Date.parse(`${a.followupDate}T12:00:00Z`) || Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))

  return (
    <div className="space-y-3">
      {meetingApplies(ws) && <MeetingBlock ws={ws} />}

      <div>
        <Re20Block
          id={MEASURES_ID}
          title={`Seguimiento de las medidas (${FOLLOWUP_FORM_CODE[kind]})`}
          summary={measures.length === 0 ? "Sin medidas todavía" : allEffective ? "Todas las medidas son eficaces" : `${measures.filter((measure) => measureLevel(measure, records) === "effective").length} de ${measures.length} eficaces`}
          complete={allEffective}
          defaultOpen
        >
          <p className="text-sm text-[var(--color-text-muted)]">
            Se revisa cada {ws.policy.followupDays} días, en la reunión del Comité Paritario, hasta que la medida sea eficaz.
            {nextDue && (
              <>
                {" "}Próximo seguimiento: <span className="font-mono tabular-nums">{formatDate(nextDue)}</span>{" "}
                (<span className={nextState === "overdue" ? "font-medium text-[var(--color-signal-ink)]" : undefined}>{re20RelativeTime(nextDue, ws.now)}</span>).
              </>
            )}
            {!nextDue && !allEffective && stage.deadline === null && " Empieza al cerrar el informe definitivo."}
          </p>
          <MeasuresPanel ws={ws} records={records} mode="followup" onOpen={(measure, level) => setEditing({ measure, level })} />
        </Re20Block>

        <Re20Block
          id="re20-seguimiento-block-verify"
          title="Verificación de eficacia"
          summary={measures.length === 0 ? "Sin medidas todavía" : `${verified} de ${measures.length} verificadas`}
          complete={measures.length > 0 && verified === measures.length}
        >
          <p className="text-sm text-[var(--color-text-muted)]">La verifica una persona distinta del responsable de la medida, en la fecha definida en el plan de acción. Queda en la sección 10.1 del informe y en el seguimiento.</p>
          <MeasuresPanel ws={ws} records={records} mode="verify" onOpen={(measure, level) => setEditing({ measure, level })} />
        </Re20Block>

        <Re20Block
          id="re20-seguimiento-block-history"
          title="Historial de seguimientos"
          summary={sortedRecords.length === 0 ? "Sin registros desde que abriste esta pantalla" : `${sortedRecords.length} ${sortedRecords.length === 1 ? "registro" : "registros"}`}
        >
          {sortedRecords.length === 0 ? (
            <EmptyState
              compact
              align="start"
              as="p"
              icon={<ClockCountdown aria-hidden className="size-5" />}
              title="Aquí aparecen los seguimientos que registres"
              description="Cada vez que revises una medida, queda con su fecha, su estado y quién la verificó."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {sortedRecords.map((record) => {
                const measure = ws.data.measures.find((item) => item.id === record.measureId)
                const level = levelFromFlags(record)
                const verifier = ws.people.find((person) => person.id === record.verifierUserId)?.name
                return (
                  <li key={record.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{formatDate(record.followupDate)}</span>
                      <LevelBadge level={level} />
                      <Badge variant="outline">{FOLLOWUP_FORM_CODE[record.kind]}</Badge>
                    </div>
                    <p className="text-sm font-medium text-[var(--color-text)]">{measure ? measure.description : "Medida del seguimiento"}</p>
                    <p className="whitespace-pre-wrap text-sm text-[var(--color-text-muted)]">{record.note}</p>
                    <p className="text-xs text-[var(--color-text-subtle)]">
                      {verifier ? `Verificó ${verifier}${record.verifiedAt ? ` el ${formatDate(record.verifiedAt)}` : ""}` : null}
                      {record.residualRisk ? ` · Riesgo residual: ${record.residualRisk}` : null}
                      {record.lostDays !== null && record.lostDays !== undefined ? ` · ${record.lostDays} días perdidos` : null}
                      {record.lossDescription ? ` · Daño: ${record.lossDescription}` : null}
                      {record.createdAt ? ` · registrado ${formatDateTime(record.createdAt)}` : null}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </Re20Block>
      </div>

      {editing && (
        <FollowupSheet
          key={`${editing.measure.id}-${editing.level}`}
          ws={ws}
          measure={editing.measure}
          kind={kind}
          initialLevel={editing.level}
          effectiveLabel={effectiveLabel}
          causeText={causeText(ws, editing.measure)}
          onClose={() => setEditing(null)}
          onRecorded={(record) => setSession((current) => [...current, record])}
        />
      )}
    </div>
  )
}

export const seguimientoStage: Re20StageModule = { Component: SeguimientoStage, progress }
