"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CHANGE_TYPE_LABELS } from "@/lib/prevention/change"
import { createChangeRequestAction } from "./actions"
import { Field, selectClass, useOperation } from "./change-form-kit"

const CHANGE_TYPES = Object.keys(CHANGE_TYPE_LABELS)

export function NewChangeDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createChangeRequestAction({
      worksiteId: form.get("worksiteId"),
      title: form.get("title"),
      changeType: form.get("changeType"),
      description: form.get("description"),
      reason: form.get("reason"),
      riskLevel: form.get("riskLevel"),
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nuevo cambio</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva solicitud de gestión del cambio</DialogTitle>
            <DialogDescription>
              Nace con las seis dimensiones de impacto pendientes de evaluar. Aprobarla exige evaluarlas todas y declarar una fecha de revisión posterior.
            </DialogDescription>
          </DialogHeader>
          <Field label="Faena">
            <select name="worksiteId" className={selectClass} required>
              {worksites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Título"><Input name="title" required minLength={3} maxLength={200} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de cambio">
              <select name="changeType" className={selectClass} required defaultValue="">
                <option value="" disabled>Selecciona un tipo</option>
                {CHANGE_TYPES.map((type) => <option key={type} value={type}>{CHANGE_TYPE_LABELS[type]}</option>)}
              </select>
            </Field>
            <Field label="Nivel de riesgo">
              <select name="riskLevel" className={selectClass} defaultValue="medium">
                <option value="low">Bajo</option>
                <option value="medium">Medio</option>
                <option value="high">Alto</option>
                <option value="critical">Crítico</option>
              </select>
            </Field>
          </div>
          <Field label="Descripción del cambio" hint="Mínimo 10 caracteres.">
            <Textarea name="description" required minLength={10} maxLength={5000} />
          </Field>
          <Field label="Motivo" hint="Mínimo 5 caracteres.">
            <Textarea name="reason" required minLength={5} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
