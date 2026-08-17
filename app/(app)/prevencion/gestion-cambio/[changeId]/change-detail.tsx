"use client"

import * as React from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  CHANGE_DIMENSION_LABELS,
  CHANGE_RISK_LEVEL_LABELS,
  CHANGE_STATUS_LABELS,
  CHANGE_TYPE_LABELS,
} from "@/lib/prevention/change"
import {
  approveChangeRequestAction,
  evaluateChangeDimensionAction,
  rejectChangeRequestAction,
} from "../actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

interface RequestInfo {
  id: string
  code: string
  title: string
  changeType: string
  description: string
  reason: string
  riskLevel: string
  status: string
  plannedReviewDate: string | null
  rejectedReason: string | null
  requestedByUserId: string
  version: number
}

interface AssessmentInfo {
  id: string
  dimension: string
  evaluated: boolean
  impacted: boolean
  notes: string | null
  actionRequired: boolean
  capaActionId: string | null
}

interface Props {
  request: RequestInfo
  worksiteName: string
  readiness: { ready: boolean; blockers: string[] }
  assessments: AssessmentInfo[]
  assignees: { id: string; name: string }[]
  currentUserId: string
  canEvaluate: boolean
  canApprove: boolean
}

export function ChangeDetail({
  request, worksiteName, readiness, assessments, assignees, currentUserId, canEvaluate, canApprove,
}: Props) {
  const isOpen = request.status === "draft" || request.status === "under_evaluation"
  const canDecide = canApprove && isOpen && request.requestedByUserId !== currentUserId

  const facts = [
    { label: "Estado", value: CHANGE_STATUS_LABELS[request.status] ?? request.status },
    { label: "Faena", value: worksiteName },
    { label: "Tipo", value: CHANGE_TYPE_LABELS[request.changeType] ?? request.changeType },
    { label: "Riesgo", value: CHANGE_RISK_LEVEL_LABELS[request.riskLevel] ?? request.riskLevel },
    { label: "Fecha de revisión", value: request.plannedReviewDate ?? "Sin declarar" },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      <div className="space-y-1 text-sm">
        <p><span className="font-medium">Descripción:</span> {request.description}</p>
        <p><span className="font-medium">Motivo:</span> {request.reason}</p>
        {request.status === "rejected" && request.rejectedReason && (
          <p className="text-[var(--color-danger-ink)]"><span className="font-medium">Motivo de rechazo:</span> {request.rejectedReason}</p>
        )}
      </div>

      {isOpen && !readiness.ready && (
        <div className="rounded-md border border-[var(--color-warning-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">El cambio no puede aprobarse todavía:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      )}

      {isOpen && canDecide && (
        <div className="flex items-center gap-2">
          <ApproveDialog changeRequestId={request.id} version={request.version} ready={readiness.ready} />
          <RejectDialog changeRequestId={request.id} version={request.version} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Dimensiones de impacto</h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dimensión</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Impacta</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead>Acción</TableHead>
                {canEvaluate && isOpen && <TableHead className="text-right">Evaluar</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assessments.map((assessment) => (
                <TableRow key={assessment.id}>
                  <TableCell className="text-sm font-medium">{CHANGE_DIMENSION_LABELS[assessment.dimension as keyof typeof CHANGE_DIMENSION_LABELS] ?? assessment.dimension}</TableCell>
                  <TableCell>
                    <Badge variant={assessment.evaluated ? "success" : "outline"}>{assessment.evaluated ? "Evaluada" : "Pendiente"}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{assessment.evaluated ? (assessment.impacted ? "Sí" : "No") : "—"}</TableCell>
                  <TableCell className="max-w-xs text-sm text-[var(--color-text-subtle)]">{assessment.notes ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {assessment.capaActionId
                      ? <Link href={`/prevencion/capa/${assessment.capaActionId}`} className="text-[var(--color-primary-ink)] hover:underline">Ver acción CAPA</Link>
                      : assessment.actionRequired ? "Requiere acción" : "—"}
                  </TableCell>
                  {canEvaluate && isOpen && (
                    <TableCell className="text-right">
                      <EvaluateDialog changeRequestId={request.id} assessment={assessment} assignees={assignees} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

/* ── Evaluación de dimensión ──────────────────────────────────────────────── */

function EvaluateDialog({ changeRequestId, assessment, assignees }: {
  changeRequestId: string
  assessment: AssessmentInfo
  assignees: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [impacted, setImpacted] = React.useState(assessment.impacted)
  const [actionRequired, setActionRequired] = React.useState(assessment.actionRequired)
  const [responsibleUserId, setResponsibleUserId] = React.useState("_none")
  const [priority, setPriority] = React.useState("medium")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const notes = String(form.get("notes") ?? "").trim()
    const actionDescription = String(form.get("actionDescription") ?? "").trim()
    const targetDate = String(form.get("targetDate") ?? "").trim()
    operation.run(() => evaluateChangeDimensionAction({
      changeRequestId,
      dimension: assessment.dimension,
      impacted,
      notes: notes || null,
      actionRequired,
      actionDescription: actionRequired ? actionDescription : null,
      responsibleUserId: actionRequired ? (responsibleUserId === "_none" ? null : responsibleUserId) : null,
      priority,
      targetDate: actionRequired ? (targetDate || null) : null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">{assessment.evaluated ? "Reevaluar" : "Evaluar"}</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{CHANGE_DIMENSION_LABELS[assessment.dimension as keyof typeof CHANGE_DIMENSION_LABELS] ?? assessment.dimension}</DialogTitle>
            <DialogDescription>Si el cambio requiere una acción nueva en esta dimensión, se deriva a CAPA con responsable y plazo.</DialogDescription>
          </DialogHeader>
          <Checkbox label="El cambio impacta esta dimensión" checked={impacted} onChange={(event) => setImpacted(event.target.checked)} />
          <Field label="Notas" hint="Opcional."><Textarea name="notes" defaultValue={assessment.notes ?? ""} maxLength={3000} /></Field>
          {/* Requerir una acción implica declarar la dimensión impactada: es lo
              que exige `prevention_change_assessment_impact_consistent` y lo que
              valida `evaluateSchema`. Marcarla aquí evita ofrecer una
              combinación que el servidor va a rechazar igual. */}
          <Checkbox label="Requiere una acción correctiva o preventiva nueva" checked={actionRequired} onChange={(event) => { setActionRequired(event.target.checked); if (event.target.checked) setImpacted(true) }} />
          {actionRequired && (
            <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
              <Field label="Descripción de la acción">
                <Textarea name="actionDescription" required minLength={3} maxLength={3000} />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Responsable" hint="Opcional.">
                  <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
                    <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sin asignar</SelectItem>
                      {assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="responsibleUserId" value={responsibleUserId === "_none" ? "" : responsibleUserId} />
                </Field>
                <Field label="Prioridad">
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baja</SelectItem>
                      <SelectItem value="medium">Media</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="critical">Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="priority" value={priority} />
                </Field>
              </div>
              <Field label="Plazo" required><DatePicker name="targetDate" /></Field>
            </div>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Guardar evaluación</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Aprobación ────────────────────────────────────────────────────────────── */

function ApproveDialog({ changeRequestId, version, ready }: { changeRequestId: string; version: number; ready: boolean }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => approveChangeRequestAction({
      changeRequestId, expectedVersion: version, plannedReviewDate: form.get("plannedReviewDate"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" disabled={!ready}>Aprobar cambio</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Aprobar cambio</DialogTitle>
            <DialogDescription>Declara cuándo se revisará si la evaluación siguió siendo válida.</DialogDescription>
          </DialogHeader>
          {/* Acotada entre mañana y 24 meses, que es lo mismo que valida
              `approveSchema`: no ofrecer una fecha que el servidor rechaza, y
              tampoco el "año 2199" con el que se cumplía el requisito sin
              comprometerse a nada (MOC-05). Desde que la fecha alimenta la
              bandeja de Prevención, elegirla tiene consecuencias. */}
          <Field label="Fecha de revisión posterior" required hint="Entre mañana y 24 meses. Llegado el día, el cambio aparece en la bandeja de Prevención.">
            <DatePicker
              name="plannedReviewDate"
              min={addDaysToPlainDate(todayInChile(), 1)}
              max={addDaysToPlainDate(todayInChile(), 730)}
            />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Aprobar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Rechazo ───────────────────────────────────────────────────────────────── */

function RejectDialog({ changeRequestId, version }: { changeRequestId: string; version: number }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => rejectChangeRequestAction({
      changeRequestId, expectedVersion: version, rejectedReason: form.get("rejectedReason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Rechazar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rechazar cambio</DialogTitle>
            <DialogDescription>Explica el motivo del rechazo.</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 5 caracteres."><Textarea name="rejectedReason" required minLength={5} maxLength={3000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" variant="destructive" disabled={operation.pending}>Rechazar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
