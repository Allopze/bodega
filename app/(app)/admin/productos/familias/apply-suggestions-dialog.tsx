"use client"

import * as React from "react"
import { Sparkle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { MetaBadge } from "@/components/states/state-badge"
import { toast } from "@/lib/toast"
import { applyEppTypeSuggestionsAction } from "./actions"

export interface EppTypeSuggestion {
  familyId: string
  familyName: string
  eppTypeId: string
  eppTypeLabel: string
}

interface Props {
  suggestions: EppTypeSuggestion[]
  open: boolean
  onClose: () => void
}

/**
 * Revisión de las sugerencias de tipo antes de escribirlas.
 *
 * La clasificación no se automatiza porque un tipo equivocado acredita al
 * trabajador en la zona corporal errónea, pero revisar una tabla y confirmar es
 * mucho menos trabajo que corregir familia por familia. Todas vienen marcadas:
 * desmarcar es para lo que la persona ve mal, no para lo que ve bien.
 */
export function ApplySuggestionsDialog({ suggestions, open, onClose }: Props) {
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set())
  const [pending, setPending] = React.useState(false)

  const selected = suggestions.filter((s) => !excluded.has(s.familyId))

  function toggle(familyId: string) {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(familyId)) next.delete(familyId)
      else next.add(familyId)
      return next
    })
  }

  function handleApply() {
    if (selected.length === 0) return
    setPending(true)
    applyEppTypeSuggestionsAction(selected.map((s) => ({ familyId: s.familyId, eppTypeId: s.eppTypeId })))
      .then((result) => {
        if (result.ok) {
          toast.success(result.message ?? "Sugerencias aplicadas")
          onClose()
        } else {
          toast.error(result.message ?? "No se pudieron aplicar")
        }
      })
      .finally(() => setPending(false))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Revisar sugerencias de tipo</DialogTitle>
          <DialogDescription>
            El tipo se deduce del nombre de la familia. Confírmalo: de él depende contra qué
            requisito acredita cada entrega, y un tipo equivocado acredita al trabajador en la
            zona corporal errónea.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {suggestions.map((s) => (
            <div key={s.familyId} className="flex items-center justify-between gap-3 px-3 py-2">
              <Checkbox
                checked={!excluded.has(s.familyId)}
                onChange={() => toggle(s.familyId)}
                label={<span className="text-sm text-[var(--color-text)]">{s.familyName}</span>}
              />
              <MetaBadge meta={{ label: s.eppTypeLabel, variant: "info" }} />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={handleApply} disabled={selected.length === 0 || pending}>
            <Sparkle size={15} />
            {pending ? "Aplicando..." : `Clasificar ${selected.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
