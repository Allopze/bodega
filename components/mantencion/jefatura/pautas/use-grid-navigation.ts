"use client"

import * as React from "react"

/**
 * Tabindex itinerante para una matriz de botones (ítems × intervalos, actividades
 * × marcas): la matriz entera es UNA parada de Tab y las flechas mueven el foco
 * por las celdas. Con ~265 casillas, una parada por celda obligaba a cientos de
 * pulsaciones para cruzar la tabla. Mismo patrón que la matriz de accesos de TI
 * (`app/(app)/ti/accesos/access-matrix.tsx`), pero con filas y columnas por id:
 * los sistemas que se pliegan o la búsqueda de la barra superior cambian qué
 * filas existen sin que el cursor apunte a una que ya no se ve.
 *
 * Teclas: flechas, Inicio/Fin (extremos de la fila), Ctrl+Inicio/Ctrl+Fin
 * (esquinas de la matriz) y Re Pág/Av Pág (10 filas). Enter y espacio siguen
 * siendo del botón.
 */

const PAGE_STEP = 10
const cellKey = (row: string, col: string) => `${row}\u0000${col}`

interface Cursor { row: string; col: string; rowIndex: number; colIndex: number }

/** Posición vigente del cursor: por id si la fila/columna sigue visible; si no, la más cercana. */
function resolve(ids: readonly string[], id: string | undefined, lastIndex: number | undefined): number {
  if (ids.length === 0) return -1
  if (id !== undefined) {
    const at = ids.indexOf(id)
    if (at >= 0) return at
  }
  return Math.min(Math.max(lastIndex ?? 0, 0), ids.length - 1)
}

export interface GridCellProps {
  ref: (node: HTMLElement | null) => void
  tabIndex: 0 | -1
  onFocus: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}

export function useGridNavigation(rowIds: readonly string[], colIds: readonly string[]) {
  const [cursor, setCursor] = React.useState<Cursor | null>(null)
  const cells = React.useRef(new Map<string, HTMLElement>())
  const restoreUntil = React.useRef(0)

  const lastRow = rowIds.length - 1
  const lastCol = colIds.length - 1
  const stopRow = resolve(rowIds, cursor?.row, cursor?.rowIndex)
  const stopCol = resolve(colIds, cursor?.col, cursor?.colIndex)
  const stopRowId = stopRow >= 0 ? rowIds[stopRow] : undefined
  const stopColId = stopCol >= 0 ? colIds[stopCol] : undefined

  function focusAt(rowIndex: number, colIndex: number) {
    const row = rowIds[rowIndex]
    const col = colIds[colIndex]
    if (row === undefined || col === undefined) return
    setCursor({ row, col, rowIndex, colIndex })
    cells.current.get(cellKey(row, col))?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>, row: string, col: string) {
    if (event.altKey || event.metaKey) return
    const r = rowIds.indexOf(row)
    const c = colIds.indexOf(col)
    if (r < 0 || c < 0) return
    let nextRow = r
    let nextCol = c
    switch (event.key) {
      case "ArrowRight": nextCol = Math.min(c + 1, lastCol); break
      case "ArrowLeft": nextCol = Math.max(c - 1, 0); break
      case "ArrowDown": nextRow = Math.min(r + 1, lastRow); break
      case "ArrowUp": nextRow = Math.max(r - 1, 0); break
      case "PageDown": nextRow = Math.min(r + PAGE_STEP, lastRow); break
      case "PageUp": nextRow = Math.max(r - PAGE_STEP, 0); break
      case "Home": nextCol = 0; if (event.ctrlKey) nextRow = 0; break
      case "End": nextCol = lastCol; if (event.ctrlKey) nextRow = lastRow; break
      default: return
    }
    event.preventDefault()
    if (nextRow !== r || nextCol !== c) focusAt(nextRow, nextCol)
  }

  /** Props de una celda: `ref`, `tabIndex` (0 sólo en la celda del cursor), `onFocus` y `onKeyDown`. */
  function cell(row: string, col: string): GridCellProps {
    return {
      ref: (node) => {
        if (node) cells.current.set(cellKey(row, col), node)
        else cells.current.delete(cellKey(row, col))
      },
      tabIndex: row === stopRowId && col === stopColId ? 0 : -1,
      onFocus: () => setCursor({ row, col, rowIndex: rowIds.indexOf(row), colIndex: colIds.indexOf(col) }),
      onKeyDown: (event) => onKeyDown(event, row, col),
    }
  }

  /**
   * Para una acción que quita la fila donde está el foco (p. ej. «Quitar»): cuando
   * la fila desaparece el foco cae al `body` y quien navega con teclado tendría que
   * volver a cruzar toda la página. Durante unos segundos, si el foco quedó en el
   * `body`, se lo devuelve a la celda que ocupa ahora el cursor (la fila siguiente).
   */
  function keepFocus() {
    restoreUntil.current = Date.now() + 5000
  }

  React.useEffect(() => {
    if (restoreUntil.current === 0) return
    if (Date.now() > restoreUntil.current) { restoreUntil.current = 0; return }
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    if (stopRowId === undefined || stopColId === undefined) return
    const node = cells.current.get(cellKey(stopRowId, stopColId))
    if (node) { node.focus(); restoreUntil.current = 0 }
  })

  return { cell, keepFocus }
}

export type GridNavigation = ReturnType<typeof useGridNavigation>
