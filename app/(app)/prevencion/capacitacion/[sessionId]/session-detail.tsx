"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  assessLegalFloor,
  TRAINING_ASSESSMENT_RESULT_LABELS,
  TRAINING_ATTENDANCE_STATUS_LABELS,
  TRAINING_KIND_LABELS,
  TRAINING_MODALITY_LABELS,
  TRAINING_SESSION_STATUS_LABELS,
} from "@/lib/prevention/training"
import { formatDateTime } from "@/lib/utils"
import {
  cancelTrainingSessionAction,
  closeTrainingSessionAction,
  recordTrainingAttendanceAction,
} from "../actions"
import { Field, selectClass, toLocalInputValue, useOperation } from "../form-kit"

interface SessionInfo {
  id: string
  code: string
  status: string
  modality: string
  scheduledAt: string
  startedAt: string | null
  endedAt: string | null
  durationMinutes: number | null
  location: string | null
  instructorExternalName: string | null
  instructorCompetencyEvidence: string
  cancellationReason: string | null
  version: number
}

interface CourseInfo {
  name: string
  kind: string
  minimumDurationMinutes: number
  validityMonths: number | null
  versionLabel: string
  assessmentType: string
  passingScore: number
}

interface AttendanceRow {
  id: string
  workerId: string
  workerName: string
  workerPosition: string | null
  status: string
  attendanceMinutes: number | null
  assessmentScore: number | null
  assessmentResult: string
  excuseReason: string | null
  acknowledgedAt: string | null
}

/** Lo que el formulario edita por persona antes de enviarse. */
interface Draft {
  status: string
  attendanceMinutes: string
  assessmentScore: string
  excuseReason: string
}

function statusBadgeVariant(status: string): "default" | "info" | "success" | "outline" {
  if (status === "completed") return "success"
  if (status === "in_progress") return "info"
  if (status === "cancelled") return "outline"
  return "default"
}

function attendanceBadgeVariant(status: string): "default" | "success" | "danger" | "warning" {
  if (status === "attended") return "success"
  if (status === "absent") return "danger"
  if (status === "excused") return "warning"
  return "default"
}

function draftFrom(row: AttendanceRow): Draft {
  return {
    status: row.status,
    attendanceMinutes: row.attendanceMinutes?.toString() ?? "",
    assessmentScore: row.assessmentScore?.toString() ?? "",
    excuseReason: row.excuseReason ?? "",
  }
}

export function SessionDetail({ session, course, attendance, canDeliver, canManage }: {
  session: SessionInfo
  course: CourseInfo
  attendance: AttendanceRow[]
  canDeliver: boolean
  canManage: boolean
}) {
  const closed = session.status === "completed" || session.status === "cancelled"
  const editable = canDeliver && !closed
  const assessmentRequired = course.assessmentType !== "none"

  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(
    () => Object.fromEntries(attendance.map((row) => [row.id, draftFrom(row)])),
  )
  const operation = useOperation()

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }))
  }

  function markAll(status: string) {
    setDrafts((current) => Object.fromEntries(
      Object.entries(current).map(([id, draft]) => [id, { ...draft, status }]),
    ))
  }

  function saveAttendance() {
    operation.run(() => recordTrainingAttendanceAction({
      sessionId: session.id,
      entries: attendance.map((row) => {
        const draft = drafts[row.id]!
        const minutes = draft.attendanceMinutes.trim()
        const score = draft.assessmentScore.trim()
        return {
          workerId: row.workerId,
          status: draft.status,
          attendanceMinutes: minutes ? Number(minutes) : null,
          assessmentScore: score ? Number(score) : null,
          excuseReason: draft.excuseReason.trim() || null,
        }
      }),
    }))
  }

  const pendingResult = attendance.filter((row) => drafts[row.id]?.status === "convened").length
  const attended = attendance.filter((row) => drafts[row.id]?.status === "attended").length

  const facts = [
    { label: "Estado", value: TRAINING_SESSION_STATUS_LABELS[session.status] ?? session.status },
    { label: "Tipo de curso", value: TRAINING_KIND_LABELS[course.kind] ?? course.kind },
    { label: "Modalidad", value: TRAINING_MODALITY_LABELS[session.modality] ?? session.modality },
    { label: "Programada", value: formatDateTime(session.scheduledAt) },
    { label: "Duración exigida", value: `${course.minimumDurationMinutes} min` },
    { label: "Duración dictada", value: session.durationMinutes ? `${session.durationMinutes} min` : "—" },
    { label: "Vigencia otorgada", value: course.validityMonths ? `${course.validityMonths} meses` : "Sin vencimiento" },
    { label: "Evaluación", value: assessmentRequired ? `Exigida · aprueba con ${course.passingScore}%` : "No exigida" },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm">
        <p><strong>Relator:</strong> {session.instructorExternalName ?? "Relator interno"}</p>
        <p className="mt-1 text-[var(--color-text-subtle)]">{session.instructorCompetencyEvidence}</p>
        {session.location && <p className="mt-1 text-[var(--color-text-subtle)]">Lugar: {session.location}</p>}
        {session.cancellationReason && (
          <p className="mt-2 text-[var(--color-danger)]">Cancelada: {session.cancellationReason}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Asistencia ({attendance.length} convocados)</h2>
          <Badge variant={statusBadgeVariant(session.status)}>
            {TRAINING_SESSION_STATUS_LABELS[session.status] ?? session.status}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && attendance.length > 0 && (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => markAll("attended")}>Marcar todos presentes</Button>
              <Button type="button" size="sm" variant="secondary" disabled={operation.pending} onClick={saveAttendance}>
                Guardar asistencia
              </Button>
            </>
          )}
          {canDeliver && !closed && (
            <CloseDialog session={session} course={course} pendingResult={pendingResult} attended={attended} />
          )}
          {canManage && session.status !== "completed" && session.status !== "cancelled" && (
            <CancelDialog session={session} />
          )}
        </div>
      </div>

      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}

      {attendance.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">
          Esta sesión no tiene convocados. Una sesión sin convocados no puede cerrarse.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead>Asistencia</TableHead>
                <TableHead className="text-right">Minutos</TableHead>
                {assessmentRequired && <TableHead className="text-right">Nota</TableHead>}
                <TableHead>Resultado</TableHead>
                <TableHead>Acuse</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendance.map((row) => {
                const draft = drafts[row.id]!
                return (
                  <React.Fragment key={row.id}>
                    <TableRow>
                      <TableCell>
                        <span className="block text-sm">{row.workerName}</span>
                        {row.workerPosition && (
                          <span className="text-xs text-[var(--color-text-subtle)]">{row.workerPosition}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <select
                            value={draft.status}
                            onChange={(event) => update(row.id, { status: event.target.value })}
                            className={selectClass}
                            aria-label={`Asistencia de ${row.workerName}`}
                          >
                            {Object.entries(TRAINING_ATTENDANCE_STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        ) : (
                          <Badge variant={attendanceBadgeVariant(row.status)}>
                            {TRAINING_ATTENDANCE_STATUS_LABELS[row.status] ?? row.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editable ? (
                          <Input
                            type="number" min={0} className="w-24 text-right"
                            value={draft.attendanceMinutes}
                            onChange={(event) => update(row.id, { attendanceMinutes: event.target.value })}
                            aria-label={`Minutos de ${row.workerName}`}
                          />
                        ) : (
                          <span className="font-mono text-sm tabular-nums">{row.attendanceMinutes ?? "—"}</span>
                        )}
                      </TableCell>
                      {assessmentRequired && (
                        <TableCell className="text-right">
                          {editable ? (
                            <Input
                              type="number" min={0} max={100} className="w-20 text-right"
                              value={draft.assessmentScore}
                              disabled={draft.status !== "attended"}
                              onChange={(event) => update(row.id, { assessmentScore: event.target.value })}
                              aria-label={`Nota de ${row.workerName}`}
                            />
                          ) : (
                            <span className="font-mono text-sm tabular-nums">{row.assessmentScore ?? "—"}</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-sm">
                        {TRAINING_ASSESSMENT_RESULT_LABELS[row.assessmentResult] ?? row.assessmentResult}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.acknowledgedAt ? formatDateTime(row.acknowledgedAt) : "Pendiente"}
                      </TableCell>
                    </TableRow>
                    {editable && draft.status === "excused" && (
                      <TableRow>
                        <TableCell colSpan={assessmentRequired ? 6 : 5} className="bg-[var(--color-surface-2)]">
                          <Field label={`Justificación de ${row.workerName}`} hint="Una ausencia justificada exige motivo. Mínimo 5 caracteres.">
                            <Textarea
                              value={draft.excuseReason}
                              onChange={(event) => update(row.id, { excuseReason: event.target.value })}
                              maxLength={1000}
                            />
                          </Field>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ── Cierre de sesión ─────────────────────────────────────────────────────── */

function CloseDialog({ session, course, pendingResult, attended }: {
  session: SessionInfo
  course: CourseInfo
  pendingResult: number
  attended: number
}) {
  const [open, setOpen] = React.useState(false)
  const [startedAt, setStartedAt] = React.useState(() => toLocalInputValue(new Date(session.scheduledAt)))
  const [endedAt, setEndedAt] = React.useState("")
  const operation = useOperation()

  // La duración dictada se calcula del par inicio/término, igual que en el
  // servicio, y se contrasta contra el mismo piso legal: así el bloqueo se ve
  // antes de enviar en vez de aparecer como error del servidor.
  const minutes = startedAt && endedAt
    ? Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000)
    : null
  const findings = minutes != null && minutes > 0
    ? assessLegalFloor({
      kind: course.kind,
      minimumDurationMinutes: course.minimumDurationMinutes,
      validityMonths: course.validityMonths,
      deliveredDurationMinutes: minutes,
    })
    : []

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    operation.run(() => closeTrainingSessionAction({
      sessionId: session.id,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      expectedVersion: session.version,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Cerrar sesión</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Cerrar sesión {session.code}</DialogTitle>
            <DialogDescription>
              El cierre otorga la competencia a quien asistió y aprobó la evaluación cuando el curso la exige.
              Una asistencia sin evaluación aprobada no habilita.
            </DialogDescription>
          </DialogHeader>

          {pendingResult > 0 && (
            <p className="rounded-md border border-[var(--color-warning)] p-3 text-sm">
              Hay {pendingResult} convocado(s) sin resultado de asistencia. Registra asistencia o ausencia antes de cerrar.
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Inicio real">
              <Input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} required />
            </Field>
            <Field label="Término real">
              <Input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} required />
            </Field>
          </div>

          {minutes != null && (
            <p className="text-sm">
              Duración dictada: <strong>{minutes > 0 ? `${minutes} min` : "el término debe ser posterior al inicio"}</strong>
              {minutes > 0 && ` · el curso exige ${course.minimumDurationMinutes} min`}
            </p>
          )}
          {findings.map((finding) => (
            <p key={finding.field} className="rounded-md border border-[var(--color-danger)] p-3 text-sm">{finding.message}</p>
          ))}

          <p className="text-sm text-[var(--color-text-subtle)]">
            Obtendrán competencia hasta {attended} persona(s), según su resultado de evaluación.
          </p>

          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending || pendingResult > 0 || findings.length > 0}>
              Cerrar y otorgar competencias
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Cancelación ──────────────────────────────────────────────────────────── */

function CancelDialog({ session }: { session: SessionInfo }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Cancelar sesión</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => cancelTrainingSessionAction({
              sessionId: session.id,
              reason: form.get("reason"),
              expectedVersion: session.version,
            }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Cancelar sesión {session.code}</DialogTitle>
            <DialogDescription>
              La sesión queda cancelada con el motivo en el historial. No se otorga ninguna competencia.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 5 caracteres.">
            <Textarea name="reason" required minLength={5} maxLength={2000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" variant="destructive" disabled={operation.pending}>Cancelar sesión</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
