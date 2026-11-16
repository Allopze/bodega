"use client"

import * as React from "react"
import type { ChartCellValue } from "@/components/charts/chart-cell-text"
import type { ChartExportPermission } from "@/lib/reports/chart-data-export"

/**
 * Registro de las tablas «Ver datos» exportables que hay en la pantalla. Cada `ChartDataExport`
 * se anota al montarse y se borra al desmontarse; el «Exportar Excel» de la cabecera de un tablero
 * (`BoardExportButton`) las lee para armar un libro con una hoja por gráfico.
 *
 * Es un almacén de módulo y no un contexto de React a propósito: el botón vive en la TopBar
 * (`PageHeader.actions` se pinta en el árbol del shell) y los gráficos en `<main>`, así que ningún
 * proveedor que ponga la página envuelve a los dos.
 */
export interface BoardTable {
  title: string
  headers: string[]
  rows: ChartCellValue[][]
  permission: ChartExportPermission
  notes?: readonly string[]
  /** Nodo de la tabla en la página: ordena el libro como la pantalla, de arriba abajo. */
  anchor: () => Element | null
}

const tables = new Map<string, BoardTable>()
const listeners = new Set<() => void>()
const EMPTY: readonly BoardTable[] = []
let snapshot: readonly BoardTable[] = EMPTY

function emit() {
  snapshot = tables.size === 0 ? EMPTY : [...tables.values()]
  for (const listener of listeners) listener()
}

export function registerBoardTable(id: string, table: BoardTable): () => void {
  tables.set(id, table)
  emit()
  return () => {
    if (tables.get(id) === table) {
      tables.delete(id)
      emit()
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Las tablas exportables de la pantalla, en el orden en que aparecen. */
export function useBoardTables(): readonly BoardTable[] {
  const current = React.useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)
  return React.useMemo(() => [...current].sort(byDocumentOrder), [current])
}

function byDocumentOrder(a: BoardTable, b: BoardTable): number {
  const nodeA = a.anchor()
  const nodeB = b.anchor()
  if (!nodeA || !nodeB || nodeA === nodeB) return 0
  return nodeA.compareDocumentPosition(nodeB) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}
