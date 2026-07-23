"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createEmergencyPlanAction } from "./actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"

export function NewPlanDialog({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const operation = useOperation()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const description = String(form.get("description") ?? "").trim()
    operation.run(() => createEmergencyPlanAction({
      worksiteId: form.get("worksiteId"),
      title: form.get("title"),
      description: description || null,
    }), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Nuevo plan</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo plan de emergencia</DialogTitle>
            <DialogDescription>
              Nace en preparación. Aprobarlo exige declarar al menos un escenario y un rol del organigrama de emergencia.
            </DialogDescription>
          </DialogHeader>
          <Field label="Faena">
            <Select value={worksiteId} onValueChange={setWorksiteId}><SelectTrigger><SelectValue placeholder="Selecciona faena" /></SelectTrigger><SelectContent>{worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="worksiteId" value={worksiteId} />
          </Field>
          <Field label="Título"><Input name="title" required minLength={3} maxLength={200} placeholder="Plan de emergencia Faena Central" /></Field>
          <Field label="Descripción" hint="Opcional."><Textarea name="description" maxLength={5000} /></Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>Crear</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
