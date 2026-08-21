"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { MaintenanceForm, type MaintenanceDefaults } from "./maintenance-form"
import { transitionMaintenanceRecordAction, updateMaintenanceRecordAction } from "./actions"
import { toast } from "@/lib/toast"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MaintenanceTransition } from "@/lib/validation/maintenance"

interface Option {
  id: string
  name: string
}

interface VehicleOption {
  id: string
  plate: string
  type: string
  worksiteId: string
}

export function MaintenanceRowActions({
  record,
  vehicles,
  suppliers,
  costCenters,
  canViewCosts,
}: {
  record: MaintenanceDefaults & { id: string; status: string }
  vehicles: VehicleOption[]
  suppliers: Option[]
  costCenters: Array<Option & { code: string; worksiteId: string | null }>
  canViewCosts: boolean
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [pendingTransition, setPendingTransition] = useState<MaintenanceTransition | null>(null)
  const [reason, setReason] = useState("")
  const { pending, message, setMessage, run } = useOperation()

  function openTransition(transition: MaintenanceTransition) {
    setReason("")
    setMessage("")
    setPendingTransition(transition)
  }

  function handleTransition() {
    if (!pendingTransition) return
    run(
      async () => {
        try {
          return await transitionMaintenanceRecordAction({
            id: record.id,
            expectedStatus: record.status,
            transition: pendingTransition,
            reason,
          })
        } catch {
          return { ok: false, message: "No se pudo cambiar el estado. Reintenta." }
        }
      },
      (result) => {
        setPendingTransition(null)
        toast.success(result.message ?? "Estado actualizado")
      },
    )
  }

  const transitionCopy = pendingTransition ? TRANSITION_COPY[pendingTransition] : null

  return (
    <div className="flex justify-end gap-1">
      {(record.status === "scheduled" || record.status === "in_progress") && <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost">Editar</Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Editar mantención</DialogTitle></DialogHeader>
          <MaintenanceForm
            vehicles={vehicles}
            suppliers={suppliers}
            costCenters={costCenters}
            canViewCosts={canViewCosts}
            action={updateMaintenanceRecordAction}
            submitLabel="Guardar"
            defaults={record}
            onSuccess={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>}

      {record.status === "scheduled" && <Button size="sm" variant="secondary" onClick={() => openTransition("start")}>Iniciar</Button>}
      {(record.status === "scheduled" || record.status === "in_progress") && (
        <Button size="sm" variant="primary" onClick={() => openTransition("complete")}>Completar</Button>
      )}
      {record.status === "completed" && <Button size="sm" variant="secondary" onClick={() => openTransition("reopen")}>Reabrir</Button>}
      {record.status !== "cancelled" && (
        <Button size="sm" variant="destructive" onClick={() => openTransition("cancel")}>Cancelar</Button>
      )}

      <Dialog open={pendingTransition !== null} onOpenChange={(open) => !open && setPendingTransition(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{transitionCopy?.title}</DialogTitle></DialogHeader>
          <p className="text-sm text-[var(--color-text-muted)]">{transitionCopy?.description}</p>
          <div>
            <Label htmlFor={`maintenance-transition-reason-${record.id}`} required>Motivo</Label>
            <Textarea
              id={`maintenance-transition-reason-${record.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Registra el antecedente operacional de este cambio"
            />
            {message && <p className="mt-1 text-xs text-[var(--color-danger-ink)]">{message}</p>}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingTransition(null)} disabled={pending}>Volver</Button>
            <Button
              variant={pendingTransition === "cancel" ? "destructive" : "primary"}
              onClick={handleTransition}
              disabled={pending || reason.trim().length < 5}
            >
              {pending ? "Guardando..." : transitionCopy?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const TRANSITION_COPY: Record<MaintenanceTransition, { title: string; description: string; confirm: string }> = {
  start: {
    title: "Iniciar mantención",
    description: "La orden pasará a En curso. El motivo quedará en la auditoría.",
    confirm: "Iniciar mantención",
  },
  complete: {
    title: "Completar mantención",
    description: "La orden quedará completada y, si proviene de una inspección, acreditará evidencia CAPA vigente.",
    confirm: "Completar mantención",
  },
  reopen: {
    title: "Reabrir mantención",
    description: "La orden volverá a En curso y su evidencia CAPA se conservará como supersedida, sin acreditar el cierre.",
    confirm: "Reabrir mantención",
  },
  cancel: {
    title: "Cancelar mantención",
    description: "La orden dejará de sumar al costo de flota. Si estaba completada, su evidencia CAPA se supersederá sin eliminar el historial.",
    confirm: "Cancelar mantención",
  },
}
