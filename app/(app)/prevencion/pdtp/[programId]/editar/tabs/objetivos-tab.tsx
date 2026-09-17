"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { countOf } from "@/lib/utils"
import {
  upsertPdtpObjectiveAction,
  deletePdtpObjectiveAction,
  reorderPdtpObjectivesAction,
} from "../../../actions"
import type { PdtpObjective } from "@/lib/services/prevention-pdtp"
import type { PdtpActivityRow } from "./types"

/**
 * Catálogo de objetivos del programa: alta, edición, borrado y reorden. El
 * conteo de actividades por objetivo ayuda a detectar objetivos huérfanos
 * (sin ninguna actividad asignada) sin salir de esta tabla.
 */
export function ObjetivosTab({ programId, objectives, activities }: {
  programId: string
  objectives: PdtpObjective[]
  activities: PdtpActivityRow[]
}) {
  const router = useRouter()

  // Igual que en ActividadesTab: `objectives` cambia de identidad en cada
  // render del padre, así que un efecto con esa dependencia descartaría el
  // reordenamiento optimista en curso. Se compara por contenido.
  const [items, setItems] = React.useState(objectives)
  const savedObjectives = JSON.stringify(objectives)
  const [lastSaved, setLastSaved] = React.useState(savedObjectives)
  if (lastSaved !== savedObjectives) {
    setLastSaved(savedObjectives)
    setItems(objectives)
  }

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<PdtpObjective | null>(null)
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)
  const [formPending, setFormPending] = React.useState(false)

  const [deleting, setDeleting] = React.useState<PdtpObjective | null>(null)
  const [deletePending, setDeletePending] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [reorderError, setReorderError] = React.useState<string | null>(null)

  const countByObjective = new Map<string, number>()
  for (const activity of activities) {
    if (!activity.objectiveId) continue
    countByObjective.set(activity.objectiveId, (countByObjective.get(activity.objectiveId) ?? 0) + 1)
  }
  const unassignedCount = activities.length - activities.filter((activity) => activity.objectiveId).length

  function openCreate() {
    setEditing(null)
    setCode("")
    setName("")
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(objective: PdtpObjective) {
    setEditing(objective)
    setCode(objective.code)
    setName(objective.name)
    setFormError(null)
    setFormOpen(true)
  }

  async function handleSave() {
    setFormPending(true)
    setFormError(null)
    try {
      const result = await upsertPdtpObjectiveAction({
        programId,
        id: editing?.id,
        code,
        name,
      })
      if (!result.ok) {
        setFormError(result.message ?? "No se pudo guardar el objetivo.")
      } else {
        setFormOpen(false)
        router.refresh()
      }
    } finally {
      setFormPending(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setDeletePending(true)
    setDeleteError(null)
    try {
      const result = await deletePdtpObjectiveAction({ programId, objectiveId: deleting.id })
      if (!result.ok) {
        setDeleteError(result.message ?? "No se pudo eliminar el objetivo.")
      } else {
        setDeleting(null)
        router.refresh()
      }
    } finally {
      setDeletePending(false)
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setItems(next)
    setBusyId(next[target]!.id)
    setReorderError(null)
    try {
      const result = await reorderPdtpObjectivesAction({ programId, orderedIds: next.map((objective) => objective.id) })
      if (!result.ok) {
        setReorderError(result.message ?? "No se pudo reordenar.")
        setItems(objectives)
      } else {
        router.refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-h3 text-[var(--color-text)]">Objetivos del programa</h3>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Agrupan las actividades para el reporte por objetivo. Sin objetivos, el programa se ve igual que hoy.
          </p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>Agregar objetivo</Button>
      </div>

      {reorderError && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {reorderError}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          compact
          title="Sin objetivos definidos"
          description="Agrega el primer objetivo para poder asignarlo a las actividades y filtrarlas por objetivo."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <TableRoot className="rounded-none border-0">
            <Table className="text-sm">
              <caption className="sr-only">Objetivos del programa PDTP</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-40 text-right">Actividades</TableHead>
                  <TableHead className="w-48 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((objective, index) => (
                  <TableRow key={objective.id}>
                    <TableCell className="font-mono text-xs text-[var(--color-text-subtle)]">{objective.code}</TableCell>
                    <TableCell className="font-medium text-[var(--color-text)]">{objective.name}</TableCell>
                    <TableCell className="text-right text-[var(--color-text-muted)]">
                      {countOf(countByObjective.get(objective.id) ?? 0, "actividad")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || index === 0} onClick={() => move(index, -1)} aria-label="Subir">↑</Button>
                        <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || index === items.length - 1} onClick={() => move(index, 1)} aria-label="Bajar">↓</Button>
                        <Button type="button" variant="ghost" size="sm" disabled={busyId !== null} onClick={() => openEdit(objective)}>Editar</Button>
                        <Button type="button" variant="ghost" size="sm" disabled={busyId !== null} onClick={() => { setDeleteError(null); setDeleting(objective) }}>Eliminar</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </div>
      )}

      {items.length > 0 && unassignedCount > 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          {countOf(unassignedCount, "actividad")} sin objetivo asignado todavía. Se asignan desde la fila de cada actividad, en la pestaña Actividades.
        </p>
      )}

      <Dialog open={formOpen} onOpenChange={(open) => { if (!open) setFormOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Editar objetivo ${editing.code}` : "Agregar objetivo"}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-3">
            <Field label="Código" htmlFor="objective-code" required helper="Identifica al objetivo dentro de este programa; no se repite.">
              <Input id="objective-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={20} required />
            </Field>
            <Field label="Nombre" htmlFor="objective-name" required>
              <Input id="objective-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={300} required />
            </Field>
            {formError && (
              <p role="alert" className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
                {formError}
              </p>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)} disabled={formPending}>Cancelar</Button>
            <Button type="button" onClick={handleSave} disabled={formPending || !code.trim() || !name.trim()}>
              {formPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        title={deleting ? `Eliminar el objetivo ${deleting.code}` : "Eliminar objetivo"}
        description={
          deleting && (countByObjective.get(deleting.id) ?? 0) > 0
            ? `${countOf(countByObjective.get(deleting.id) ?? 0, "actividad")} quedarán sin objetivo asignado. Esta acción no se puede deshacer.`
            : "Esta acción no se puede deshacer."
        }
        confirmLabel="Eliminar definitivamente"
        variant="destructive"
        loading={deletePending}
        onConfirm={handleDelete}
      />
      {deleteError && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {deleteError}
        </p>
      )}
    </div>
  )
}
