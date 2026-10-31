"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { FuelInboxRow } from "@/lib/combustibles/inbox/types"
import { cn, formatDate, todayInChile } from "@/lib/utils"
import { BulkDecideBar } from "./bulk-decide-bar"
import { InboxRowBadges } from "./inbox-row-badges"
import { useInboxSeen } from "./use-inbox-seen"

const DAY_MS = 86_400_000

function waitLabel(since: string, today: string): string {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${todayInChile(since)}T00:00:00Z`)) / DAY_MS)
  if (days <= 0) return "Hoy"
  return days === 1 ? "1 día" : `${days} días`
}

function actionLabel(row: FuelInboxRow, view: "pendientes" | "decididas"): string {
  if (view === "decididas") return row.kind === "carga" && row.canAct ? "Deshacer" : "Ver"
  if (!row.canAct) return "Ver"
  switch (row.kind) {
    case "carga": return "Decidir"
    case "caso": return row.assignee ? "Resolver" : "Tomar el caso"
    case "patente": return "Vincular"
    case "pedido": return "Revisar"
  }
}

/**
 * La lista de la bandeja: una fila por pendiente, con lo que pasó, el equipo, el
 * dato que lo explica y cuánto espera. Lo nuevo (llegó después de tu primera
 * visita y no lo abriste) lleva un punto. Las cargas por decidir se pueden
 * seleccionar para decidirlas en lote. La fila se abre en la hoja de decisión
 * (`?item=`), salvo un vínculo de patente ya hecho, que lleva a la ficha del equipo.
 *
 * Una sola estructura para escritorio y móvil (cada fila es una cuadrícula que se
 * apila): evita el par tabla + tarjetas con el mismo contenido dos veces en el DOM.
 */
export function InboxList({ rows, view, userId, today }: { rows: FuelInboxRow[]; view: "pendientes" | "decididas"; userId: string; today: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isNew, markSeen } = useInboxSeen(userId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const allRef = useRef<HTMLInputElement>(null)

  const selectable = useMemo(() => (view === "pendientes" ? rows.filter((row) => row.kind === "carga" && row.canAct && !row.decided) : []), [rows, view])
  // Una fila que ya no está en la página (otra persona la decidió, otro filtro) sale de la selección.
  const visibleSelected = useMemo(() => selectable.filter((row) => selected.has(row.id)).map((row) => row.id), [selectable, selected])
  const allSelected = selectable.length > 0 && visibleSelected.length === selectable.length

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = visibleSelected.length > 0 && !allSelected
  }, [visibleSelected.length, allSelected])

  function open(row: FuelInboxRow) {
    markSeen(row.key)
    const params = new URLSearchParams(searchParams.toString())
    params.set("item", row.key)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  return (
    <>
      {visibleSelected.length > 0 ? (
        <BulkDecideBar loadIds={visibleSelected} onDone={() => setSelected(new Set())} onClear={() => setSelected(new Set())} />
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {selectable.length > 1 ? (
          <div className="border-b border-[var(--color-border)] px-4 py-2">
            <Checkbox
              ref={allRef}
              label="Seleccionar todas las cargas de la página"
              checked={allSelected}
              onChange={(event) => setSelected(event.target.checked ? new Set(selectable.map((row) => row.id)) : new Set())}
            />
          </div>
        ) : null}
        <ul aria-label={view === "pendientes" ? "Pendientes" : "Decididas"} className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => {
            const fresh = view === "pendientes" && isNew(row.key, row.waitingSince)
            const overdue = view === "pendientes" && row.dueDate < today
            const linkOnly = row.kind === "patente" && row.decided !== null
            return (
              <li
                key={row.key}
                className={cn(
                  "grid gap-x-4 gap-y-2 px-4 py-3",
                  view === "pendientes"
                    ? "md:grid-cols-[1.5rem_minmax(0,1.1fr)_minmax(0,1.6fr)_9.5rem_7rem] md:items-center"
                    : "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_12rem_7rem] md:items-center",
                )}
              >
                {view === "pendientes" ? (
                  selectable.some((candidate) => candidate.key === row.key) ? (
                    <div>
                      <Checkbox
                        label={`Seleccionar la carga de ${row.equipmentLabel} para decidir en lote`}
                        labelHidden
                        checked={selected.has(row.id)}
                        onChange={(event) => toggle(row.id, event.target.checked)}
                      />
                    </div>
                  ) : (
                    <div className="hidden md:block" aria-hidden />
                  )
                ) : null}

                <div className="min-w-0">
                  <InboxRowBadges className="mb-1" label={row.title} kind={row.kind} severity={row.severity} decided={row.decided} fresh={fresh} />
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{row.equipmentLabel}</p>
                  {row.worksiteName ? <p className="truncate text-xs text-[var(--color-text-muted)]">{row.worksiteName}</p> : null}
                </div>

                <div className="min-w-0 text-sm text-[var(--color-text)]">
                  {view === "decididas" && row.decided?.note ? <p className="line-clamp-2">«{row.decided.note}»</p> : <p className="line-clamp-3">{row.datum}</p>}
                </div>

                {view === "pendientes" ? (
                  <div className="text-xs md:text-right">
                    <p className={cn("font-mono tabular-nums", overdue ? "font-semibold text-[var(--color-danger-ink)]" : "text-[var(--color-text)]")}>
                      {overdue ? "Venció el " : "Vence el "}{formatDate(row.dueDate)}
                    </p>
                    <p className="text-[var(--color-text-muted)]">Espera <span className="font-mono tabular-nums">{waitLabel(row.waitingSince, today)}</span></p>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-text-muted)] md:text-right">
                    <p>{row.decided?.byName ?? "Sin responsable"}</p>
                    <p className="font-mono tabular-nums">{row.decided ? formatDate(row.decided.at) : ""}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 md:justify-end">
                  {linkOnly && row.href ? (
                    <Button asChild size="sm" variant="secondary"><Link href={row.href}>Ver equipo</Link></Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant={view === "pendientes" && row.canAct && row.kind === "patente" ? "primary" : "secondary"}
                      onClick={() => open(row)}
                      aria-label={`${actionLabel(row, view)}: ${row.title}, ${row.equipmentLabel}`}
                    >
                      {actionLabel(row, view)}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}
