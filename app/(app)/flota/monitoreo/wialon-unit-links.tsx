"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LinkSimple, LinkBreak } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRoot,
  TableRow,
} from "@/components/ui/table"
import { useOperation } from "@/lib/hooks/use-operation"
import type { LinkableVehicle, WialonLinkableUnit } from "@/lib/services/fleet-gps"
import { formatDateTime } from "@/lib/utils"
import { linkWialonUnitAction, unlinkWialonUnitAction } from "./actions"

/**
 * Unidades Wialon y su vehículo. Las que calzan por patente/código se muestran
 * como «vinculadas por identidad»; las que no, se resuelven a mano y el link
 * se conserva entre corridas. El desvínculo sólo borra el link manual, nunca
 * un vehículo ni una lectura.
 */
export function WialonUnitLinks({ units, vehicles }: {
  units: WialonLinkableUnit[]
  vehicles: LinkableVehicle[]
}) {
  const router = useRouter()
  const [active, setActive] = useState<WialonLinkableUnit | null>(null)
  const [vehicleId, setVehicleId] = useState("")
  const [pendingUnlink, setPendingUnlink] = useState<WialonLinkableUnit | null>(null)
  const link = useOperation({ feedback: "toast", onSuccess: () => {
    setActive(null)
    setVehicleId("")
    router.refresh()
  } })
  const unlink = useOperation({ feedback: "toast", onSuccess: () => {
    setPendingUnlink(null)
    router.refresh()
  } })

  const options = vehicles.map((vehicle) => ({
    value: vehicle.id,
    label: `${vehicle.plate}${vehicle.code ? ` · ${vehicle.code}` : ""}`,
    hint: vehicle.worksiteName,
  }))

  if (units.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        No hay unidades Wialon en la última lectura. Ejecuta «Actualizar ahora» para poblarlas.
      </p>
    )
  }

  return (
    <>
      <TableRoot framed={false}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unidad Wialon</TableHead>
              <TableHead>Última lectura</TableHead>
              <TableHead>Vehículo</TableHead>
              <TableHead><span className="sr-only">Acción</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((unit) => (
              <TableRow key={unit.unitId}>
                <TableCell>
                  <div className="font-medium">{unit.unitName}</div>
                  <div className="font-mono text-xs text-[var(--color-text-subtle)]">{unit.unitId}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDateTime(unit.gpsReportedAt ?? unit.observedAt)}
                </TableCell>
                <TableCell>
                  {unit.plate ? (
                    <span>{unit.plate}{unit.code ? ` · ${unit.code}` : ""}</span>
                  ) : (
                    <span className="text-[var(--color-warning-ink)]">Sin vincular</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!unit.vehicleId ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => {
                      setActive(unit)
                      setVehicleId("")
                    }}>
                      <LinkSimple size={14} aria-hidden />
                      Vincular
                    </Button>
                  ) : unit.manualLinkId ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPendingUnlink(unit)}>
                      <LinkBreak size={14} aria-hidden />
                      Desvincular
                    </Button>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs text-[var(--color-text-subtle)]">Vinculado por patente o código</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => {
                        setActive(unit)
                        setVehicleId(unit.vehicleId ?? "")
                      }}>
                        Reasignar
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>

      <Dialog open={active !== null} onOpenChange={(open) => {
        if (!open) {
          setActive(null)
          setVehicleId("")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular unidad Wialon</DialogTitle>
            <DialogDescription>
              {active ? `«${active.unitName}» se asociará al vehículo elegido y el vínculo se mantendrá en las próximas lecturas.` : ""}
            </DialogDescription>
          </DialogHeader>
          <Field label="Vehículo" htmlFor="wialon-link-vehicle">
            <Combobox
              id="wialon-link-vehicle"
              options={options}
              value={vehicleId}
              onChange={setVehicleId}
              placeholder="Buscar por patente o código..."
              aria-label="Vehículo para la unidad Wialon"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setActive(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!vehicleId || link.pending}
              loading={link.pending}
              onClick={() => {
                if (!active || !vehicleId) return
                link.run(() => linkWialonUnitAction({ unitId: active.unitId, vehicleId }))
              }}
            >
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingUnlink !== null}
        onOpenChange={(open) => { if (!open) setPendingUnlink(null) }}
        title="¿Desvincular la unidad Wialon?"
        description={pendingUnlink
          ? `«${pendingUnlink.unitName}» dejará de apuntar a su vehículo. La próxima lectura la volverá a intentar por patente o código; si no calza, quedará pendiente.`
          : ""}
        confirmLabel="Desvincular"
        cancelLabel="Cancelar"
        onConfirm={() => {
          if (pendingUnlink) unlink.run(() => unlinkWialonUnitAction({ unitId: pendingUnlink.unitId }))
        }}
        loading={unlink.pending}
      />
    </>
  )
}
