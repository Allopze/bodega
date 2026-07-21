"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { CHANGE_TYPE_LABELS } from "@/lib/prevention/change"
import { createChangeRequestAction } from "./actions"
import { Field, useOperation } from "./change-form-kit"

const CHANGE_TYPES = Object.keys(CHANGE_TYPE_LABELS)

export function NewChangeDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [changeType, setChangeType] = React.useState("_none")
  const [riskLevel, setRiskLevel] = React.useState("medium")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    operation.run(() => createChangeRequestAction({
      worksiteId,
      title: form.get("title"),
      changeType: changeType === "_none" ? "" : changeType,
      description: form.get("description"),
      reason: form.get("reason"),
      riskLevel,
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
            <Select value={worksiteId} onValueChange={setWorksiteId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Título"><Input name="title" required minLength={3} maxLength={200} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Tipo de cambio">
              <Select value={changeType} onValueChange={setChangeType}>
                <SelectTrigger><SelectValue placeholder="Selecciona un tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none" className="hidden">Selecciona un tipo</SelectItem>
                  {CHANGE_TYPES.map((type) => <SelectItem key={type} value={type}>{CHANGE_TYPE_LABELS[type]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Nivel de riesgo">
              <Select value={riskLevel} onValueChange={setRiskLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Bajo</SelectItem>
                  <SelectItem value="medium">Medio</SelectItem>
                  <SelectItem value="high">Alto</SelectItem>
                  <SelectItem value="critical">Crítico</SelectItem>
                </SelectContent>
              </Select>
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
