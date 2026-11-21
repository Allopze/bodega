"use client"

import * as React from "react"
import { Buildings } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { FLEET_OWNER_KINDS, FLEET_OWNER_KIND_LABELS, type FleetOwnerKind } from "@/lib/fleet/fleet-owner-kinds"
import { saveVehicleOwnershipAction } from "../../actions"
import { loadVehicleOwnershipAction, type VehicleOwnershipPayload } from "./edit-vehicle-action"

const NONE = "__none__"
const NEW = "__new__"

/**
 * «Propietario y ubicación» de la cabecera de la ficha (Trinorma): la empresa dueña del equipo, que se
 * elige del catálogo o se crea en línea, y la casilla «Ubicación por confirmar». Ninguna de las dos
 * cambia la faena del equipo; esa sólo se mueve con «Trasladar equipos». Pide los datos al abrir.
 */
export function VehicleOwnershipButton({ vehicleId }: { vehicleId: string }) {
  const [payload, setPayload] = React.useState<VehicleOwnershipPayload | null>(null)
  const [open, setOpen] = React.useState(false)
  const [openCount, setOpenCount] = React.useState(0)
  const { pending, run } = useOperation()

  function openEditor() {
    run(
      async () => {
        const result = await loadVehicleOwnershipAction(vehicleId)
        if (!result.ok) return result
        setPayload(result.data)
        setOpenCount((count) => count + 1)
        setOpen(true)
        return { ok: true }
      },
      () => undefined,
      (failure) => toast.error(failure.message ?? "No se pudo abrir el formulario. Inténtalo de nuevo."),
    )
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openEditor} disabled={pending} aria-busy={pending || undefined}>
        <Buildings size={14} aria-hidden />
        {pending ? "Abriendo…" : "Propietario y ubicación"}
      </Button>
      {payload ? (
        <OwnershipDialog key={openCount} vehicleId={vehicleId} payload={payload} open={open} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

function OwnershipDialog({ vehicleId, payload, open, onClose }: {
  vehicleId: string
  payload: VehicleOwnershipPayload
  open: boolean
  onClose: () => void
}) {
  const [owner, setOwner] = React.useState(payload.ownerId ?? NONE)
  const [newName, setNewName] = React.useState("")
  const [newKind, setNewKind] = React.useState<FleetOwnerKind | "">("")
  const [pendingLocation, setPendingLocation] = React.useState(payload.locationPendingConfirmation)
  const { pending, message, fieldError, run } = useOperation()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    run(
      () => saveVehicleOwnershipAction({
        vehicleId,
        ownerId: owner === NONE || owner === NEW ? null : owner,
        newOwner: owner === NEW ? { name: newName, kind: newKind } : null,
        locationPendingConfirmation: pendingLocation,
      }),
      (result) => { toast.success(result.message ?? "Guardado"); onClose() },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propietario y ubicación</DialogTitle>
          <DialogDescription>
            La empresa dueña del equipo no cambia su faena ni a quién se le imputa el costo. Para cambiar la faena usa «Trasladar equipos».
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Empresa propietaria" htmlFor="veh-owner">
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger id="veh-owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin informar</SelectItem>
                {payload.owners.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name} · {FLEET_OWNER_KIND_LABELS[item.kind]}</SelectItem>
                ))}
                <SelectItem value={NEW}>Otra empresa…</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {owner === NEW ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre de la empresa" htmlFor="veh-owner-name" required error={fieldError("newOwnerName")}>
                <Input id="veh-owner-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} />
              </Field>
              <Field label="Tipo de empresa" htmlFor="veh-owner-kind" required error={fieldError("newOwnerKind")}>
                <Select value={newKind} onValueChange={(value) => setNewKind(value as FleetOwnerKind)}>
                  <SelectTrigger id="veh-owner-kind"><SelectValue placeholder="Elige el tipo" /></SelectTrigger>
                  <SelectContent>
                    {FLEET_OWNER_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>{FLEET_OWNER_KIND_LABELS[kind]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}

          <Checkbox
            id="veh-location-pending"
            checked={pendingLocation}
            onChange={(event) => setPendingLocation(event.target.checked)}
            label="Ubicación por confirmar"
          />
          <p className="-mt-2 pl-6 text-xs text-[var(--color-text-muted)]">
            Marca que la faena de origen está registrada, pero falta confirmar dónde está el equipo hoy.
          </p>

          {message ? <p role="alert" className="text-sm text-[var(--color-danger)]">{message}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={pending || (owner === NEW && (newName.trim().length < 2 || !newKind))}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
