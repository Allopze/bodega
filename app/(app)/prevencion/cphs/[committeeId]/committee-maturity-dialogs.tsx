"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { useOperation } from "@/lib/hooks/use-operation"
import { addMeetingGuestAction, markAgendaSentAction, markMinutesSentToManagementAction } from "../actions"

interface WorkerOption {
  id: string
  name: string
  position: string | null
}

/* ── Tabla previa (Plata) ─────────────────────────────────────────────────── */

export function MarkAgendaSentButton({ meetingId }: { meetingId: string }) {
  const operation = useOperation()
  return (
    <Button
      size="sm" variant="ghost" disabled={operation.pending}
      onClick={() => operation.run(() => markAgendaSentAction({ meetingId }))}
    >
      Marcar tabla enviada
    </Button>
  )
}

/* ── Envío del acta a la administración (Oro) ─────────────────────────────── */

export function MarkMinutesSentButton({ meetingId }: { meetingId: string }) {
  const operation = useOperation()
  return (
    <Button
      size="sm" variant="ghost" disabled={operation.pending}
      onClick={() => operation.run(() => markMinutesSentToManagementAction({ meetingId }))}
    >
      Enviar acta a gerencia
    </Button>
  )
}

/* ── Invitado no integrante (Plata) ───────────────────────────────────────── */

export function AddGuestDialog({ meetingId, eligibleWorkers }: { meetingId: string; eligibleWorkers: WorkerOption[] }) {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<"worker" | "external">("worker")
  const [workerId, setWorkerId] = React.useState("")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const guestName = String(form.get("guestName") ?? "").trim()
    operation.run(() => addMeetingGuestAction({
      meetingId,
      workerId: mode === "worker" ? workerId : null,
      guestName: mode === "external" ? guestName : null,
    }), () => { setOpen(false); setWorkerId("") })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Agregar invitado</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Agregar invitado</DialogTitle>
            <DialogDescription>Una persona trabajadora que no integra el comité, invitada a esta sesión.</DialogDescription>
          </DialogHeader>
          <Field label="Origen">
            <OptionSelect
              id="guest-mode"
              value={mode}
              onValueChange={(value) => setMode(value as "worker" | "external")}
              options={[
                { value: "worker", label: "Trabajador de la faena" },
                { value: "external", label: "Otra persona" },
              ]}
            />
          </Field>
          {mode === "worker" ? (
            <Field label="Persona">
              <OptionSelect
                id="guest-worker"
                value={workerId}
                onValueChange={setWorkerId}
                placeholder="Selecciona persona"
                options={eligibleWorkers.map((worker) => ({
                  value: worker.id,
                  label: worker.position ? `${worker.name} · ${worker.position}` : worker.name,
                }))}
              />
            </Field>
          ) : (
            <Field label="Nombre" htmlFor="guest-name" hint="Mínimo 3 caracteres.">
              <Input id="guest-name" name="guestName" required minLength={3} maxLength={200} />
            </Field>
          )}
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending || (mode === "worker" && !workerId)}>Agregar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
