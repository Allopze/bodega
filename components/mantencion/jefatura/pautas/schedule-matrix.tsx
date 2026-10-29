"use client"

import * as React from "react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { EmptyState } from "@/components/ui/empty-state"
import { formatReading } from "@/lib/mantencion/format"
import { nameKey } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import type { EditorGroup, EditorInterval, EditorItem } from "@/lib/services/mantencion/schedules"
import { toast } from "@/lib/toast"
import { addScheduleItemAction, setScheduleCellAction, setScheduleItemActiveAction } from "@/app/(app)/mantencion/pautas/[id]/actions"
import { SectionCard } from "../shared/section-card"
import { ScheduleAddSystem } from "./schedule-add-system"
import { ScheduleMatrixGroup } from "./schedule-matrix-group"
import { toastWithUndo, useScheduleEdit } from "./use-schedule-edit"

const cellKey = (itemId: string, intervalId: string) => `${itemId}:${intervalId}`

/**
 * Matriz ítem × intervalo. El encabezado queda fijo al bajar (`sticky top-0`
 * mide contra el pozo del shell, que es el contenedor de scroll; por eso la
 * tabla no puede tener `overflow` propio en escritorio). Cada casilla se guarda
 * al instante: se pinta de inmediato (`useOptimistic`) y vuelve atrás sola si el
 * servidor la rechaza. Quitar un ítem lo inactiva y ofrece «Deshacer». El filtro
 * de la barra superior busca ítems por nombre.
 */
export function ScheduleMatrix({ scheduleId, unit, intervals, groups }: {
  scheduleId: string
  unit: MantUnit
  intervals: EditorInterval[]
  groups: EditorGroup[]
}) {
  const { searchQuery } = useSafeShellHeader()
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = React.useState<string | null>(null)
  const { pending, edit } = useScheduleEdit()

  const serverCells = React.useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const group of groups) for (const item of group.items) for (const interval of intervals) map[cellKey(item.id, interval.id)] = item.applies[interval.id] ?? false
    return map
  }, [groups, intervals])
  const [cells, setCell] = React.useOptimistic(serverCells, (state, update: { key: string; applies: boolean }) => ({ ...state, [update.key]: update.applies }))
  const [, startCell] = React.useTransition()

  const needle = nameKey(searchQuery)
  const visibleGroups = React.useMemo(
    () => (needle ? groups.map((group) => ({ ...group, items: group.items.filter((item) => nameKey(item.name).includes(needle)) })).filter((group) => group.items.length > 0) : groups),
    [groups, needle],
  )

  function toggleCell(item: EditorItem, interval: EditorInterval, applies: boolean) {
    startCell(async () => {
      setCell({ key: cellKey(item.id, interval.id), applies })
      const result = await setScheduleCellAction({ scheduleId, itemId: item.id, intervalId: interval.id, applies })
      if (!result.ok) toast.error(result.message)
    })
  }

  function removeItem(item: EditorItem) {
    edit(
      () => setScheduleItemActiveAction({ scheduleId, itemId: item.id, active: false }),
      () => toastWithUndo(`«${item.name}» quitado de la pauta. Los registros ya firmados no cambian.`, () => {
        edit(() => setScheduleItemActiveAction({ scheduleId, itemId: item.id, active: true }), () => toast.success(`«${item.name}» volvió a la pauta.`))
      }),
    )
  }

  async function addItem(group: EditorGroup, name: string): Promise<boolean> {
    return new Promise((resolve) => {
      edit(
        () => addScheduleItemAction({ scheduleId, groupId: group.id, name }),
        (outcome) => { toast.success(outcome.message ?? "Ítem agregado."); resolve(true) },
        () => resolve(false),
      )
    })
  }

  const counts = intervals.map((interval) => groups.reduce((total, group) => total + group.items.filter((item) => cells[cellKey(item.id, interval.id)]).length, 0))

  return (
    <SectionCard
      title="Actividades por intervalo"
      description="Marca en qué intervalos se hace cada actividad. Un ítem nuevo nace marcado en todos."
      className="p-0 [&>div:first-child]:px-5 [&>div:first-child]:pt-5"
    >
      {groups.length === 0 ? (
        <EmptyState compact align="start" title="Esta pauta aún no tiene actividades" description="Agrega el primer sistema con su primer ítem aquí abajo; después podrás sumar más en cada sistema." />
      ) : (
        <div className="max-md:overflow-x-auto" aria-busy={pending}>
          <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Actividades de la pauta por intervalo</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky top-0 z-10 border-y border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-subtle)]">Actividad</th>
                {intervals.map((interval) => (
                  <th
                    key={interval.id}
                    scope="col"
                    className="sticky top-0 z-10 w-24 whitespace-nowrap border-y border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-2 text-center font-mono text-xs font-semibold text-[var(--color-text)]"
                  >
                    {formatReading(interval.value, unit)}
                    {interval.needsReview && <>{" "}<span className="mt-0.5 block font-sans text-[10px] font-semibold uppercase tracking-wider text-[var(--color-warning-ink)]">Por revisar</span></>}
                  </th>
                ))}
                <th scope="col" className="sticky top-0 z-10 w-24 border-y border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            {visibleGroups.map((group) => (
              <ScheduleMatrixGroup
                key={group.id}
                group={group}
                intervals={intervals}
                unit={unit}
                cells={cells}
                collapsed={!needle && collapsed.has(group.id)}
                searching={!!needle}
                adding={addingTo === group.id}
                busy={pending}
                onToggleGroup={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next })}
                onToggleCell={toggleCell}
                onRemove={removeItem}
                onStartAdd={() => setAddingTo(group.id)}
                onStopAdd={() => setAddingTo(null)}
                onAddItem={(name) => addItem(group, name)}
              />
            ))}
            {needle && visibleGroups.length === 0 && (
              <tbody><tr><td colSpan={intervals.length + 2} className="px-3 py-6 text-center text-[var(--color-text-muted)]">Ninguna actividad coincide con «{searchQuery.trim()}».</td></tr></tbody>
            )}
            <tfoot>
              <tr className="bg-[var(--color-surface-2)] font-semibold">
                <th scope="row" className="px-3 py-2 text-left">Actividades en el intervalo</th>
                {counts.map((count, index) => <td key={intervals[index]!.id} className="px-1 py-2 text-center font-mono tabular-nums">{count}</td>)}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <ScheduleAddSystem scheduleId={scheduleId} systems={groups.map((group) => group.name)} />
    </SectionCard>
  )
}
