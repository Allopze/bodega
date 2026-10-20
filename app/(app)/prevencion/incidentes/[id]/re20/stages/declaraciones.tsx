"use client"

import * as React from "react"
import { CheckCircle, Clock } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDateTime } from "@/lib/utils"
import type { Re20StageModule, Re20StageProgress, Re20StageProps } from "../stages"
import { re20DeadlineState, re20RelativeTime } from "../deadlines"
import { focusRe20Field, type Re20WorkspaceApi } from "../use-re20-workspace"
import { withRe20TaskStatus } from "../workspace-data"
import { Re20RepeatableList } from "../fields"
import { Re20SensitiveVeil } from "../sensitive-veil"
import { Re20DeclarationCard } from "./declaraciones/declaration-card"
import { Re20InterviewForm } from "./declaraciones/interview"
import {
  ID,
  INTERVIEW_TOTAL,
  declId,
  declarationDeadlines,
  declarationLabel,
  declarationsMissing,
  interviewMissing,
  newDeclaration,
  type Re20Declaration,
} from "./declaraciones/model"

/* Etapa 2 — Declaraciones (RE-20-07 por persona) y cuestionario a la persona
 * accidentada (RE-20-03, sólo si la tarea aplica). Todo es dato reservado. */

function interviewApplies(ws: Re20WorkspaceApi) {
  return ws.incident.eventType !== "commute_accident"
}

function progress(ws: Re20WorkspaceApi): Re20StageProgress {
  // Sin acceso a los datos reservados no hay nada que medir (y no se promete un avance falso).
  if (!ws.sensitiveAvailable) return { done: 0, total: 0, missing: [] }
  const declarations = ws.sensitive.declarations
  const statementMissing = declarationsMissing(ws.sensitive)
  const statementTotal = declarations.length === 0 ? 1 : declarations.length * 4
  const interview = interviewApplies(ws) ? interviewMissing(ws.sensitive) : []
  const interviewTotal = interviewApplies(ws) ? INTERVIEW_TOTAL : 0
  const missing = [...statementMissing, ...interview]
  const total = statementTotal + interviewTotal
  return { done: total - missing.length, total, missing }
}

function DeadlineLine({ label, dueAt, rule, pendingText, now }: { label: string; dueAt: string | null; rule: string; pendingText?: string; now: number }) {
  if (!dueAt) return <p className="text-sm text-[var(--color-text-muted)]"><span className="font-medium text-[var(--color-text)]">{label}:</span> {pendingText}</p>
  const state = re20DeadlineState(dueAt, now)
  const urgent = state === "overdue" || state === "soon"
  return (
    <p className={urgent ? "flex items-center gap-1.5 text-sm text-[var(--color-signal-ink)]" : "text-sm text-[var(--color-text-muted)]"}>
      {urgent && <Clock aria-hidden weight="bold" className="size-4 shrink-0" />}
      <span>
        <span className="font-medium">{label}:</span>{" "}
        {state === "overdue" ? "venció" : "vence"} el <span className="font-mono tabular-nums">{formatDateTime(dueAt)}</span> ({re20RelativeTime(dueAt, now)}) · {rule}
      </span>
    </p>
  )
}

function DeclaracionesStage({ ws }: Re20StageProps) {
  const [newId, setNewId] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<number | null>(null)
  const declarations = ws.sensitive.declarations
  const withInterview = interviewApplies(ws)
  const statementsTask = ws.task("witness_statements")
  const interviewTask = ws.task("injured_interview")
  const statementsDone = statementsTask.status === "completed"
  const interviewDone = interviewTask.status === "completed"
  const deadlines = declarationDeadlines(ws)
  const statementsMissing = declarationsMissing(ws.sensitive)
  const interviewGaps = interviewMissing(ws.sensitive)

  function add() {
    const declaration = newDeclaration(ws)
    setNewId(declaration.id)
    ws.updateSensitive((sensitive) => ({ ...sensitive, declarations: [...sensitive.declarations, declaration] }))
    focusRe20Field(declId(declaration, "name"))
  }

  function remove(index: number) {
    ws.updateSensitive((sensitive) => ({ ...sensitive, declarations: sensitive.declarations.filter((_, position) => position !== index) }))
    setRemoving(null)
  }

  function closeTask(taskId: string) {
    void ws.save((data) => withRe20TaskStatus(data, taskId, "completed"))
  }

  const removed: Re20Declaration | undefined = removing === null ? undefined : declarations[removing]

  return (
    <Re20SensitiveVeil title="Declaraciones y entrevista" description="Las declaraciones identifican a quienes declaran. Para verlas, indica para qué las necesitas: queda registrado.">
      <div className="space-y-8">
        <div className="space-y-1">
          {!statementsDone && <DeadlineLine now={ws.now} label="Declaraciones" dueAt={deadlines.statements.dueAt} rule={deadlines.statements.rule} />}
          {withInterview && !interviewDone && (
            <DeadlineLine now={ws.now} label="Entrevista a la persona accidentada" dueAt={deadlines.interview.dueAt} rule={deadlines.interview.rule} pendingText="empieza a correr cuando termines el informe preliminar." />
          )}
        </div>

        <section aria-labelledby={ID("statements-title")} className="space-y-3">
          {statementsDone && (
            <Callout tone="success" icon={<CheckCircle weight="fill" className="size-4" />} title="Declaraciones terminadas">
              <p>Se cerraron el <span className="font-mono tabular-nums">{statementsTask.completedAt ? formatDateTime(statementsTask.completedAt) : "—"}</span>.</p>
              {!ws.readOnly && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => ws.setTaskStatus("witness_statements", "in_progress")}>Reabrir para corregir</Button>}
            </Callout>
          )}
          <h3 id={ID("statements-title")} className="sr-only">Declaraciones individuales</h3>
          <Re20RepeatableList
            id={ID("list")}
            title="Quién declara"
            description="Una declaración por persona: involucrados, testigos y la persona accidentada."
            items={declarations}
            getKey={(item) => item.id}
            itemLabel={(item, index) => `declaración de ${declarationLabel(item, index)}`}
            onAdd={add}
            onRemove={setRemoving}
            addLabel="Agregar declaración"
            emptyTitle="Todavía no hay declaraciones"
            emptyDescription="Registra a cada persona que vio, participó o fue afectada. Lo primero que hace falta es una."
            renderItem={(item, index) => <Re20DeclarationCard ws={ws} declaration={item} index={index} defaultOpen={item.id === newId || declarations.length === 1} />}
          />
        </section>

        {withInterview && (
          <section aria-labelledby={ID("interview-title")} className="space-y-1">
            {interviewDone && (
              <Callout tone="success" icon={<CheckCircle weight="fill" className="size-4" />} title="Entrevista terminada">
                <p>Se cerró el <span className="font-mono tabular-nums">{interviewTask.completedAt ? formatDateTime(interviewTask.completedAt) : "—"}</span>.</p>
                {!ws.readOnly && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => ws.setTaskStatus("injured_interview", "in_progress")}>Reabrir para corregir</Button>}
              </Callout>
            )}
            <h4 id={ID("interview-title")} className="text-sm font-semibold text-[var(--color-text)]">Cuestionario a la persona accidentada</h4>
            <p className="text-xs text-[var(--color-text-muted)]">Se hace con calma y sin inducir respuestas. Las preguntas siguen el formato RE-20-03.</p>
            <Re20InterviewForm ws={ws} />
          </section>
        )}

        {!ws.readOnly && (!statementsDone || (withInterview && !interviewDone)) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[var(--color-border)] pt-4">
            {!statementsDone && (
              <div className="space-y-1">
                <Button type="button" onClick={() => closeTask("witness_statements")} disabled={statementsMissing.length > 0 || ws.saving} loading={ws.saving}>Terminar las declaraciones</Button>
                {statementsMissing.length > 0 && <p className="text-xs text-[var(--color-text-muted)]">Faltan {statementsMissing.length} {statementsMissing.length === 1 ? "dato" : "datos"} en las declaraciones.</p>}
              </div>
            )}
            {withInterview && !interviewDone && (
              <div className="space-y-1">
                <Button type="button" variant={statementsDone ? "primary" : "secondary"} onClick={() => closeTask("injured_interview")} disabled={interviewGaps.length > 0 || ws.saving}>Terminar la entrevista</Button>
                {interviewGaps.length > 0 && <p className="text-xs text-[var(--color-text-muted)]">Faltan {interviewGaps.length} {interviewGaps.length === 1 ? "dato" : "datos"} en el cuestionario.</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title="Quitar esta declaración"
        description={removed ? `Se borra la declaración de ${declarationLabel(removed, removing ?? 0)} con todo lo que contiene. Se aplica al guardar.` : ""}
        confirmLabel="Quitar declaración"
        variant="destructive"
        onConfirm={() => removing !== null && remove(removing)}
      />
    </Re20SensitiveVeil>
  )
}

export const declaracionesStage: Re20StageModule = { Component: DeclaracionesStage, progress }
