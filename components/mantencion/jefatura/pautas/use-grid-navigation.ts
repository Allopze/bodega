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
 * Algunas filas no son de casillas sino de UN solo botón (el de plegar un sistema,
 * «+ Agregar ítem»): se declaran en `singleRows`, ocupan la columna 0 y las flechas
 * izquierda/derecha no hacen nada ahí. Al subir o bajar desde ellas, el foco vuelve
 * a la columna donde se estaba. Así cada botón de la matriz es alcanzable con
 * flechas y el resto de la página no queda atrás de cientos de Tab.
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

export function useGridNavigation(rowIds: readonly string[], colIds: readonly string[], singleRows?: ReadonlySet<string>) {
  const [cursor, setCursor] = React.useState<Cursor | null>(null)
  // Columna donde se estaba al pasar por una fila de un solo botón (el cursor allí vive en la columna 0).
  const memoryCol = React.useRef(0)
  const cells = React.useRef(new Map<string, HTMLElement>())
  const restoreUntil = React.useRef(0)

  const lastRow = rowIds.length - 1
  const lastCol = colIds.length - 1
  const stopRow = resolve(rowIds, cursor?.row, cursor?.rowIndex)
  const stopCol = resolve(colIds, cursor?.col, cursor?.colIndex)
  const stopRowId = stopRow >= 0 ? rowIds[stopRow] : undefined
  const stopColId = stopCol >= 0 ? colIds[stopCol] : undefined

  const isSingle = (row: string) => singleRows?.has(row) ?? false

  function focusAt(rowIndex: number, wantedCol: number) {
    const row = rowIds[rowIndex]
    if (row === undefined) return
    const colIndex = isSingle(row) ? 0 : wantedCol
    const col = colIds[colIndex]
    if (col === undefined) return
    if (!isSingle(row)) memoryCol.current = colIndex
    setCursor({ row, col, rowIndex, colIndex })
    cells.current.get(cellKey(row, col))?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>, row: string, col: string) {
    if (event.altKey || event.metaKey) return
    const r = rowIds.indexOf(row)
    const own = colIds.indexOf(col)
    if (r < 0 || own < 0) return
    const lone = isSingle(row)
    // En una fila de un solo botón se «viaja» con la columna recordada; izquierda/derecha no se mueven.
    const c = lone ? Math.min(memoryCol.current, lastCol) : own
    let nextRow = r
    let nextCol = c
    switch (event.key) {
      case "ArrowRight": if (lone) { event.preventDefault(); return } nextCol = Math.min(c + 1, lastCol); break
      case "ArrowLeft": if (lone) { event.preventDefault(); return } nextCol = Math.max(c - 1, 0); break
      case "ArrowDown": nextRow = Math.min(r + 1, lastRow); break
      case "ArrowUp": nextRow = Math.max(r - 1, 0); break
      case "PageDown": nextRow = Math.min(r + PAGE_STEP, lastRow); break
      case "PageUp": nextRow = Math.max(r - PAGE_STEP, 0); break
      case "Home": if (!lone) nextCol = 0; if (event.ctrlKey) nextRow = 0; break
      case "End": if (!lone) nextCol = lastCol; if (event.ctrlKey) nextRow = lastRow; break
      default: return
    }
    event.preventDefault()
    if (nextRow !== r || nextCol !== c) focusAt(nextRow, nextCol)
  }

  /** Props del botón único de una fila de `singleRows`: vive en la columna 0. */
  function single(row: string): GridCellProps {
    const col = colIds[0] ?? ""
    return {
      ref: (node) => {
        if (node) cells.current.set(cellKey(row, col), node)
        else cells.current.delete(cellKey(row, col))
      },
      tabIndex: row === stopRowId && col === stopColId ? 0 : -1,
      onFocus: () => setCursor({ row, col, rowIndex: rowIds.indexOf(row), colIndex: 0 }),
      onKeyDown: (event) => onKeyDown(event, row, col),
    }
  }

  /** Props de una celda: `ref`, `tabIndex` (0 sólo en la celda del cursor), `onFocus` y `onKeyDown`. */
  function cell(row: string, col: string): GridCellProps {
    return {
      ref: (node) => {
        if (node) cells.current.set(cellKey(row, col), node)
        else cells.current.delete(cellKey(row, col))
      },
      tabIndex: row === stopRowId && col === stopColId ? 0 : -1,
      onFocus: () => {
        const colIndex = colIds.indexOf(col)
        memoryCol.current = colIndex
        setCursor({ row, col, rowIndex: rowIds.indexOf(row), colIndex })
      },
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

  return { cell, single, keepFocus }
}

export type GridNavigation = ReturnType<typeof useGridNavigation>
