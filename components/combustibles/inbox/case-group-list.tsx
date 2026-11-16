"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CaretDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { summarizeCaseSelection } from "@/lib/combustibles/inbox/case-selection"
import type { FuelInboxCaseGroup, FuelInboxCaseMember, FuelInboxRow } from "@/lib/combustibles/inbox/types"
import { formatShortDay } from "@/lib/combustibles/panel/format"
import { cn } from "@/lib/utils"
import { BulkCaseBar } from "./bulk-case-bar"
import { actionLabel } from "./inbox-list"
import { dataMonthLabel, dataMonthRangeLabel, waitLabel } from "./inbox-row-format"
import { InboxRowBadges } from "./inbox-row-badges"
import { useInboxSeen } from "./use-inbox-seen"

const cases = (n: number) => (n === 1 ? "1 caso" : `${n} casos`)

/** «Sin tomar», «2 tomados por ti · 1 sin tomar», «Tomado por Ana»: quién tiene los casos del grupo. */
function holdersText(members: readonly FuelInboxCaseMember[], userId: string): string {
  let mine = 0
  let untaken = 0
  const others = new Map<string, number>()
  for (const member of members) {
    if (member.status !== "in_review" || !member.assigneeId) { untaken++; continue }
    if (member.assigneeId === userId) mine++
    else {
      const name = member.row.assignee?.name ?? "otra persona"
      others.set(name, (others.get(name) ?? 0) + 1)
    }
  }
  if (members.length === 1) {
    const [only] = members
    if (untaken === 1) return only!.status === "reopened" ? "Reabierto, sin tomar" : "Sin tomar"
    return mine === 1 ? "Tomado por ti" : `Tomado por ${[...others.keys()][0]}`
  }
  if (untaken === members.length) return "Sin tomar"
  const parts: string[] = []
  if (mine > 0) parts.push(`${mine} ${mine === 1 ? "tomado" : "tomados"} por ti`)
  for (const [name, n] of others) parts.push(`${n} por ${name}`)
  if (untaken > 0) parts.push(`${untaken} sin tomar`)
  return parts.join(" · ")
}

/** Estado de un caso dentro del grupo, en una frase corta. */
function memberStatus(member: FuelInboxCaseMember, userId: string): string {
  if (member.status === "in_review" && member.assigneeId) {
    return member.assigneeId === userId ? "Tomado por ti" : `Tomado por ${member.row.assignee?.name ?? "otra persona"}`
  }
  return member.status === "reopened" ? "Reabierto" : "Sin tomar"
}

/**
 * «En seguimiento» por equipo y causa (crítica 2026-11-15, paso 4c): una fila por grupo —los
 * casos abiertos de un equipo por una misma regla— en vez de una por caso. Un grupo de un solo
 * caso se abre directo en la hoja de decisión, como antes; uno de varios se despliega y cada caso
 * se abre desde ahí. Los grupos se eligen para tomarlos, resolverlos o descartarlos en lote.
 *
 * Misma estructura que la lista de siempre (`InboxList`): una cuadrícula por fila que se apila en
 * móvil, sin el par tabla + tarjetas.
 */
export function CaseGroupList({
  groups,
  userId,
  today,
  canReview,
  canResolve,
}: {
  groups: FuelInboxCaseGroup[]
  userId: string
  today: string
  canReview: boolean
  canResolve: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isNew, markSeen } = useInboxSeen(userId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const allRef = useRef<HTMLInputElement>(null)
  const canSelect = canReview || canResolve

  // Un grupo que ya no está en la página (se cerró, otro filtro) sale de la selección.
  const visibleSelected = useMemo(() => groups.filter((group) => selected.has(group.key)), [groups, selected])
  const selection = useMemo(() => summarizeCaseSelection(visibleSelected, userId), [visibleSelected, userId])
  const allSelected = groups.length > 0 && visibleSelected.length === groups.length

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = visibleSelected.length > 0 && !allSelected
  }, [visibleSelected.length, allSelected])

  function open(row: FuelInboxRow) {
    markSeen(row.key)
    const params = new URLSearchParams(searchParams.toString())
    params.set("item", row.key)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function toggle(set: Set<string>, key: string, on: boolean): Set<string> {
    const next = new Set(set)
    if (on) next.add(key); else next.delete(key)
    return next
  }

  return (
    <>
      {visibleSelected.length > 0 ? (
        <BulkCaseBar
          selection={selection}
          canReview={canReview}
          canResolve={canResolve}
          onClosed={() => setSelected(new Set())}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {canSelect && groups.length > 1 ? (
          <div className="border-b border-[var(--color-border)] px-4 py-2">
            <Checkbox
              ref={allRef}
              label="Seleccionar todos los grupos de la página"
              checked={allSelected}
              onChange={(event) => setSelected(event.target.checked ? new Set(groups.map((group) => group.key)) : new Set())}
            />
          </div>
        ) : null}
        <ul aria-label="Casos en seguimiento por equipo y causa" className="divide-y divide-[var(--color-border)]">
          {groups.map((group) => {
            const single = group.members.length === 1 ? group.members[0]! : null
            const lead = group.members[0]!
            const fresh = group.members.some((member) => isNew(member.row.key, member.row.waitingSince))
            const overdue = group.dueDate < today
            const isOpen = expanded.has(group.key)
            const listId = `grupo-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`
            return (
              <li key={group.key} className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[1.5rem_minmax(0,1.1fr)_minmax(0,1.6fr)_9.5rem_8.5rem] md:items-center">
                {canSelect ? (
                  <div>
                    <Checkbox
                      label={`Seleccionar ${single ? "el caso" : `los ${group.members.length} casos`} de ${group.equipmentLabel} por ${group.ruleLabel}`}
                      labelHidden
                      checked={selected.has(group.key)}
                      onChange={(event) => setSelected((current) => toggle(current, group.key, event.target.checked))}
                    />
                  </div>
                ) : (
                  <div className="hidden md:block" aria-hidden />
                )}

                <div className="min-w-0">
                  <InboxRowBadges className="mb-1" label={`Caso · ${group.ruleLabel}`} kind="caso" severity={group.severity} fresh={fresh} />
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{group.equipmentLabel}</p>
                  {group.worksiteName ? <p className="truncate text-xs text-[var(--color-text-muted)]">{group.worksiteName}</p> : null}
                </div>

                <div className="min-w-0 text-sm text-[var(--color-text)]">
                  {single ? null : <p className="font-medium">{cases(group.members.length)} · {dataMonthRangeLabel(group.firstMonth, group.lastMonth)}</p>}
                  <p className={cn(single ? "line-clamp-3" : "line-clamp-2 text-[var(--color-text-muted)]")}>{single ? "" : "El más urgente: "}{lead.row.datum}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {single ? `Datos de ${dataMonthLabel(group.firstMonth)} · ` : ""}{holdersText(group.members, userId)}
                  </p>
                </div>

                <div className="text-xs md:text-right">
                  <p className={cn("tabular-nums", overdue ? "font-semibold text-[var(--color-danger-ink)]" : "text-[var(--color-text)]")}>
                    {overdue ? "Venció el " : "Vence el "}{formatShortDay(group.dueDate, today)}
                  </p>
                  <p className="text-[var(--color-text-muted)]">Espera <span className="font-mono tabular-nums">{waitLabel(group.waitingSince, today)}</span></p>
                </div>

                <div className="flex items-center gap-2 md:justify-end">
                  {single ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => open(single.row)} aria-label={`${actionLabel(single.row, "pendientes")}: ${single.row.title}, ${single.row.equipmentLabel}`}>
                      {actionLabel(single.row, "pendientes")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-expanded={isOpen}
                      aria-controls={listId}
                      onClick={() => setExpanded((current) => toggle(current, group.key, !isOpen))}
                    >
                      {isOpen ? "Ocultar casos" : `Ver ${cases(group.members.length)}`}
                      <CaretDown size={14} aria-hidden className={cn("transition-transform duration-150 motion-reduce:transition-none", isOpen && "rotate-180")} />
                    </Button>
                  )}
                </div>

                {!single && isOpen ? (
                  <ul id={listId} aria-label={`Casos de ${group.equipmentLabel} por ${group.ruleLabel}`} className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] md:col-span-full md:ml-10">
                    {group.members.map((member) => (
                      <li key={member.row.key} className="grid gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center">
                        <div className="min-w-0 text-sm">
                          <p className="line-clamp-2 text-[var(--color-text)]">{member.row.datum}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">Datos de {dataMonthLabel(member.row.dataMonth)} · {memberStatus(member, userId)}</p>
                        </div>
                        <p className={cn("text-xs tabular-nums sm:text-right", member.row.dueDate < today ? "font-semibold text-[var(--color-danger-ink)]" : "text-[var(--color-text-muted)]")}>
                          {member.row.dueDate < today ? "Venció el " : "Vence el "}{formatShortDay(member.row.dueDate, today)}
                        </p>
                        <div className="sm:justify-self-end">
                          <Button type="button" size="sm" variant="ghost" onClick={() => open(member.row)} aria-label={`Abrir el caso de ${dataMonthLabel(member.row.dataMonth)}: ${member.row.datum}`}>
                            Abrir
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
