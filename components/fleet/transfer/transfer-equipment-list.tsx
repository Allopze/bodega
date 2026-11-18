"use client"

import * as React from "react"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import type { TransferCandidate } from "@/lib/services/fleet-transfers"
import { transferRowNotes } from "./transfer-summary"

/** Casilla de grupo con estado parcial: `indeterminate` no existe como atributo HTML, se fija en el nodo. */
function GroupCheckbox({ id, checked, partial, label, onChange }: { id: string; checked: boolean; partial: boolean; label: string; onChange: (on: boolean) => void }) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = partial }, [partial])
  return (
    <input
      ref={ref} id={id} type="checkbox" checked={checked} aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
    />
  )
}

/**
 * Equipos agrupados por faena actual: una casilla por grupo y una por equipo. Recibe sólo los equipos
 * VISIBLES (ya filtrados), así que la casilla de grupo marca y desmarca únicamente esos: un filtro
 * activo no arrastra equipos ocultos. Cada fila marcada dice qué le pasaría; el error del servidor
 * para ese equipo (`rowErrors`) queda bajo su fila.
 */
export function TransferEquipmentList({ candidates, selected, toWorksiteName, effectiveDate, rowErrors, initialVehicleId, onToggle }: {
  candidates: TransferCandidate[]
  selected: ReadonlySet<string>
  toWorksiteName: string
  effectiveDate: string
  rowErrors: Readonly<Record<string, string>>
  initialVehicleId?: string
  onToggle: (vehicleIds: string[], on: boolean) => void
}) {
  const initialRef = React.useRef<HTMLLIElement>(null)
  // El equipo que llega marcado desde su ficha puede quedar bajo el pliegue de una flota larga.
  React.useEffect(() => { initialRef.current?.scrollIntoView?.({ block: "nearest" }) }, [])

  if (candidates.length === 0) return <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">No hay equipos con estos filtros.</p>
  const groups = new Map<string, { name: string; items: TransferCandidate[] }>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.worksiteId) ?? { name: candidate.worksiteName, items: [] }
    group.items.push(candidate)
    groups.set(candidate.worksiteId, group)
  }
  const ordered = [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "es"))

  return (
    <div className="flex flex-col gap-3">
      {ordered.map(([worksiteId, group]) => {
        const ids = group.items.map((item) => item.vehicleId)
        const count = ids.filter((id) => selected.has(id)).length
        return (
          <section key={worksiteId} aria-label={`Faena ${group.name}`}>
            <label className="flex min-h-9 items-center gap-3 rounded-md bg-[var(--color-surface-2)] px-2">
              <GroupCheckbox id={`trf-g-${worksiteId}`} checked={count === ids.length} partial={count > 0 && count < ids.length} label={`Marcar todos los equipos de ${group.name}`} onChange={(on) => onToggle(ids, on)} />
              <span className="text-sm font-semibold">{group.name}</span>
              <span className="ml-auto font-mono text-xs text-[var(--color-text-muted)]">{count} de {ids.length}</span>
            </label>
            <ul>
              {group.items.map((item) => {
                const on = selected.has(item.vehicleId)
                const error = rowErrors[item.vehicleId]
                const errorId = `trf-err-${item.vehicleId}`
                return (
                  <li key={item.vehicleId} ref={item.vehicleId === initialVehicleId ? initialRef : undefined}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]/60 sm:min-h-9">
                      <input
                        type="checkbox" checked={on} aria-label={`Trasladar ${item.code}`} aria-describedby={error ? errorId : undefined}
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => onToggle([item.vehicleId], event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <VehicleIdentity code={item.code} plate={item.plate} type={[item.typeName, item.brand].filter(Boolean).join(" · ")} />
                        {on && (
                          <span className="mt-0.5 flex flex-col gap-0.5">
                            {transferRowNotes(item, toWorksiteName, effectiveDate).map((note) => (
                              <span key={note} className="text-xs text-[var(--color-text-muted)]">{note}</span>
                            ))}
                          </span>
                        )}
                      </span>
                    </label>
                    {error && <p id={errorId} className="pb-1 pl-9 text-xs text-[var(--color-danger-ink)]">{error}</p>}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
