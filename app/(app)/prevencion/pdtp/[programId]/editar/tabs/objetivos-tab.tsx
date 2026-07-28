"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { renamePdtpObjectiveAction } from "../../../actions"
import { useDebouncedAutosave, autosaveStatusLabel } from "@/lib/hooks/use-debounced-autosave"


import type { PdtpActivityRow } from "./types"

export function ObjetivosTab({ programId, activities }: { programId: string; activities: PdtpActivityRow[] }) {
  const groups = React.useMemo(() => {
    const byOrder = new Map<number, { objective: string; count: number }>()
    for (const activity of activities) {
      const existing = byOrder.get(activity.objectiveOrder)
      if (!existing) byOrder.set(activity.objectiveOrder, { objective: activity.objective, count: 1 })
      else existing.count += 1
    }
    return [...byOrder.entries()]
      .sort(([left], [right]) => left - right)
      .map(([objectiveOrder, value]) => ({ objectiveOrder, objective: value.objective, count: value.count }))
  }, [activities])

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        Los objetivos agrupan actividades que persiguen el mismo resultado. Puedes crear tantos como el programa necesite; el ejemplo 2026 usa ocho, pero no es un límite.
      </p>
      {groups.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
          <p className="text-sm font-medium text-[var(--color-text)]">Aún no hay objetivos</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">En el paso Actividades podrás crear el primer objetivo y agregar una actividad dentro de él.</p>
        </div>
      ) : groups.map((group) => <ObjectiveRow key={group.objectiveOrder} programId={programId} group={group} />)}
    </div>
  )
}

function ObjectiveRow({ programId, group }: {
  programId: string
  group: { objectiveOrder: number; objective: string; count: number }
}) {
  const router = useRouter()
  const [value, setValue] = React.useState(group.objective)
  const isDirty = value.trim() !== "" && value !== group.objective

  const [lastSavedObjective, setLastSavedObjective] = React.useState(group.objective)
  if (lastSavedObjective !== group.objective) {
    setLastSavedObjective(group.objective)
    setValue(group.objective)
  }

  const { status, error, saveNow } = useDebouncedAutosave({
    watchKey: value,
    isDirty,
    onSave: async () => {
      const result = await renamePdtpObjectiveAction({ programId, objectiveOrder: group.objectiveOrder, objective: value })
      if (result.ok) router.refresh()
      return result
    },
  })
  const pending = status === "saving"

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 font-mono text-xs text-[var(--color-text-subtle)]">{group.objectiveOrder}</span>
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 flex-1" placeholder="Sin actividades en este objetivo aún" />
        <span aria-live="polite" className="shrink-0 text-[11px] text-[var(--color-text-subtle)]">{autosaveStatusLabel(status)}</span>
        <Button type="button" size="sm" disabled={pending || !isDirty} onClick={saveNow}>
          {pending ? "..." : "Guardar"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-subtle)]">
        {group.count} actividad(es)
      </p>
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}
