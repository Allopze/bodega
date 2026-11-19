"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { vehicleIdentityParts } from "@/components/fleet/vehicle-identity"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import type { WorksiteContractView } from "@/lib/services/contracts/worksite-view"
import { assignVehiclesAction } from "./contract-actions"

type ViewContract = WorksiteContractView["contracts"][number]
type AssignableVehicle = WorksiteContractView["assignableVehicles"][number]

export interface AssignVehiclesSheetProps {
  open: boolean
  onClose: () => void
  /** Contrato al que se asigna; `null` = se elige en la hoja (se abrió desde «Sin contrato»). */
  contractId: string | null
  /** Contratos vigentes de la faena: los únicos a los que se puede asignar. */
  contracts: ViewContract[]
  /** Los equipos activos de la faena, con su contrato de hoy. */
  vehicles: AssignableVehicle[]
  /** Hoy en Chile (`YYYY-MM-DD`): la fecha «Desde» por defecto. */
  today: string
}

/**
 * «Asignar equipos»: multiselección de los equipos de la faena (con el contrato
 * que cada uno tiene hoy) y la fecha desde la que rige la asignación. Es lo que
 * hace viable la carga inicial de decenas de equipos. Una sola vista, sin
 * pestañas: no necesita `stableHeight`.
 */
export function AssignVehiclesSheet({ open, onClose, ...form }: AssignVehiclesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent>
        {/* El formulario vive dentro del contenido: al cerrar se desmonta y las marcas sin enviar no reaparecen. */}
        <AssignForm onClose={onClose} {...form} />
      </SheetContent>
    </Sheet>
  )
}

function AssignForm({ onClose, contractId: initialContractId, contracts, vehicles, today }: Omit<AssignVehiclesSheetProps, "open">) {
  const [contractId, setContractId] = React.useState(initialContractId ?? (contracts.length === 1 ? contracts[0]!.id : ""))
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [validFrom, setValidFrom] = React.useState(today)
  const [reason, setReason] = React.useState("")
  const { pending, message, run } = useOperation()

  const contract = contracts.find((candidate) => candidate.id === contractId)
  // Un equipo que ya está en el contrato elegido no se ofrece de nuevo. Desde
  // «Sin contrato» la lista son sólo los equipos que hoy no tienen contrato.
  const alreadyIn = new Set(contract?.vehicles.map((vehicle) => vehicle.id) ?? [])
  const candidates = vehicles.filter((vehicle) =>
    !alreadyIn.has(vehicle.id) && (initialContractId !== null || vehicle.currentContractName === null),
  )
  const chosen = candidates.filter((vehicle) => selected.has(vehicle.id))

  function toggle(vehicleId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(vehicleId)
      else next.delete(vehicleId)
      return next
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!contractId || chosen.length === 0) return
    const trimmed = reason.trim()
    run(
      () => assignVehiclesAction({
        contractId,
        vehicleIds: chosen.map((vehicle) => vehicle.id),
        validFrom,
        ...(trimmed ? { reason: trimmed } : {}),
      }),
      (result) => {
        toast.success(result.message ?? "Equipos asignados")
        // Los avisos (p. ej. un equipo que ya estaba en otro contrato) no bloquean: se muestran uno a uno.
        const warnings = (result.data?.warnings as string[] | undefined) ?? []
        for (const warning of warnings) toast.warning(warning)
        onClose()
      },
    )
  }

  const dateId = React.useId()
  const reasonId = React.useId()
  const submitLabel = chosen.length === 0 ? "Asignar" : `Asignar ${chosen.length} ${chosen.length === 1 ? "equipo" : "equipos"}`

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <div>
          <SheetTitle>Asignar equipos</SheetTitle>
          <SheetDescription>
            {contract ? `Contrato ${contract.name}` : "Elige el contrato y los equipos que trabajan para él."}
          </SheetDescription>
        </div>
        <SheetCloseButton />
      </SheetHeader>

      <SheetBody>
        {message && <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">{message}</p>}
        <div className="flex flex-col gap-5">
          {initialContractId === null && (
            <Field label="Contrato" required>
              <OptionSelect
                value={contractId}
                onValueChange={(next) => { setContractId(next); setSelected(new Set()) }}
                options={contracts.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                placeholder="Elige el contrato"
                aria-label="Contrato"
              />
            </Field>
          )}

          <Field label="Desde" htmlFor={dateId} required helper="El día en que el equipo empieza a trabajar para este contrato.">
            <DatePicker id={dateId} value={validFrom} onChange={setValidFrom} ariaLabel="Desde qué día" />
          </Field>

          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-sm font-medium text-[var(--color-text)]">Equipos</legend>
            {candidates.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                {contractId ? "No quedan equipos de esta faena por asignar a este contrato." : "Elige un contrato para ver los equipos."}
              </p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
                  <span>{chosen.length} de {candidates.length} marcados</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(chosen.length === candidates.length ? new Set() : new Set(candidates.map((vehicle) => vehicle.id)))}
                  >
                    {chosen.length === candidates.length ? "Quitar todos" : "Marcar todos"}
                  </Button>
                </div>
                <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-xl)] border border-[var(--color-border)]">
                  {candidates.map((vehicle) => {
                    const { primary, secondary } = vehicleIdentityParts({ ...vehicle, type: vehicle.typeName })
                    return (
                      <li key={vehicle.id} className="px-3 py-1.5">
                        <Checkbox
                          id={`assign-${vehicle.id}`}
                          checked={selected.has(vehicle.id)}
                          onChange={(event) => toggle(vehicle.id, event.target.checked)}
                          label={
                            <span className="inline-flex flex-wrap items-baseline gap-x-2">
                              <span className="font-mono font-medium tabular-nums">{primary}</span>
                              {secondary && <span className="text-xs text-[var(--color-text-muted)]">{secondary}</span>}
                              {vehicle.currentContractName && (
                                <span className="text-xs text-[var(--color-warning-ink)]">Hoy: {vehicle.currentContractName}</span>
                              )}
                            </span>
                          }
                        />
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </fieldset>

          <Field label="Motivo (opcional)" htmlFor={reasonId}>
            <Input id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
          </Field>
        </div>
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
        <SubmitButton label={submitLabel} loadingLabel="Asignando..." pending={pending} disabled={!contractId || chosen.length === 0} />
      </SheetFooter>
    </form>
  )
}
