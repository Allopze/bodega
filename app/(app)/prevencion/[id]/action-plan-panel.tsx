"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/lib/toast"
import { saveActionPlanItemAction, deleteActionPlanItemAction } from "@/app/(app)/prevencion/actions"
import type { SstActionPlan } from "@/db/schema/sst"
import { Trash, Plus } from "@phosphor-icons/react"

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

  function handleAddRow() {
    setDraft({ ...EMPTY_DRAFT })
  }

  function handleCancelDraft() {
    setDraft(null)
  }

  function handleSaveDraft() {
    if (!draft) return
    if (!draft.hallazgo.trim()) return toast.error("Ingresa el hallazgo")
    if (!draft.accion.trim())   return toast.error("Ingresa la acción")
    if (!draft.responsable.trim()) return toast.error("Ingresa el responsable")
    if (!draft.plazo.trim())    return toast.error("Ingresa el plazo")

    const n = items.length + 1

    startTransition(async () => {
      const result = await saveActionPlanItemAction({
        evaluationId,
        n,
        hallazgo: draft.hallazgo,
        accion: draft.accion,
        responsable: draft.responsable,
        plazo: draft.plazo,
        estado: draft.estado,
      })
      if (!result.ok) {
        toast.error(result.message ?? "Error al guardar")
        return
      }
      // Optimistic add — the server revalidates the page but we update local state too
      const newItem: SstActionPlan = {
        id: `temp-${Date.now()}`,
        evaluationId,
        n,
        hallazgo: draft.hallazgo,
        accion: draft.accion,
        responsable: draft.responsable,
        plazo: draft.plazo,
        estado: draft.estado,
      }
      onUpdate([...items, newItem])
      setDraft(null)
    })
  }

  function handleDelete(id: string) {
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
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Plan de Acción Correctiva</h3>
        {!readOnly && (
          <Button size="sm" variant="secondary" onClick={handleAddRow} disabled={isPending || !!draft}>
            <Plus size={14} weight="bold" className="mr-1" />
            Agregar ítem
          </Button>
        )}
      </div>

      {items.length === 0 && !draft && (
        <p className="text-sm text-[var(--color-text-subtle)] italic">Sin ítems en el plan de acción.</p>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="py-2 px-3 text-left text-xs font-medium text-[var(--color-text-subtle)] w-8">#</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-[var(--color-text-subtle)]">Hallazgo</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-[var(--color-text-subtle)]">Acción</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-[var(--color-text-subtle)]">Responsable</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-[var(--color-text-subtle)]">Plazo</th>
                <th className="py-2 px-3 text-left text-xs font-medium text-[var(--color-text-subtle)]">Estado</th>
                {!readOnly && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">
                  <td className="py-2 px-3 text-[var(--color-text-subtle)]">{item.n}</td>
                  <td className="py-2 px-3">{item.hallazgo}</td>
                  <td className="py-2 px-3">{item.accion}</td>
                  <td className="py-2 px-3">{item.responsable}</td>
                  <td className="py-2 px-3">{item.plazo}</td>
                  <td className="py-2 px-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                      {item.estado}
                    </span>
                  </td>
                  {!readOnly && (
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        disabled={isPending}
                        className="text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] disabled:opacity-50"
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
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 space-y-3">
          <p className="text-xs font-semibold text-[var(--color-text-subtle)] uppercase tracking-wide">Nuevo ítem</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-[var(--color-text-subtle)]">Hallazgo</label>
              <Input value={draft.hallazgo} onChange={(e) => setDraft({ ...draft, hallazgo: e.target.value })} maxLength={500} />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-subtle)]">Acción correctiva</label>
              <Input value={draft.accion} onChange={(e) => setDraft({ ...draft, accion: e.target.value })} maxLength={500} />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-subtle)]">Responsable</label>
              <Input value={draft.responsable} onChange={(e) => setDraft({ ...draft, responsable: e.target.value })} maxLength={150} />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-subtle)]">Plazo</label>
              <Input type="date" value={draft.plazo} onChange={(e) => setDraft({ ...draft, plazo: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-subtle)]">Estado</label>
              <Input value={draft.estado} onChange={(e) => setDraft({ ...draft, estado: e.target.value })} maxLength={50} />
            </div>
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
    </div>
  )
}
