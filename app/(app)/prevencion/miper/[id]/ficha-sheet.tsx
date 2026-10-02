"use client"

import { useState } from "react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { AntecedentesForm } from "./antecedentes-form"

/**
 * «Ficha del documento» (spec §5.7): los antecedentes RE-04 dejan de ser una
 * pestaña. Al guardar se cierra (el toast lo da la acción); cerrar con cambios
 * sin guardar pide confirmación.
 */
export function FichaSheet({ open, onClose, workspace, editable }: { open: boolean; onClose: () => void; workspace: MiperWorkspace; editable: boolean }) {
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const close = () => { setDirty(false); setConfirming(false); onClose() }
  return (
    <>
      <Sheet open={open} onOpenChange={(next) => { if (next) return; if (dirty) setConfirming(true); else close() }}>
        <SheetContent className="w-full sm:max-w-3xl">
          <SheetHeader>
            <div className="min-w-0">
              <SheetTitle>Ficha del documento</SheetTitle>
              <SheetDescription>Antecedentes del RE-04: identificación, dotación y responsables.</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody><AntecedentesForm workspace={workspace} editable={editable} onSaved={close} onDirtyChange={setDirty} /></SheetBody>
        </SheetContent>
      </Sheet>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title="¿Cerrar sin guardar?"
        description="Hay antecedentes sin guardar. Si cierras la ficha ahora, se pierden."
        confirmLabel="Cerrar sin guardar" cancelLabel="Seguir editando" variant="warning" onConfirm={close} />
    </>
  )
}
