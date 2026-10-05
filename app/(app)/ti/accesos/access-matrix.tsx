"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Check, Plus } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Switch } from "@/components/ui/switch"
import { IT_ACCESS_STATUS_META } from "@/lib/services/ti/constants"
import { AccessSheet } from "./access-sheets"

interface WorkerAccess {
  id: string
  name: string
  worksiteId: string
  worksiteName: string
  accesses: { id: string; systemId: string; systemName: string; status: string; notes?: string | null }[]
}

interface AccessMatrixProps {
  workers: WorkerAccess[]
  /** Solo las columnas a pintar: con un sistema filtrado, esa única. */
  systems: { id: string; name: string }[]
  canManage: boolean
  showAll: boolean
  systemFiltered: boolean
  inactiveWithAccessCount: number
}

type Editing =
  | { kind: "cell"; workerId: string; systemId: string }
  | { kind: "add"; workerId: string }

function statusLabel(status: string): string {
  return IT_ACCESS_STATUS_META[status]?.label ?? status
}

/** Marca visual del estado. El nombre accesible lo pone quien la envuelve. */
function StatusMark({ status }: { status: string }) {
  if (status === "activo") return <Check size={16} weight="bold" className="text-[var(--color-success-ink)]" aria-hidden />
  const meta = IT_ACCESS_STATUS_META[status] ?? { label: status, variant: "default" as const }
  return <MetaBadge meta={meta} />
}

const CELL_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"

export function AccessMatrix({ workers, systems, canManage, showAll, systemFiltered, inactiveWithAccessCount }: AccessMatrixProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [editing, setEditing] = React.useState<Editing | null>(null)

  /* Roving tabindex: la grilla es UNA parada de tabulación y las flechas se
     mueven por ella. Con ~18 sistemas y decenas de trabajadores, cada celda
     tabulable exigía cientos de pulsaciones para cruzar la tabla. */
  const [cursor, setCursor] = React.useState({ row: 0, col: 0 })
  const cellRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const lastRow = Math.max(0, workers.length - 1)
  const lastCol = Math.max(0, systems.length - 1)
  const activeRow = Math.min(cursor.row, lastRow)
  const activeCol = Math.min(cursor.col, lastCol)

  function onCellKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, row: number, col: number) {
    let nextRow = row
    let nextCol = col
    switch (event.key) {
      case "ArrowRight": nextCol = Math.min(col + 1, lastCol); break
      case "ArrowLeft": nextCol = Math.max(col - 1, 0); break
      case "ArrowDown": nextRow = Math.min(row + 1, lastRow); break
      case "ArrowUp": nextRow = Math.max(row - 1, 0); break
      case "Home": nextCol = 0; if (event.ctrlKey) nextRow = 0; break
      case "End": nextCol = lastCol; if (event.ctrlKey) nextRow = lastRow; break
      default: return
    }
    event.preventDefault()
    if (nextRow === row && nextCol === col) return
    setCursor({ row: nextRow, col: nextCol })
    cellRefs.current.get(`${nextRow}:${nextCol}`)?.focus()
  }

  function toggleShowAll(next: boolean) {
    const params = new URLSearchParams(window.location.search)
    if (next) params.set("todos", "1")
    else params.delete("todos")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const systemIds = new Set(systems.map((s) => s.id))
  const filteredSystemName = systemFiltered ? systems[0]?.name : undefined

  const editingWorker = editing ? workers.find((w) => w.id === editing.workerId) : undefined
  const editingRecord = editing?.kind === "cell"
    ? editingWorker?.accesses.find((a) => a.systemId === editing.systemId)
    : undefined

  const countText = systemFiltered
    ? `${workers.length} ${workers.length === 1 ? "trabajador con registro" : "trabajadores con registro"} en ${filteredSystemName ?? "el sistema"}.`
    : showAll
      ? `${workers.length} ${workers.length === 1 ? "trabajador activo" : "trabajadores activos"}.`
      : `${workers.length} ${workers.length === 1 ? "trabajador con accesos registrados" : "trabajadores con accesos registrados"}.`

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h2">Matriz de accesos por trabajador</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {countText}{canManage && " Toca una celda para ver o cambiar el acceso."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {inactiveWithAccessCount > 0 && (
            <Link
              href={`${pathname}?revision=inactivos`}
              scroll={false}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-signal-ink)] underline-offset-2 hover:underline sm:min-h-0"
            >
              Revisar inactivos con acceso ({inactiveWithAccessCount})
            </Link>
          )}
          {!systemFiltered && (
            <div className="flex min-h-11 items-center gap-2 sm:min-h-0">
              <Switch id="matrix-show-all" checked={showAll} onCheckedChange={toggleShowAll} label="Mostrar todos los trabajadores" />
              <label htmlFor="matrix-show-all" className="cursor-pointer text-sm text-[var(--color-text)]">
                Mostrar todos los trabajadores
              </label>
            </div>
          )}
        </div>
      </div>

      {systems.length === 0 ? (
        <EmptyState
          compact
          title="Aún no hay sistemas"
          description="Crea un sistema en la pestaña Sistemas para comenzar a registrar accesos."
          action={<Button variant="secondary" size="sm" onClick={() => router.replace(`${pathname}?vista=sistemas`, { scroll: false })}>Ir a Sistemas</Button>}
          align="start"
        />
      ) : workers.length === 0 ? (
        <EmptyState
          compact
          title={systemFiltered || !showAll ? "Nadie coincide con estos filtros" : "No hay trabajadores activos"}
          description={systemFiltered
            ? "Ningún trabajador tiene registro en este sistema con la faena o búsqueda elegidas. Quita un filtro para ver más."
            : showAll
              ? "Ajusta la faena o la búsqueda para encontrar trabajadores activos."
              : "Aún no hay accesos registrados para estos filtros. Muestra a todos los trabajadores para otorgar el primero."}
          action={!systemFiltered && !showAll
            ? <Button variant="secondary" size="sm" onClick={() => toggleShowAll(true)}>Mostrar todos los trabajadores</Button>
            : undefined}
          align="start"
        />
      ) : (
        <>
          {/* Escritorio: tabla con cabecera fija. Sin contenedor `overflow-x`:
              un ancestro con overflow se vuelve el contenedor de scroll del
              `sticky` y la cabecera dejaba de fijarse al pozo. */}
          <div className="mt-4 hidden md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Accesos de cada trabajador a cada sistema. Usa las flechas para moverte entre celdas y Enter para abrir el acceso.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 z-10 w-56 bg-[var(--color-surface)] px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Trabajador</th>
                  {systems.map((system) => (
                    <th key={system.id} scope="col" className="sticky top-0 z-10 bg-[var(--color-surface)] px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{system.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workers.map((worker, rowIndex) => (
                  <tr key={worker.id} className="border-t border-[var(--color-border)]">
                    <th scope="row" className="px-2 py-2 text-left font-normal">
                      <span className="font-medium text-[var(--color-text)]">{worker.name}</span>
                      <span className="block text-xs text-[var(--color-text-muted)]">{worker.worksiteName}</span>
                    </th>
                    {systems.map((system, colIndex) => {
                      const access = worker.accesses.find((a) => a.systemId === system.id)
                      const label = access
                        ? `Acceso de ${worker.name} a ${system.name}: ${statusLabel(access.status)}`
                        : `Sin acceso registrado de ${worker.name} a ${system.name}. Registrar`
                      const isCursor = rowIndex === activeRow && colIndex === activeCol
                      return (
                        <td key={system.id} className="px-1 py-1 text-center">
                          {canManage ? (
                            <button
                              type="button"
                              ref={(node) => {
                                if (node) cellRefs.current.set(`${rowIndex}:${colIndex}`, node)
                                else cellRefs.current.delete(`${rowIndex}:${colIndex}`)
                              }}
                              tabIndex={isCursor ? 0 : -1}
                              onFocus={() => setCursor({ row: rowIndex, col: colIndex })}
                              onKeyDown={(event) => onCellKeyDown(event, rowIndex, colIndex)}
                              onClick={() => setEditing({ kind: "cell", workerId: worker.id, systemId: system.id })}
                              aria-label={label}
                              title={access ? statusLabel(access.status) : "Sin registro"}
                              className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-1.5 transition-colors hover:bg-[var(--color-surface-2)] ${CELL_FOCUS}`}
                            >
                              {access
                                ? <StatusMark status={access.status} />
                                : <span className="text-[var(--color-text-subtle)]" aria-hidden>—</span>}
                            </button>
                          ) : access ? (
                            <span className="inline-flex h-9 min-w-9 items-center justify-center" title={statusLabel(access.status)}>
                              <StatusMark status={access.status} />
                              <span className="sr-only">{label}</span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-subtle)]">
                              <span aria-hidden>—</span>
                              <span className="sr-only">Sin acceso registrado de {worker.name} a {system.name}</span>
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil: la columna fija de nombres ocupaba ~80 % del ancho. Una
              tarjeta por trabajador, con sus accesos como chips de 44 px. */}
          <ul className="mt-4 space-y-3 md:hidden">
            {workers.map((worker) => {
              const records = worker.accesses.filter((a) => systemIds.has(a.systemId))
              return (
                <li key={worker.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{worker.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{worker.worksiteName}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {records.map((access) => {
                      const label = `Acceso de ${worker.name} a ${access.systemName}: ${statusLabel(access.status)}`
                      const content = (
                        <>
                          <span className="text-sm text-[var(--color-text)]">{access.systemName}</span>
                          <StatusMark status={access.status} />
                        </>
                      )
                      return (
                        <li key={access.id}>
                          {canManage ? (
                            <button
                              type="button"
                              aria-label={label}
                              onClick={() => setEditing({ kind: "cell", workerId: worker.id, systemId: access.systemId })}
                              className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--color-border-control)] bg-[var(--color-surface)] px-3 ${CELL_FOCUS}`}
                            >
                              {content}
                            </button>
                          ) : (
                            <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3" aria-label={label} role="img">
                              {content}
                            </span>
                          )}
                        </li>
                      )
                    })}
                    {records.length === 0 && (
                      <li className="text-sm text-[var(--color-text-muted)]">Sin accesos registrados.</li>
                    )}
                    {canManage && !systemFiltered && (
                      <li>
                        <button
                          type="button"
                          onClick={() => setEditing({ kind: "add", workerId: worker.id })}
                          aria-label={`Agregar acceso a ${worker.name}`}
                          className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-[var(--color-border-control)] px-3 text-sm font-medium text-[var(--color-text-muted)] ${CELL_FOCUS}`}
                        >
                          <Plus size={14} aria-hidden /> Agregar
                        </button>
                      </li>
                    )}
                  </ul>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {editing && canManage && editingWorker && editing.kind === "cell" && (
        <AccessSheet
          key={`${editing.workerId}:${editing.systemId}`}
          systems={systems}
          fixed={{
            workerId: editing.workerId,
            workerName: editingWorker.name,
            systemId: editing.systemId,
            status: editingRecord?.status,
            notes: editingRecord?.notes,
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {editing && canManage && editingWorker && editing.kind === "add" && (
        <AccessSheet
          key={`add:${editing.workerId}`}
          systems={systems}
          workers={[{ id: editingWorker.id, name: editingWorker.name, lastName: "" }]}
          initialWorkerId={editingWorker.id}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
