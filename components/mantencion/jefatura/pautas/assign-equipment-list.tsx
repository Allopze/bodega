"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import type { AssignCandidate } from "@/lib/services/mantencion/schedule-assign"
import { changeFor, type RowChange } from "./assign-summary"

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

function ChangeTag({ change, candidate }: { change: RowChange; candidate: AssignCandidate }) {
  if (change === "add") return <Badge variant="success" size="sm">Se agrega</Badge>
  if (change === "move") return <Badge variant="warning" size="sm">Cambia desde «{candidate.scheduleName}»</Badge>
  if (change === "remove") return <Badge variant="danger" size="sm">Quedará sin pauta</Badge>
  if (change === "none" && candidate.scheduleName) return <span className="text-xs text-[var(--color-text-muted)]">Hoy: {candidate.scheduleName}</span>
  if (change === "none") return <span className="text-xs text-[var(--color-text-muted)]">Sin pauta</span>
  return null
}

/** Equipos agrupados por faena: una casilla por grupo y una por equipo, cada fila con su efecto. */
export function AssignEquipmentList({ candidates, selected, scheduleId, onToggle }: {
  candidates: AssignCandidate[]
  selected: ReadonlySet<string>
  scheduleId: string
  onToggle: (vehicleIds: string[], on: boolean) => void
}) {
  if (candidates.length === 0) return <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">No hay equipos con estos filtros.</p>
  const groups = new Map<string, { name: string; items: AssignCandidate[] }>()
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
              <GroupCheckbox id={`asg-g-${worksiteId}`} checked={count === ids.length} partial={count > 0 && count < ids.length} label={`Marcar todos los equipos de ${group.name}`} onChange={(on) => onToggle(ids, on)} />
              <span className="text-sm font-semibold">{group.name}</span>
              <span className="ml-auto font-mono text-xs text-[var(--color-text-muted)]">{count} de {ids.length}</span>
            </label>
            <ul>
              {group.items.map((item) => {
                const change = changeFor(item, selected, scheduleId)
                return (
                  <li key={item.vehicleId}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1 hover:bg-[var(--color-surface-2)]/60 sm:min-h-9">
                      <input
                        type="checkbox" checked={selected.has(item.vehicleId)} onChange={(event) => onToggle([item.vehicleId], event.target.checked)}
                        className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-[13px] font-semibold">{item.code}</span>
                        <span className="block truncate text-xs text-[var(--color-text-muted)]">{item.typeName} · {item.brandName}</span>
                      </span>
                      <ChangeTag change={change} candidate={item} />
                    </label>
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
