"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  cancelCommitteeMeetingAction,
  dissolveCommitteeAction,
  replaceCommitteeMemberAction,
  resignCommitteeMemberAction,
} from "../actions"

interface WorkerOption {
  id: string
  name: string
  position: string | null
}

/* ── Disolver comité ──────────────────────────────────────────────────────── */

export function DissolveCommitteeDialog({ committeeId, version }: { committeeId: string; version: number }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => dissolveCommitteeAction({
      committeeId,
      expectedVersion: version,
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="destructive">Disolver comité</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Disolver el comité</DialogTitle>
            <DialogDescription>
              Es distinto de dejar vencer el mandato: queda registrado como un acto con motivo, no como una fecha que pasó.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" htmlFor="dissolve-reason" hint="Mínimo 10 caracteres.">
            <Textarea id="dissolve-reason" name="reason" required minLength={10} maxLength={1000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" variant="destructive" disabled={operation.pending}>Disolver</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Renuncia de integrante ───────────────────────────────────────────────── */

export function ResignMemberDialog({ memberId, workerName }: { memberId: string; workerName: string }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => resignCommitteeMemberAction({
      memberId,
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Renuncia</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Renuncia de {workerName}</DialogTitle>
            <DialogDescription>El asiento queda vacante. La paridad puede pasar a reportarse incumplida hasta cubrirlo.</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" htmlFor="resign-reason" hint="Mínimo 10 caracteres.">
            <Textarea id="resign-reason" name="reason" required minLength={10} maxLength={1000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Registrar renuncia</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Reemplazo de integrante ──────────────────────────────────────────────── */

export function ReplaceMemberDialog({ memberId, workerName, eligibleWorkers, existingMemberNames }: {
  memberId: string
  workerName: string
  eligibleWorkers: WorkerOption[]
  existingMemberNames: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const existing = new Set(existingMemberNames)
  const available = eligibleWorkers.filter((worker) => !existing.has(worker.name))
  const [workerId, setWorkerId] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const electedOn = String(form.get("electedOn") ?? "").trim()
    const termEndsOn = String(form.get("termEndsOn") ?? "").trim()
    operation.run(() => replaceCommitteeMemberAction({
      memberId,
      workerId: form.get("workerId"),
      reason: form.get("reason"),
      electedOn: electedOn || null,
      termEndsOn: termEndsOn || null,
    }), () => { setOpen(false); setWorkerId("") })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Reemplazar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Reemplazar a {workerName}</DialogTitle>
            <DialogDescription>La misma silla, con otra persona: hereda representación, asiento y cargo.</DialogDescription>
          </DialogHeader>
          {available.length === 0 ? (
            <p className="text-sm text-[var(--color-text-subtle)]">Toda la dotación elegible ya integra el comité.</p>
          ) : (
            <>
              <Field label="Reemplazante">
                <OptionSelect
                  id="replace-worker"
                  name="workerId"
                  value={workerId}
                  onValueChange={setWorkerId}
                  placeholder="Selecciona persona"
                  options={available.map((worker) => ({
                    value: worker.id,
                    label: worker.position ? `${worker.name} · ${worker.position}` : worker.name,
                  }))}
                />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Electo el" hint="Opcional."><DatePicker name="electedOn" /></Field>
                <Field label="Término del período" hint="Opcional."><DatePicker name="termEndsOn" /></Field>
              </div>
            </>
          )}
          <Field label="Motivo" htmlFor="replace-reason" hint="Mínimo 10 caracteres.">
            <Textarea id="replace-reason" name="reason" required minLength={10} maxLength={1000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending || !workerId}>Reemplazar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Cancelar sesión ──────────────────────────────────────────────────────── */

export function CancelMeetingDialog({ meetingId, code, version }: { meetingId: string; code: string; version: number }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => cancelCommitteeMeetingAction({
      meetingId,
      expectedVersion: version,
      reason: form.get("reason"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Cancelar</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Cancelar {code}</DialogTitle>
            <DialogDescription>Una convocatoria que no se realizó se cancela con motivo; no se borra.</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" htmlFor="cancel-meeting-reason" hint="Mínimo 10 caracteres.">
            <Textarea id="cancel-meeting-reason" name="reason" required minLength={10} maxLength={1000} rows={3} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Cancelar sesión</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
