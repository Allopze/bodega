"use client"

import { useState } from "react"
import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { formatDate, formatDateTime } from "@/lib/utils"
import { re20RelativeTime } from "../../deadlines"
import { Re20Block, Re20Date, Re20TextArea } from "../../fields"
import type { Re20WorkspaceApi } from "../../use-re20-workspace"
import { withRe20TaskStatus } from "../../workspace-data"
import { MEETING_PART_MAX, dateToIso, isoToDate, meetingComplete, parseMeetingNotes, withTaskFields, type MeetingNotes } from "./model"

export const MEETING_ID = (field: string) => `re20-seguimiento-${field}`
const TASK = "post_accident_meeting"

/** Reunión post accidente (PASO A PASO 9): el día del reintegro, con la persona accidentada. */
export function MeetingBlock({ ws }: { ws: Re20WorkspaceApi }) {
  const task = ws.task(TASK)
  const done = task.status === "completed"
  const [notes, setNotes] = useState<MeetingNotes>(() => {
    const stored = ws.data.postAccidentMeeting
    // Campo propio desde 2026-10-20; los expedientes anteriores lo traen en la nota de la tarea.
    return stored
      ? { causes: stored.causesReviewed ?? "", newMeasures: stored.newMeasures ?? "", reinstruction: stored.reinstruction ?? "" }
      : parseMeetingNotes(task.note)
  })
  const [busy, setBusy] = useState(false)
  const date = isoToDate(task.dueAt)
  const ready = meetingComplete(notes, date)
  const due = task.dueAt && !done ? task.dueAt : null

  const setPart = (key: keyof MeetingNotes) => (value: string) => {
    const next = { ...notes, [key]: value }
    setNotes(next)
    ws.update((data) => ({
      ...withTaskFields(data, TASK, { note: null }),
      postAccidentMeeting: { causesReviewed: next.causes, newMeasures: next.newMeasures, reinstruction: next.reinstruction },
    }))
  }

  async function finish() {
    setBusy(true)
    await ws.save((data) => withRe20TaskStatus(data, TASK, "completed"))
    setBusy(false)
  }

  return (
    <Re20Block
      id={MEETING_ID("block-meeting")}
      title="Reunión post accidente"
      summary={done ? `Realizada el ${task.completedAt ? formatDateTime(task.completedAt) : "—"}` : date ? `Reintegro el ${formatDate(date)}` : "Falta la fecha de reintegro"}
      complete={done}
      defaultOpen={!done && !date}
    >
      {done ? (
        <Callout tone="success" icon={<CheckCircle aria-hidden className="size-4" weight="fill" />} title="Reunión realizada">
          <p>Se revisaron las causas y medidas con la persona, se acordaron nuevas medidas y se la reinstruyó.</p>
          {!ws.readOnly && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => ws.setTaskStatus(TASK, "in_progress")}>Reabrir para corregir</Button>}
        </Callout>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          La hace el Comité Paritario con el administrador de contrato o jefe de terreno y Prevención de Riesgos, el día en que la persona vuelve a sus actividades.
        </p>
      )}
      <Re20Date
        id={MEETING_ID("reintegration")}
        label="Fecha de reintegro"
        required
        value={date}
        onChange={(value) => ws.update((data) => withTaskFields(data, TASK, { dueAt: dateToIso(value ?? "") }))}
        helper={due ? `La reunión se hace ${re20RelativeTime(due, ws.now)}.` : undefined}
      />
      <Re20TextArea id={MEETING_ID("meeting-causes")} label="Revisión de causas y medidas con la persona" required rows={3} maxLength={MEETING_PART_MAX} value={notes.causes} onChange={setPart("causes")} helper="Qué opinó sobre lo que se concluyó y lo que se definió." />
      <Re20TextArea id={MEETING_ID("meeting-measures")} label="Nuevas medidas acordadas" required rows={3} maxLength={MEETING_PART_MAX} value={notes.newMeasures} onChange={setPart("newMeasures")} helper="Las que salieron de la conversación; después se agregan al plan de acción." />
      <Re20TextArea id={MEETING_ID("meeting-reinstruction")} label="Reinstrucción de la persona" required rows={3} maxLength={MEETING_PART_MAX} value={notes.reinstruction} onChange={setPart("reinstruction")} helper="Qué se le reinstruyó, quién lo hizo y cuándo." />
      {!ws.readOnly && !done && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void finish()} disabled={!ready || busy} loading={busy}>Registrar la reunión realizada</Button>
          {!ready && <p className="text-xs text-[var(--color-text-muted)]">Faltan la fecha de reintegro y las tres partes de la reunión.</p>}
        </div>
      )}
    </Re20Block>
  )
}
