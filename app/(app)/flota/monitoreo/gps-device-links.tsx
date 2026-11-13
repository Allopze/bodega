"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LinkSimple, LinkBreak, ProhibitInset, ArrowCounterClockwise } from "@phosphor-icons/react/dist/ssr"
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
import type { ExcludedGpsDevice, GpsLinkableDevice, GpsProvider, LinkableVehicle } from "@/lib/services/fleet-gps"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import {
  excludeGpsDeviceAction,
  linkGpsDeviceAction,
  restoreGpsDeviceAction,
  unlinkGpsDeviceAction,
} from "./actions"

const PROVIDER_LABEL: Record<GpsProvider, string> = { onway: "OnWay", wialon: "Wialon" }

const deviceKey = (device: { provider: GpsProvider; unitId: string }) => `${device.provider}:${device.unitId}`

/**
 * Dispositivos GPS (equipos OnWay y unidades Wialon) y su vehículo. Los que
 * calzan por patente, VIN o código se muestran como «vinculados por identidad»;
 * los que no, se resuelven a mano y el link se conserva entre corridas. Un
 * dispositivo que no es de la flota se excluye con su motivo y sale de lo
 * pendiente; «Excluidas» permite restaurarlo. Desvincular sólo borra el link
 * manual, nunca un vehículo ni una lectura.
 */
export function GpsDeviceLinks({ devices, excluded, vehicles }: {
  devices: GpsLinkableDevice[]
  excluded: ExcludedGpsDevice[]
  vehicles: LinkableVehicle[]
}) {
  const router = useRouter()
  const [active, setActive] = useState<GpsLinkableDevice | null>(null)
  const [vehicleId, setVehicleId] = useState("")
  const [pendingUnlink, setPendingUnlink] = useState<GpsLinkableDevice | null>(null)
  const [pendingExclude, setPendingExclude] = useState<GpsLinkableDevice | null>(null)
  const [restoringKey, setRestoringKey] = useState<string | null>(null)
  const link = useOperation({ feedback: "toast", onSuccess: () => {
    setActive(null)
    setVehicleId("")
    router.refresh()
  } })
  const unlink = useOperation({ feedback: "toast", onSuccess: () => {
    setPendingUnlink(null)
    router.refresh()
  } })
  // Mensaje dentro del diálogo: el motivo de una falla no se pierde en un toast.
  const exclude = useOperation()
  const restore = useOperation({ feedback: "toast", onSuccess: () => {
    setRestoringKey(null)
    router.refresh()
  } })

  const options = vehicles.map((vehicle) => ({
    value: vehicle.id,
    label: `${vehicle.plate}${vehicle.code ? ` · ${vehicle.code}` : ""}`,
    hint: vehicle.worksiteName,
  }))

  return (
    <>
      {devices.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          No hay dispositivos en la última lectura. Ejecuta «Actualizar ahora» para poblarlos.
        </p>
      ) : (
        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dispositivo</TableHead>
                <TableHead>Última lectura</TableHead>
                <TableHead>Vehículo</TableHead>
                <TableHead><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={deviceKey(device)}>
                  <TableCell>
                    <div className="font-medium">{device.unitName}</div>
                    <div className="text-xs text-[var(--color-text-subtle)]">
                      {PROVIDER_LABEL[device.provider]} · <span className="font-mono">{device.unitId}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(device.gpsReportedAt ?? device.observedAt)}
                  </TableCell>
                  <TableCell>
                    {device.plate ? (
                      <div>
                        <span>{device.plate}{device.code ? ` · ${device.code}` : ""}</span>
                        {!device.manualLinkId ? (
                          <div className="text-xs text-[var(--color-text-subtle)]">Vinculado por patente, VIN o código</div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-[var(--color-warning-ink)]">Sin vincular</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {!device.vehicleId ? (
                        <Button type="button" variant="secondary" size="sm" onClick={() => {
                          setActive(device)
                          setVehicleId("")
                        }}>
                          <LinkSimple size={14} aria-hidden />
                          Vincular
                        </Button>
                      ) : device.manualLinkId ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setPendingUnlink(device)}>
                          <LinkBreak size={14} aria-hidden />
                          Desvincular
                        </Button>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" onClick={() => {
                          setActive(device)
                          setVehicleId(device.vehicleId ?? "")
                        }}>
                          Reasignar
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Excluir ${device.unitName} (${PROVIDER_LABEL[device.provider]})`}
                        onClick={() => {
                          exclude.setMessage("")
                          setPendingExclude(device)
                        }}
                      >
                        <ProhibitInset size={14} aria-hidden />
                        Excluir
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}

      {excluded.length > 0 ? (
        <details className="mt-4 rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2">
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
            Excluidas ({excluded.length})
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Dispositivos que no son de la flota. No se cruzan con ningún vehículo ni cuentan como pendientes.
              Restaurar uno lo devuelve al cruce automático en la próxima lectura.
            </p>
            <TableRoot>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dispositivo</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Excluido</TableHead>
                    <TableHead><span className="sr-only">Acción</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {excluded.map((device) => (
                    <TableRow key={deviceKey(device)}>
                      <TableCell>
                        <div className="font-medium">{device.unitName ?? device.unitId}</div>
                        <div className="text-xs text-[var(--color-text-subtle)]">
                          {PROVIDER_LABEL[device.provider]} · <span className="font-mono">{device.unitId}</span>
                          {device.unitName ? null : " · ya no figura en la lectura"}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-sm">{device.reason}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDateTime(device.excludedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={restore.pending && restoringKey === deviceKey(device)}
                          disabled={restore.pending}
                          aria-label={`Restaurar ${device.unitName ?? device.unitId} (${PROVIDER_LABEL[device.provider]})`}
                          onClick={() => {
                            setRestoringKey(deviceKey(device))
                            restore.run(() => restoreGpsDeviceAction({ provider: device.provider, unitId: device.unitId }))
                          }}
                        >
                          <ArrowCounterClockwise size={14} aria-hidden />
                          Restaurar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableRoot>
          </div>
        </details>
      ) : null}

      <Dialog open={active !== null} onOpenChange={(open) => {
        if (!open) {
          setActive(null)
          setVehicleId("")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular dispositivo {active ? PROVIDER_LABEL[active.provider] : "GPS"}</DialogTitle>
            <DialogDescription>
              {active ? `«${active.unitName}» se asociará al vehículo elegido y el vínculo se mantendrá en las próximas lecturas.` : ""}
            </DialogDescription>
          </DialogHeader>
          <Field label="Vehículo" htmlFor="gps-link-vehicle">
            <Combobox
              id="gps-link-vehicle"
              options={options}
              value={vehicleId}
              onChange={setVehicleId}
              placeholder="Buscar por patente o código..."
              aria-label="Vehículo para el dispositivo GPS"
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
                link.run(() => linkGpsDeviceAction({ provider: active.provider, unitId: active.unitId, vehicleId }))
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
        title="¿Desvincular el dispositivo?"
        description={pendingUnlink
          ? `«${pendingUnlink.unitName}» dejará de apuntar a su vehículo. La próxima lectura lo volverá a intentar por patente, VIN o código; si no calza, quedará pendiente.`
          : ""}
        confirmLabel="Desvincular"
        cancelLabel="Cancelar"
        onConfirm={() => {
          if (pendingUnlink) unlink.run(() => unlinkGpsDeviceAction({ provider: pendingUnlink.provider, unitId: pendingUnlink.unitId }))
        }}
        loading={unlink.pending}
      />

      <ConfirmDialog
        open={pendingExclude !== null}
        onOpenChange={(open) => { if (!open) setPendingExclude(null) }}
        title="¿Excluir el dispositivo de la flota?"
        description={pendingExclude
          ? `«${pendingExclude.unitName}» (${PROVIDER_LABEL[pendingExclude.provider]}) dejará de cruzarse con vehículos y de contar como pendiente. Queda registrado y se puede restaurar desde «Excluidas».`
          : ""}
        variant="warning"
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        reasonLabel="¿Por qué no es de la flota?"
        reasonPlaceholder="Ej.: equipo de un contratista, unidad de prueba del proveedor"
        error={exclude.message || undefined}
        onConfirm={(reason) => {
          if (!pendingExclude) return
          const target = pendingExclude
          exclude.run(
            () => excludeGpsDeviceAction({ provider: target.provider, unitId: target.unitId, reason }),
            (result) => {
              toast.success(result.message ?? "Dispositivo excluido")
              setPendingExclude(null)
              router.refresh()
            },
          )
        }}
        loading={exclude.pending}
      />
    </>
  )
}
