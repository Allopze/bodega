"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { toast } from "@/lib/toast"
import type { PreventionIncident, PreventionIncidentAction } from "@/db/schema"
import {
  addIncidentActionAction,
  closeIncidentActionAction,
  closeIncidentActionFlow,
} from "../actions"

interface WorkerSummary {
  firstName: string
  lastName: string
  rut: string | null
}

interface Props {
  incident: PreventionIncident
  actions: PreventionIncidentAction[]
  worker: WorkerSummary | null
  canManage: boolean
  canClose: boolean
  hasPending: boolean
}

const STATUS_BADGE: Record<string, "default" | "success" | "danger" | "warning"> = {
  pendiente: "warning",
  en_curso: "default",
  cerrada:   "success",
  cancelada: "default",
}

const STATUS_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso:  "En curso",
  cerrada:   "Cerrada",
  cancelada: "Cancelada",
}

export function IncidentDetail({ incident, actions, worker, canManage, canClose, hasPending }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [newAction, setNewAction] = React.useState(() => {
    const today = new Date()
    today.setDate(today.getDate() + 7)
    return {
      description: "",
      responsible: "",
      dueDate: today.toISOString().slice(0, 10),
    }
  })

  async function onAddAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newAction.description || !newAction.responsible) {
      toast.error("Completa descripción y responsable.")
      return
    }
    setSubmitting(true)
    const result = await addIncidentActionAction({
      incidentId: incident.id,
      description: newAction.description,
      responsible: newAction.responsible,
      dueDate: newAction.dueDate,
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success("Acción correctiva agregada.")
    setNewAction({ description: "", responsible: "", dueDate: newAction.dueDate })
    router.refresh()
  }

  async function onCloseAction(actionId: string, final: "cerrada" | "cancelada") {
    const result = await closeIncidentActionAction(actionId, final)
    if (!result.ok) toast.error(result.message)
    else { toast.success(`Acción ${STATUS_LABEL[final]}.`); router.refresh() }
  }

  async function onCloseIncident() {
    const result = await closeIncidentActionFlow(incident.id)
    if (!result.ok) toast.error(result.message)
    else { toast.success("Incidente cerrado."); router.refresh() }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
        <h2 className="mb-3 text-eyebrow">Información</h2>
        <FieldGroup>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wide">Trabajador</p>
              <p className="text-sm">
                {worker ? `${worker.firstName} ${worker.lastName}`.trim() : "—"}
                {worker?.rut ? <span className="ml-2 font-mono text-xs text-[var(--color-text-subtle)]">{worker.rut}</span> : null}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wide">Estado</p>
              <Badge variant={incident.status === "closed" ? "success" : "default"}>
                {incident.status === "closed" ? "Cerrado" : incident.status === "open" ? "Abierto" : "En investigación"}
              </Badge>
            </div>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wide">Descripción</p>
            <p className="text-sm whitespace-pre-wrap">{incident.description}</p>
          </div>
          {incident.immediateCause ? (
            <div>
              <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wide">Causa inmediata</p>
              <p className="text-sm whitespace-pre-wrap">{incident.immediateCause}</p>
            </div>
          ) : null}
          {incident.rootCause ? (
            <div>
              <p className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wide">Causa raíz</p>
              <p className="text-sm whitespace-pre-wrap">{incident.rootCause}</p>
            </div>
          ) : null}
        </FieldGroup>
      </section>

      <section>
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-eyebrow">Acciones correctivas</h2>
          {canClose && incident.status !== "closed" && !hasPending ? (
            <Button onClick={onCloseIncident}>Cerrar incidente</Button>
          ) : null}
        </header>

        {canManage ? (
          <form onSubmit={onAddAction} className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
            <FieldGroup>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Responsable" htmlFor="act-resp" required>
                  <Input
                    id="act-resp"
                    value={newAction.responsible}
                    onChange={(e) => setNewAction((a) => ({ ...a, responsible: e.target.value }))}
                    required
                  />
                </Field>
                <Field label="Plazo" htmlFor="act-due" required>
                  <Input
                    id="act-due"
                    type="date"
                    value={newAction.dueDate}
                    onChange={(e) => setNewAction((a) => ({ ...a, dueDate: e.target.value }))}
                    required
                  />
                </Field>
              </div>
              <Field label="Descripción" htmlFor="act-desc" required>
                <Textarea
                  id="act-desc"
                  rows={2}
                  value={newAction.description}
                  onChange={(e) => setNewAction((a) => ({ ...a, description: e.target.value }))}
                  required
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Agregando…" : "Agregar acción"}
                </Button>
              </div>
            </FieldGroup>
          </form>
        ) : null}

        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Acción</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Plazo</TableHead>
                <TableHead>Estado</TableHead>
                {canManage ? <TableHead><span className="sr-only">Acciones</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 5 : 4} className="text-center text-[var(--color-text-subtle)]">
                    Sin acciones correctivas registradas.
                  </TableCell>
                </TableRow>
              ) : null}
              {actions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.description}</TableCell>
                  <TableCell>{a.responsible}</TableCell>
                  <TableCell className="font-mono text-xs">{a.dueDate}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[a.status] ?? "default"}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      {a.status !== "cerrada" && a.status !== "cancelada" ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => onCloseAction(a.id, "cerrada")}>
                            Cerrar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => onCloseAction(a.id, "cancelada")}>
                            Cancelar
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      </section>
    </div>
  )
}