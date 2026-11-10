"use client"

import * as React from "react"
import { PencilSimple, Power } from "@phosphor-icons/react"
import { setSparePartActiveAction } from "@/app/(app)/mantencion/repuestos/actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { SparePartFormSheet, type SparePartFormValues, type SparePartUnitOption } from "./spare-part-form-sheet"

interface SparePartDetailActionsProps {
  part: SparePartFormValues & { isActive: boolean }
  /** Unidades activas, para el formulario de edición. */
  units: SparePartUnitOption[]
}

/**
 * «Editar» y «Desactivar»/«Activar» de la ficha. Desactivar pide confirmación porque cambia lo que ven los demás
 * (deja de ofrecerse al pedir un repuesto); activar de nuevo no la pide: es lo que se quiere casi siempre y se
 * deshace igual de fácil. Los botones se arman aquí, en el cliente, y no los recibe la página (ver la nota de
 * `SheetTrigger` en `@/components/ui/sheet`).
 */
export function SparePartDetailActions({ part, units }: SparePartDetailActionsProps) {
  const [editOpen, setEditOpen] = React.useState(false)
  const [editKey, setEditKey] = React.useState(0)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const operation = useOperation()

  function setActive(active: boolean) {
    operation.run(
      () => setSparePartActiveAction({ id: part.id, active }),
      (result) => {
        setConfirmOpen(false)
        toast.success(result.message ?? (active ? "Repuesto activado" : "Repuesto desactivado"))
      },
      // Desactivar falla dentro del diálogo (sigue abierto); activar no tiene diálogo donde decirlo.
      (result) => { if (active) toast.error(result.message ?? "No se pudo activar el repuesto.") },
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => { setEditKey((key) => key + 1); setEditOpen(true) }}>
        <PencilSimple size={14} aria-hidden />Editar
      </Button>
      {part.isActive ? (
        <Button size="sm" variant="secondary" onClick={() => { operation.setMessage(""); setConfirmOpen(true) }}>
          <Power size={14} aria-hidden />Desactivar
        </Button>
      ) : (
        <Button size="sm" variant="secondary" loading={operation.pending} onClick={() => setActive(true)}>
          <Power size={14} aria-hidden />Activar
        </Button>
      )}

      <SparePartFormSheet key={editKey} open={editOpen} onClose={() => setEditOpen(false)} part={part} units={units} />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Desactivar ${part.name}`}
        description="Deja de ofrecerse al pedir repuestos y al armar órdenes de compra. Su historial de compras y de precios se conserva y puedes activarlo de nuevo cuando quieras."
        confirmLabel="Desactivar"
        variant="warning"
        loading={operation.pending}
        error={operation.messageTone === "error" ? operation.message : undefined}
        onConfirm={() => setActive(false)}
      />
    </div>
  )
}
