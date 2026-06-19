"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from "@/components/ui/dialog"
import { toast } from "@/lib/toast"
import { saveActionPlanItemAction, deleteActionPlanItemAction } from "@/app/(app)/prevencion/actions"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ESTADO_OPTIONS, ESTADO_LABELS, estadoPlanBadgeVariant } from "@/lib/sst/badges"
import type { SstActionPlan } from "@/db/schema/sst"
import { Trash, Plus, ListBullets } from "@phosphor-icons/react"

interface Props {
  evaluationId: string
  items: SstActionPlan[]
  readOnly: boolean
  onUpdate: (items: SstActionPlan[]) => void
}

interface DraftItem {
  n: number
  hallazgo: string
  accion: string
  responsable: string
  plazo: string
  estado: string
}

const EMPTY_DRAFT: Omit<DraftItem, "n"> = {
  hallazgo: "", accion: "", responsable: "", plazo: "", estado: "pendiente",
}

export function ActionPlanPanel({ evaluationId, items, readOnly, onUpdate }: Props) {
  const [isPending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Omit<DraftItem, "n"> | null>(null)
  // id of the row pending delete confirmation, null = none
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  function handleAddRow() {
    setDraft({ ...EMPTY_DRAFT })
  }

  function handleCancelDraft() {
    setDraft(null)
  }

  function handleSaveDraft() {
    if (!draft) return
    if (!draft.hallazgo.trim())    return toast.error("Ingresa el hallazgo")
    if (!draft.accion.trim())      return toast.error("Ingresa la acción")
    if (!draft.responsable.trim()) return toast.error("Ingresa el responsable")
    if (!draft.plazo.trim())       return toast.error("Ingresa el plazo")

    const n = items.length > 0 ? Math.max(...items.map(i => i.n)) + 1 : 1

    startTransition(async () => {
      const result = await saveActionPlanItemAction({
        evaluationId,
        n,
        hallazgo:    draft.hallazgo,
        accion:      draft.accion,
        responsable: draft.responsable,
        plazo:       draft.plazo,
        estado:      draft.estado,
      })
      if (!result.ok) {
        toast.error(result.message ?? "Error al guardar")
        return
      }
      const newItem: SstActionPlan = {
        id: `temp-${Date.now()}`,
        evaluationId,
        n,
        hallazgo:    draft.hallazgo,
        accion:      draft.accion,
        responsable: draft.responsable,
        plazo:       draft.plazo,
        estado:      draft.estado,
      }
      onUpdate([...items, newItem])
      setDraft(null)
    })
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return
    const id = deleteTarget
    setDeleteTarget(null)
    startTransition(async () => {
      const result = await deleteActionPlanItemAction(id)
      if (!result.ok) {
        toast.error(result.message ?? "Error al eliminar")
        return
      }
      onUpdate(items.filter((i) => i.id !== id))
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-(--color-text)">Plan de Acción Correctiva</h3>
        {!readOnly && (
          <Button size="sm" variant="secondary" onClick={handleAddRow} disabled={isPending || !!draft}>
            <Plus size={14} weight="bold" className="mr-1" />
            Agregar ítem
          </Button>
        )}
      </div>

      {items.length === 0 && !draft && (
        <EmptyState
          compact
          icon={<ListBullets size={20} />}
          title="Plan vacío"
          description="Sin ítems en el plan de acción."
        />
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-(--color-border)">
                <th className="py-2 px-3 text-left text-xs font-medium text-text-subtle w-8">#</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-text-subtle">Hallazgo</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-text-subtle">Acción</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-text-subtle">Responsable</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-text-subtle">Plazo</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-text-subtle">Estado</th>
                {!readOnly && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-(--color-border) hover:bg-surface-2">
                  <td className="py-2 px-3 text-text-subtle">{item.n}</td>
                  <td className="py-2 px-3">{item.hallazgo}</td>
                  <td className="py-2 px-3">{item.accion}</td>
                  <td className="py-2 px-3">{item.responsable}</td>
                  <td className="py-2 px-3">{item.plazo}</td>
                  <td className="py-2 px-3">
                    <Badge variant={estadoPlanBadgeVariant(item.estado)}>
                      {ESTADO_LABELS[item.estado] ?? item.estado}
                    </Badge>
                  </td>
                  {!readOnly && (
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item.id)}
                        disabled={isPending}
                        className="text-text-subtle hover:text-danger disabled:opacity-50"
                        aria-label={`Eliminar ítem ${item.n}`}
                      >
                        <Trash size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="rounded-(--radius-lg) border border-(--color-border) bg-surface-2 p-4 space-y-3">
          <p className="text-xs font-semibold text-text-subtle uppercase tracking-wide">Nuevo ítem</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Hallazgo" htmlFor="draft-hallazgo">
              <Input
                id="draft-hallazgo"
                value={draft.hallazgo}
                onChange={(e) => setDraft({ ...draft, hallazgo: e.target.value })}
                maxLength={500}
              />
            </Field>
            <Field label="Acción correctiva" htmlFor="draft-accion">
              <Input
                id="draft-accion"
                value={draft.accion}
                onChange={(e) => setDraft({ ...draft, accion: e.target.value })}
                maxLength={500}
              />
            </Field>
            <Field label="Responsable" htmlFor="draft-responsable">
              <Input
                id="draft-responsable"
                value={draft.responsable}
                onChange={(e) => setDraft({ ...draft, responsable: e.target.value })}
                maxLength={150}
              />
            </Field>
            <Field label="Plazo" htmlFor="draft-plazo">
              <Input
                id="draft-plazo"
                type="date"
                value={draft.plazo}
                onChange={(e) => setDraft({ ...draft, plazo: e.target.value })}
              />
            </Field>
            <Field label="Estado" htmlFor="draft-estado">
              <Select value={draft.estado} onValueChange={(v) => setDraft({ ...draft, estado: v })}>
                <SelectTrigger id="draft-estado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTADO_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveDraft} disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar ítem"}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancelDraft} disabled={isPending}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar ítem</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-(--color-text-muted) py-2">
            ¿Confirmas que deseas eliminar este ítem del plan de acción? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2 justify-end">
            <DialogClose asChild>
              <Button variant="ghost" disabled={isPending}>Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isPending}>
              {isPending ? "Eliminando…" : "Eliminar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
