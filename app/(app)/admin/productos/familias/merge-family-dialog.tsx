"use client"

import * as React from "react"
import { ArrowsMerge } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { mergeEppFamiliesAction } from "./actions"

interface Props {
  /** Familia que desaparece: sus productos pasan al destino. */
  source: { id: string; name: string } | null
  candidates: { id: string; name: string }[]
  onClose: () => void
}

/**
 * `updateEppFamilyAction` ya decía "fusiónalas" al chocar la identidad, y la
 * única forma era un script de CLI. Este diálogo cierra ese callejón.
 */
export function MergeFamilyDialog({ source, candidates, onClose }: Props) {
  const [targetId, setTargetId] = React.useState("")
  const [pending, setPending] = React.useState(false)

  const targets = React.useMemo(
    () => candidates.filter((c) => c.id !== source?.id),
    [candidates, source?.id],
  )

  function handleMerge() {
    if (!source || !targetId) return
    setPending(true)
    mergeEppFamiliesAction(source.id, targetId)
      .then((result) => {
        if (result.ok) {
          toast.success(result.message ?? "Familias fusionadas")
          onClose()
        } else {
          toast.error(result.message ?? "No se pudo fusionar")
        }
      })
      .finally(() => setPending(false))
  }

  return (
    <Dialog open={!!source} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fusionar familia</DialogTitle>
          <DialogDescription>
            Las variantes de «{source?.name}» pasan a la familia de destino y esta familia se elimina.
            El historial de entregas se conserva porque cuelga del producto, no de la familia.
          </DialogDescription>
        </DialogHeader>

        <Field
          label="Familia de destino"
          htmlFor="merge-target"
          helper="Los campos de ficha que el destino tenga vacíos se completan con los de esta familia. Los que ya tenga no se tocan."
        >
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger id="merge-target"><SelectValue placeholder="Elegir familia" /></SelectTrigger>
            <SelectContent>
              {targets.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={handleMerge} disabled={!targetId || pending}>
            <ArrowsMerge size={15} />{pending ? "Fusionando..." : "Fusionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
