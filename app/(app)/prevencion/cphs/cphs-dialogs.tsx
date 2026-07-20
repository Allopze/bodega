"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { closeManagementReviewAction, constituteCommitteeAction, createManagementReviewAction } from "./actions"
import { Field, selectClass, toLocalInputValue, useOperation } from "./cphs-form-kit"

/* ── Alta de comité ───────────────────────────────────────────────────────── */

export function NewCommitteeDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const meetingDay = String(form.get("meetingDayOfMonth") ?? "").trim()
    operation.run(() => constituteCommitteeAction({
      worksiteId: form.get("worksiteId"),
      name: form.get("name"),
      constitutedOn: form.get("constitutedOn"),
      mandateEndsOn: form.get("mandateEndsOn"),
      meetingDayOfMonth: meetingDay ? Number(meetingDay) : null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nuevo comité</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Constituir comité paritario</DialogTitle>
            <DialogDescription>
              Un centro de trabajo admite un solo comité vigente. La paridad entre representantes y las
              designaciones de presidencia y secretaría se sostienen al incorporar integrantes.
            </DialogDescription>
          </DialogHeader>
          <Field label="Faena">
            <select name="worksiteId" className={selectClass} required>
              {worksites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Nombre"><Input name="name" required minLength={3} maxLength={200} placeholder="CPHS Faena Central" /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Constituido el"><Input name="constitutedOn" type="date" required /></Field>
            <Field label="Mandato hasta" hint="Debe ser posterior a la constitución."><Input name="mandateEndsOn" type="date" required /></Field>
          </div>
          <Field label="Día de sesión mensual" hint="Opcional. Día del mes (1-28) en que suele convocarse.">
            <Input name="meetingDayOfMonth" type="number" min={1} max={28} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Constituir</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Alta de revisión por la dirección ────────────────────────────────────── */

export function NewReviewDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [defaultValue, setDefaultValue] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const worksiteId = String(form.get("worksiteId") ?? "").trim()
    operation.run(() => createManagementReviewAction({
      worksiteId: worksiteId || null,
      periodLabel: form.get("periodLabel"),
      heldAt: new Date(String(form.get("heldAt"))).toISOString(),
      inputs: {},
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (value) setDefaultValue(toLocalInputValue(new Date())); setOpen(value) }}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Nueva revisión por la dirección</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva revisión por la dirección</DialogTitle>
            <DialogDescription>Nace en preparación. El art. 22 exige evaluar el sistema, no sólo dejar constancia de la reunión.</DialogDescription>
          </DialogHeader>
          <Field label="Período" hint="Ej: 1er semestre 2026."><Input name="periodLabel" required minLength={4} maxLength={60} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Faena" hint="Vacío = revisión de toda la organización.">
              <select name="worksiteId" className={selectClass} defaultValue="">
                <option value="">Toda la organización</option>
                {worksites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Realizada el"><Input name="heldAt" type="datetime-local" required defaultValue={defaultValue} /></Field>
          </div>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Cierre de revisión por la dirección ──────────────────────────────────── */

interface Commitment {
  description: string
  actionDescription: string
  responsibleUserId: string
  worksiteId: string
  priority: "low" | "medium" | "high" | "critical"
  targetDate: string
}

export function CloseReviewDialog({ review, worksites, assignees }: {
  review: { id: string; code: string; version: number }
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [commitments, setCommitments] = React.useState<Commitment[]>([])
  const operation = useOperation()

  function addCommitment() {
    setCommitments((current) => [...current, {
      description: "", actionDescription: "", responsibleUserId: "",
      worksiteId: worksites[0]?.id ?? "", priority: "medium", targetDate: "",
    }])
  }

  function update(index: number, patch: Partial<Commitment>) {
    setCommitments((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const resourceDecisions = String(form.get("resourceDecisions") ?? "").trim()
    operation.run(() => closeManagementReviewAction({
      reviewId: review.id,
      expectedVersion: review.version,
      conclusions: form.get("conclusions"),
      resourceDecisions: resourceDecisions || null,
      commitments: commitments.map((item) => ({
        description: item.description,
        actionDescription: item.actionDescription,
        responsibleUserId: item.responsibleUserId || null,
        worksiteId: item.worksiteId,
        priority: item.priority,
        targetDate: item.targetDate,
      })),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Cerrar revisión</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cerrar {review.code}</DialogTitle>
            <DialogDescription>Los compromisos con plazo se derivan a CAPA común para tener seguimiento real.</DialogDescription>
          </DialogHeader>
          <Field label="Conclusiones" hint="Mínimo 20 caracteres.">
            <Textarea name="conclusions" required minLength={20} maxLength={20_000} />
          </Field>
          <Field label="Decisiones de recursos" hint="Opcional."><Textarea name="resourceDecisions" maxLength={10_000} /></Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Compromisos</span>
              <Button type="button" variant="secondary" size="sm" onClick={addCommitment}>Agregar compromiso</Button>
            </div>
            {commitments.map((item, index) => (
              <div key={index} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Compromiso {index + 1}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCommitments((current) => current.filter((_, i) => i !== index))}>
                    Quitar
                  </Button>
                </div>
                <Field label="Descripción" hint="Mínimo 5 caracteres.">
                  <Textarea value={item.description} required minLength={5} maxLength={3000}
                    onChange={(event) => update(index, { description: event.target.value })} />
                </Field>
                <Field label="Acción" hint="Mínimo 3 caracteres.">
                  <Textarea value={item.actionDescription} required minLength={3} maxLength={3000}
                    onChange={(event) => update(index, { actionDescription: event.target.value })} />
                </Field>
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="Faena">
                    <select value={item.worksiteId} onChange={(event) => update(index, { worksiteId: event.target.value })} className={selectClass} required>
                      {worksites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Responsable" hint="Opcional.">
                    <select value={item.responsibleUserId} onChange={(event) => update(index, { responsibleUserId: event.target.value })} className={selectClass}>
                      <option value="">Sin asignar</option>
                      {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="Prioridad">
                    <select value={item.priority} onChange={(event) => update(index, { priority: event.target.value as Commitment["priority"] })} className={selectClass}>
                      <option value="low">Baja</option>
                      <option value="medium">Media</option>
                      <option value="high">Alta</option>
                      <option value="critical">Crítica</option>
                    </select>
                  </Field>
                  <Field label="Plazo">
                    <Input type="date" value={item.targetDate} required onChange={(event) => update(index, { targetDate: event.target.value })} />
                  </Field>
                </div>
              </div>
            ))}
          </div>

          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Cerrar revisión</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
