"use client"

import * as React from "react"
import { CaretDown } from "@phosphor-icons/react"
import { Checkbox } from "@/components/ui/checkbox"
import type { PartsNoteListRow, PartsNotePendingLine } from "@/lib/services/mantencion/parts/types"
import { formatQty, pluralize } from "@/lib/utils"

/**
 * Elegir líneas pendientes en la bandeja para decidirlas en lote (ADR 0001, D33). Lo elegible es cada LÍNEA pendiente de
 * cada nota: la casilla de una nota elige todas las suyas y, desplegada, deja marcar una por una. La selección vive en
 * `PartsNotesTable` y la barra (`BulkLinesBar`) sólo recibe los ids; el servidor vuelve a validar permiso, alcance y estado.
 */

/** Las líneas pendientes de la fila (el servidor las arma sólo en «Por revisar»: en las demás pestañas la lista viene vacía). */
export const pendingLinesOf = (row: PartsNoteListRow): PartsNotePendingLine[] => row.pendingLines

/** Una nota en espera congela sus líneas (resolverlas o comprarlas se rechaza hasta aceptarla): se ve, pero no se elige. */
export const isHeld = (row: PartsNoteListRow) => row.status === "en_espera"

const selectableLines = (row: PartsNoteListRow) => (isHeld(row) ? [] : pendingLinesOf(row))

/** La fila tiene líneas que se pueden elegir (y por tanto desplegar). */
export const canPickLines = (row: PartsNoteListRow) => selectableLines(row).length > 0

export const linesText = (count: number) => `${count} ${pluralize(count, "línea", "líneas")}`
export const notesText = (count: number) => `${count} ${pluralize(count, "nota", "notas")}`
/** «la línea pendiente» / «las 2 líneas pendientes»: lo que dicen las casillas de elegir. */
const pendingText = (count: number) => (count === 1 ? "la línea pendiente" : `las ${count} líneas pendientes`)

export type CheckState = "none" | "some" | "all"

export interface LineSelection {
  selected: ReadonlySet<string>
  /** Líneas elegibles de la página y notas que las tienen. */
  total: number
  noteTotal: number
  /** Líneas elegidas y notas a las que pertenecen. */
  lineCount: number
  noteCount: number
  /** Alguna nota elegida tiene OT: sin OT no hay stock reservable, así que «Sacar de bodega» no tiene sentido. */
  canTakeFromStock: boolean
  all: CheckState
  noteState: (row: PartsNoteListRow) => CheckState
  toggleNote: (row: PartsNoteListRow, on: boolean) => void
  toggleLine: (id: string, on: boolean) => void
  setAll: (on: boolean) => void
  clear: () => void
}

const NO_ROWS: PartsNoteListRow[] = []

export function useLineSelection(rows: PartsNoteListRow[], enabled = true): LineSelection {
  const [raw, setRaw] = React.useState<ReadonlySet<string>>(() => new Set())
  const byNote = React.useMemo(() => new Map((enabled ? rows : NO_ROWS).map((row) => [row.id, selectableLines(row)] as const)), [rows, enabled])
  const valid = React.useMemo(() => new Set([...byNote.values()].flatMap((lines) => lines.map((line) => line.id))), [byNote])
  // Lo que ya no está en la página (se resolvió, cambió de pestaña o de página) sale solo de la selección.
  const selected = React.useMemo(() => {
    const kept = [...raw].filter((id) => valid.has(id))
    return kept.length === raw.size ? raw : new Set(kept)
  }, [raw, valid])

  const stateOf = (lines: PartsNotePendingLine[]): CheckState => {
    const count = lines.filter((line) => selected.has(line.id)).length
    return count === 0 ? "none" : count === lines.length ? "all" : "some"
  }
  const chosen = rows.filter((row) => (byNote.get(row.id) ?? []).some((line) => selected.has(line.id)))

  return {
    selected,
    total: valid.size,
    noteTotal: [...byNote.values()].filter((lines) => lines.length > 0).length,
    lineCount: selected.size,
    noteCount: chosen.length,
    canTakeFromStock: chosen.some((row) => row.workOrderId !== null),
    all: selected.size === 0 ? "none" : selected.size === valid.size ? "all" : "some",
    noteState: (row) => stateOf(byNote.get(row.id) ?? []),
    toggleNote: (row, on) => setRaw((current) => {
      const next = new Set(current)
      for (const line of byNote.get(row.id) ?? []) { if (on) next.add(line.id); else next.delete(line.id) }
      return next
    }),
    toggleLine: (id, on) => setRaw((current) => {
      const next = new Set(current)
      if (on) next.add(id); else next.delete(id)
      return next
    }),
    setAll: (on) => setRaw(on ? new Set(valid) : new Set()),
    clear: () => setRaw(new Set()),
  }
}

/** Casilla con estado mixto: `indeterminate` no existe como atributo HTML y se fija sobre el nodo. */
function MixedCheckbox({ mixed, ...props }: React.ComponentPropsWithoutRef<typeof Checkbox> & { mixed: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed, props.checked])
  return <Checkbox ref={ref} {...props} />
}

/**
 * La casilla de una nota: elige o quita todas sus líneas pendientes. En la tabla su rótulo es sólo para lectores de pantalla
 * (`cell`); en la tarjeta del móvil el rótulo se ve (`card`) y es el objetivo pulsable entero. Una nota en espera la muestra
 * deshabilitada y dice por qué.
 */
export function NoteSelectBox({ row, selection, variant }: { row: PartsNoteListRow; selection: LineSelection; variant: "cell" | "card" }) {
  const count = pendingLinesOf(row).length
  if (count === 0) return null
  const held = isHeld(row)
  const state = selection.noteState(row)
  const label = held
    ? `${row.code} está en espera: acéptala para decidir sus líneas`
    : variant === "card" ? `Elegir ${pendingText(count)}` : `Elegir ${pendingText(count)} de ${row.code}`
  return (
    <MixedCheckbox
      mixed={state === "some"}
      checked={state === "all"}
      disabled={held}
      title={held ? label : undefined}
      labelHidden={variant === "cell"}
      className={variant === "cell" ? "mt-1" : undefined}
      label={label}
      onChange={(event) => selection.toggleNote(row, event.target.checked)}
    />
  )
}

/** «Elegir todo» de la página: sólo con dos notas o más (con una, la casilla de la nota ya lo hace). */
export function SelectAllLines({ selection }: { selection: LineSelection }) {
  if (selection.noteTotal < 2) return null
  return (
    <div className="mb-2 px-1">
      <MixedCheckbox
        mixed={selection.all === "some"}
        checked={selection.all === "all"}
        label={`Elegir ${pendingText(selection.total)} de esta página`}
        onChange={(event) => selection.setAll(event.target.checked)}
      />
    </div>
  )
}

/** El «2 de 3» de la fila, hecho botón: despliega las líneas de la nota para marcarlas una por una. */
export function LinesToggle({ row, text, open, onToggle }: { row: PartsNoteListRow; text: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Ocultar" : "Ver"} las líneas pendientes de ${row.code}`}
      onClick={onToggle}
      className="inline-flex min-h-6 items-center gap-1 rounded-[var(--radius-sm)] font-mono text-sm tabular-nums hover:text-[var(--color-primary-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    >
      {text}
      <CaretDown size={12} aria-hidden className={open ? "rotate-180" : undefined} />
    </button>
  )
}

/** Las líneas de una nota, cada una con su casilla (el rótulo es la descripción y la cantidad pedida). */
export function NoteLinesList({ row, selection }: { row: PartsNoteListRow; selection: LineSelection }) {
  return (
    <ul aria-label={`Líneas pendientes de ${row.code}`} className="flex flex-col gap-1">
      {pendingLinesOf(row).map((line) => (
        <li key={line.id}>
          <Checkbox
            checked={selection.selected.has(line.id)}
            onChange={(event) => selection.toggleLine(line.id, event.target.checked)}
            label={(
              <>
                {line.description}{" "}
                <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
                  × {formatQty(line.quantity)}{line.unitOfMeasure && line.unitOfMeasure !== "unidad" ? ` ${line.unitOfMeasure}` : ""}
                </span>
              </>
            )}
          />
        </li>
      ))}
    </ul>
  )
}
