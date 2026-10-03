/**
 * «Recorrer la MIPER» (pestaña Revisión): atajos que abren el editor en el
 * primer riesgo de un filtro, con ese filtro en la URL. Así `matching` (el
 * conjunto de filas que ya arma el espacio de trabajo desde la URL) ES el
 * filtro, y «Siguiente del filtro» recorre exactamente lo que se contó aquí.
 */
import { filterRows } from "./grid-view"
import { parseMatrixFilters, type MatrixFilterKey } from "./matrix-filters"
import type { MiperEntrySnapshot } from "./snapshot"
import { hrefToEntry, hrefToMatrixOnly } from "./workspace-url"

export type ReviewQuickFilterKey = "criticos" | "modificados" | "observados"
export type ReviewQuickFilter = {
  key: ReviewQuickFilterKey
  label: string
  patch: Partial<Record<MatrixFilterKey, string>>
  count: number
  firstEntryId: string | null
}

type Params = { get(key: string): string | null; toString(): string }

/** `modificados` sólo existe con línea base: sin versión previa todo sería «modificado». */
export function reviewQuickFilters(
  rows: readonly MiperEntrySnapshot[],
  { observed, modified, hasBaseline }: { observed: ReadonlySet<string>; modified: ReadonlySet<string>; hasBaseline: boolean },
): ReviewQuickFilter[] {
  const definitions: Array<Pick<ReviewQuickFilter, "key" | "label" | "patch">> = [
    { key: "criticos", label: "Importantes e Intolerables", patch: { clasificacion: "important,intolerable" } },
    ...(hasBaseline ? [{ key: "modificados" as const, label: "Modificados", patch: { marca: "modificados" } }] : []),
    { key: "observados", label: "Observados", patch: { marca: "observados" } },
  ]
  return definitions.map((definition) => {
    const filters = parseMatrixFilters(new URLSearchParams(definition.patch as Record<string, string>))
    const matching = filterRows([...rows], filters, { observed, modified, incomplete: new Set() })
    return { ...definition, count: matching.length, firstEntryId: matching[0]?.id ?? null }
  })
}

/** El editor en `entryId` con SÓLO el filtro `patch` en la URL. */
export function hrefToReviewWalk(pathname: string, params: Params, patch: Partial<Record<MatrixFilterKey, string>>, entryId: string): string {
  const filtered = hrefToMatrixOnly(pathname, params, patch)
  const query = filtered.includes("?") ? filtered.slice(filtered.indexOf("?") + 1) : ""
  return hrefToEntry(pathname, new URLSearchParams(query), entryId)
}
