"use client"

import * as React from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  assessRunCompletion,
  assessRunReview,
  criticalityBadgeVariant,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
  INSPECTION_KIND_LABELS,
  INSPECTION_RESULT_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
  runStatusBadgeVariant,
  summarizeCompliance,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import { formatDateTime } from "@/lib/utils"
import {
  completeInspectionRunAction,
  createFindingCapaAction,
  reviewInspectionRunAction,
  saveInspectionAnswersAction,
} from "../actions"
import { Field, useOperation } from "../inspection-form-kit"

interface RunInfo {
  id: string
  code: string
  status: string
  subjectType: string | null
  subjectLabel: string | null
  scheduledFor: string | null
  executedAt: string | null
  reviewedAt: string | null
  reviewComment: string | null
  conformingCount: number
  nonConformingCount: number
  notApplicableCount: number
  compliancePercent: number | null
  executedByUserId: string | null
  version: number
}

interface ItemInfo {
  id: string
  label: string
  required: boolean
  countsForCompliance: boolean
  danoPotencial: string | null
}

interface SectionInfo {
  id: string
  title: string
  items: ItemInfo[]
}

interface AnswerInfo {
  sectionId: string
  itemId: string
  result: string
  comment: string | null
}

interface FindingInfo {
  id: string
  description: string
  criticality: string
  status: string
  capaActionId: string | null
}

type ResultValue = "" | "conforming" | "non_conforming" | "not_applicable"
interface Draft { result: ResultValue; comment: string }

interface Props {
  run: RunInfo
  templateKind: string
  worksiteName: string
  assigneeName: string | null
  executorName: string | null
  reviewerName: string | null
  sections: SectionInfo[]
  answers: AnswerInfo[]
  findings: FindingInfo[]
  currentUserId: string
  assignees: { id: string; name: string }[]
  canExecute: boolean
  canReview: boolean
}

function draftKey(sectionId: string, itemId: string) {
  return `${sectionId}::${itemId}`
}

export function InspectionRunDetail({
  run, templateKind, worksiteName, assigneeName, executorName, reviewerName,
  sections, answers, findings, currentUserId, assignees, canExecute, canReview,
}: Props) {
  const editable = canExecute && ["planned", "in_progress"].includes(run.status)
  const items: InspectionItemSpec[] = React.useMemo(
    () => sections.flatMap((section) => section.items.map((item) => ({ ...item, sectionId: section.id, itemId: item.id }))),
    [sections],
  )

  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(() => {
    const initial: Record<string, Draft> = {}
    for (const answer of answers) {
      initial[draftKey(answer.sectionId, answer.itemId)] = { result: answer.result as ResultValue, comment: answer.comment ?? "" }
    }
    return initial
  })
  const operation = useOperation()

  function update(sectionId: string, itemId: string, patch: Partial<Draft>) {
    setDrafts((current) => {
      const key = draftKey(sectionId, itemId)
      return { ...current, [key]: { ...(current[key] ?? { result: "", comment: "" }), ...patch } }
    })
  }

  const currentAnswers: InspectionAnswerInput[] = React.useMemo(
    () => Object.entries(drafts)
      .filter(([, draft]) => draft.result !== "")
      .map(([key, draft]) => {
        const [sectionId, itemId] = key.split("::")
        return { sectionId: sectionId!, itemId: itemId!, result: draft.result as InspectionAnswerInput["result"], comment: draft.comment || null }
      }),
    [drafts],
  )

  const completion = React.useMemo(() => assessRunCompletion(items, currentAnswers), [items, currentAnswers])
  const summary = React.useMemo(() => summarizeCompliance(items, currentAnswers), [items, currentAnswers])
  const answeredCount = currentAnswers.length

  function saveAnswers() {
    operation.run(() => saveInspectionAnswersAction({
      runId: run.id,
      answers: currentAnswers,
    }))
  }

  const facts = [
    { label: "Estado", value: INSPECTION_RUN_STATUS_LABELS[run.status] ?? run.status },
    { label: "Tipo", value: INSPECTION_KIND_LABELS[templateKind] ?? templateKind },
    { label: "Faena", value: worksiteName },
    { label: "Sujeto", value: run.subjectType ? `${run.subjectType}${run.subjectLabel ? ` · ${run.subjectLabel}` : ""}` : run.subjectLabel ?? "—" },
    { label: "Asignada a", value: assigneeName ?? "Sin asignar" },
    { label: "Programada para", value: run.scheduledFor ?? "—" },
    { label: "Ejecutada por", value: executorName ? `${executorName} · ${formatDateTime(run.executedAt!)}` : "Sin ejecutar" },
    { label: "Cumplimiento", value: run.compliancePercent === null ? (summary.compliancePercent === null ? "No calculable" : `${summary.compliancePercent}% (previsto)`) : `${run.compliancePercent}%` },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-[var(--color-surface-1)] px-4 py-3">
            <span className="text-eyebrow">{fact.label}</span>
            <span className="mt-1 block text-sm font-medium">{fact.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={runStatusBadgeVariant(run.status)}>{INSPECTION_RUN_STATUS_LABELS[run.status] ?? run.status}</Badge>
          <span className="text-sm text-[var(--color-text-subtle)]">{answeredCount} de {items.length} ítems respondidos</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button type="button" size="sm" variant="secondary" disabled={operation.pending} onClick={saveAnswers}>
              Guardar respuestas
            </Button>
          )}
          {editable && <CompleteDialog run={run} completion={completion} />}
          {run.status === "completed" && canReview && (
            <ReviewDialog run={run} findings={findings} currentUserId={currentUserId} />
          )}
        </div>
      </div>

      {operation.message && <p role="status" className="text-sm">{operation.message}</p>}

      {editable && !completion.allowed && (
        <div className="rounded-md border border-[var(--color-warning-line)] bg-[var(--color-surface-2)] p-4 text-sm">
          <p className="font-medium">Aún no puede declararse ejecutada:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {completion.blockers.slice(0, 8).map((item, index) => <li key={index}>{item.detail}</li>)}
            {completion.blockers.length > 8 && <li>y {completion.blockers.length - 8} más…</li>}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.id} className="space-y-2">
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ítem</TableHead>
                    <TableHead className="w-44">Resultado</TableHead>
                    <TableHead>Comentario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.items.map((item) => {
                    const key = draftKey(section.id, item.id)
                    const draft = drafts[key] ?? { result: "" as ResultValue, comment: "" }
                    const needsComment = draft.result === "not_applicable"
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm">
                          {item.label}
                          {item.required && <Badge variant="outline" className="ml-2">Obligatorio</Badge>}
                        </TableCell>
                        <TableCell>
                          {editable ? (
                            <Select value={draft.result || "__unset__"} onValueChange={(v) => update(section.id, item.id, { result: (v === "__unset__" ? "" : v) as ResultValue })}>
                              <SelectTrigger aria-label={`Resultado de ${item.label}`}><SelectValue placeholder="Sin responder" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__unset__">Sin responder</SelectItem>
                                {Object.entries(INSPECTION_RESULT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : draft.result ? (
                            <Badge variant={draft.result === "non_conforming" ? "danger" : draft.result === "not_applicable" ? "outline" : "success"}>
                              {INSPECTION_RESULT_LABELS[draft.result] ?? draft.result}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {editable ? (
                            <Input
                              value={draft.comment}
                              onChange={(event) => update(section.id, item.id, { comment: event.target.value })}
                              placeholder={needsComment ? "Motivo por el que no aplica (mínimo 3 caracteres)" : "Opcional"}
                              aria-label={`Comentario de ${item.label}`}
                            />
                          ) : (
                            <span className="text-sm text-[var(--color-text-subtle)]">{draft.comment || "—"}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        ))}
      </div>

      {(run.status === "completed" || run.status === "reviewed") && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Hallazgos ({findings.length})</h2>
          {findings.length === 0 ? (
            <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin hallazgos: todos los ítems evaluables cumplieron.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hallazgo</TableHead>
                    <TableHead>Criticidad</TableHead>
                    <TableHead>Estado</TableHead>
                    {canExecute && <TableHead className="text-right">Acción</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findings.map((finding) => (
                    <TableRow key={finding.id}>
                      <TableCell className="text-sm">{finding.description}</TableCell>
                      <TableCell><Badge variant={criticalityBadgeVariant(finding.criticality)}>{FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}</Badge></TableCell>
                      <TableCell className="text-sm">
                        {FINDING_STATUS_LABELS[finding.status] ?? finding.status}
                        {finding.capaActionId && (
                          <Link href={`/prevencion/capa/${finding.capaActionId}`} className="ml-2 text-xs underline">Ver CAPA</Link>
                        )}
                      </TableCell>
                      {canExecute && (
                        <TableCell className="text-right">
                          {finding.status === "open" && <CapaDialog finding={finding} assignees={assignees} />}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {run.status === "reviewed" && run.reviewComment && (
        <p className="text-sm text-[var(--color-text-subtle)]">
          Revisada {formatDateTime(run.reviewedAt!)} por {reviewerName ?? "—"}: {run.reviewComment}
        </p>
      )}
    </div>
  )
}

/* ── Declarar ejecutada ───────────────────────────────────────────────────── */

function CompleteDialog({ run, completion }: {
  run: RunInfo
  completion: { allowed: boolean; blockers: { kind: string; detail: string }[] }
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Declarar ejecutada</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            operation.run(() => completeInspectionRunAction({ runId: run.id, expectedVersion: run.version }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Declarar ejecutada {run.code}</DialogTitle>
            <DialogDescription>
              Calcula el cumplimiento y materializa un hallazgo por cada incumplimiento. Guarda las respuestas antes de continuar.
            </DialogDescription>
          </DialogHeader>
          {!completion.allowed && (
            <div className="space-y-1 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">No se puede completar:</p>
              <ul className="list-disc space-y-1 pl-4">
                {completion.blockers.slice(0, 10).map((item, index) => <li key={index}>{item.detail}</li>)}
                {completion.blockers.length > 10 && <li>y {completion.blockers.length - 10} más…</li>}
              </ul>
            </div>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !completion.allowed}>Declarar ejecutada</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Derivar hallazgo a CAPA ──────────────────────────────────────────────── */

function CapaDialog({ finding, assignees }: { finding: FindingInfo; assignees: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [responsibleUserId, setResponsibleUserId] = React.useState("_none")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const responsibleUserId = String(form.get("responsibleUserId") ?? "").trim()
    const immediateMeasure = String(form.get("immediateMeasure") ?? "").trim()
    operation.run(() => createFindingCapaAction({
      findingId: finding.id,
      actionDescription: form.get("actionDescription"),
      responsibleUserId: responsibleUserId || null,
      immediateMeasure: immediateMeasure || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Derivar a CAPA</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Derivar hallazgo a CAPA</DialogTitle>
            <DialogDescription>{finding.description}</DialogDescription>
          </DialogHeader>
          <Field label="Acción correctiva" hint="Mínimo 3 caracteres.">
            <Textarea name="actionDescription" required minLength={3} maxLength={3000} />
          </Field>
          <Field label="Medida inmediata" hint="Opcional.">
            <Textarea name="immediateMeasure" maxLength={3000} />
          </Field>
          <Field label="Responsable" hint="Opcional.">
            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger><SelectContent><SelectItem value="_none">Sin asignar</SelectItem>{assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="responsibleUserId" value={responsibleUserId === "_none" ? "" : responsibleUserId} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Derivar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Revisar y cerrar ─────────────────────────────────────────────────────── */

function ReviewDialog({ run, findings, currentUserId }: { run: RunInfo; findings: FindingInfo[]; currentUserId: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()
  const review = React.useMemo(() => assessRunReview({
    executedByUserId: run.executedByUserId,
    reviewerUserId: currentUserId,
    findings: findings.map((item) => ({ id: item.id, description: item.description, criticality: item.criticality, capaActionId: item.capaActionId })),
  }), [run.executedByUserId, currentUserId, findings])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Revisar y cerrar</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => reviewInspectionRunAction({
              runId: run.id,
              expectedVersion: run.version,
              reviewComment: form.get("reviewComment"),
            }), () => setOpen(false))
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Revisar y cerrar {run.code}</DialogTitle>
            <DialogDescription>Exige independencia de quien ejecutó y que todo hallazgo alto o crítico tenga CAPA enlazada.</DialogDescription>
          </DialogHeader>
          {!review.allowed && (
            <div className="space-y-1 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">No se puede cerrar:</p>
              <ul className="list-disc space-y-1 pl-4">{review.blockers.map((item, index) => <li key={index}>{item.detail}</li>)}</ul>
            </div>
          )}
          <Field label="Comentario de revisión" hint="Mínimo 10 caracteres.">
            <Textarea name="reviewComment" required minLength={10} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !review.allowed}>Revisar y cerrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
