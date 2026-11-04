import { isValidElement, type ReactNode } from "react"

/**
 * El valor exportable de una celda de «Ver datos». Las celdas son `ReactNode`: texto, un número o,
 * cuando la fila lleva a una lista, un enlace (`<Link>Proveedor</Link>`). A Excel va **lo que se
 * lee**: un enlace exporta su texto, no su destino ni su marcado.
 *
 * - Un número se conserva como número (Excel puede sumarlo); un texto sale como texto, tal como se
 *   mostraba (con su formato de pantalla: «1.234», «$1.200», «12,5 %»).
 * - Un elemento se reduce al texto de sus hijos, recursivamente; un fragmento o un arreglo, a sus
 *   partes unidas. Lo que no tiene texto (un ícono, `null`, un booleano) sale vacío.
 * - Un elemento cuyo texto lo produce un componente por dentro (no está en sus `children`) no se
 *   puede leer sin renderizarlo: sale vacío, nunca un valor inventado. Las filas que necesiten
 *   exportar algo así deben entregar el texto como `children`.
 */
export type ChartCellValue = string | number | null

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string") return node
  if (typeof node === "number") return Number.isFinite(node) ? String(node) : ""
  if (typeof node === "bigint") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ""
}

export function chartCellValue(node: ReactNode): ChartCellValue {
  // Un número solo (no mezclado con texto) conserva su tipo.
  if (typeof node === "number") return Number.isFinite(node) ? node : null
  const text = textOf(node).replace(/\s+/g, " ").trim()
  return text === "" ? null : text
}

/** Las filas de «Ver datos» tal como se exportan. */
export function chartRowsValues(rows: ReadonlyArray<ReadonlyArray<ReactNode>>): ChartCellValue[][] {
  return rows.map((row) => row.map(chartCellValue))
}
