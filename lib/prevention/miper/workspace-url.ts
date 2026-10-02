/**
 * Contrato de URL del espacio de trabajo (spec §3). Prioridad: `fila` > `tarea`
 * > `tab`. Los enlaces conservan los filtros y limpian la vista anterior.
 */
import { isEditorStep, type EditorStep } from "./entry-navigation"

export const WORKSPACE_TABS = ["matriz", "programa", "revision", "historial"] as const
export type WorkspaceTab = typeof WORKSPACE_TABS[number]
export type WorkspaceView = { tab: WorkspaceTab; taskKey: string | null; entryId: string | null; step: EditorStep | null; ficha: boolean }

type Params = { get(key: string): string | null; toString(): string }

export function readWorkspaceView(params: Params): WorkspaceView {
  const rawTab = params.get("tab")
  const entryId = params.get("fila") || null
  const taskKey = entryId ? null : params.get("tarea") || null
  const tab: WorkspaceTab = entryId || taskKey ? "matriz" : (WORKSPACE_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as WorkspaceTab) : "matriz"
  const step = params.get("paso")
  return { tab, taskKey, entryId, step: entryId && isEditorStep(step) ? step : null, ficha: params.get("ficha") === "1" || rawTab === "antecedentes" }
}

function href(pathname: string, params: Params, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(params.toString())
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key)
    else next.set(key, value)
  }
  const query = next.toString()
  return query ? `${pathname}?${query}` : pathname
}

const CLEAR_VIEW = { tab: null, tarea: null, fila: null, paso: null } as const

export const hrefToMatrix = (pathname: string, params: Params) => href(pathname, params, { ...CLEAR_VIEW, ficha: null })
export const hrefToTask = (pathname: string, params: Params, taskKey: string) => href(pathname, params, { ...CLEAR_VIEW, tarea: taskKey })
export const hrefToEntry = (pathname: string, params: Params, entryId: string, step?: EditorStep) => href(pathname, params, { ...CLEAR_VIEW, fila: entryId, paso: step ?? null })
export const hrefToTab = (pathname: string, params: Params, tab: WorkspaceTab) => href(pathname, params, { ...CLEAR_VIEW, tab: tab === "matriz" ? null : tab })
/** Abre o cierra la ficha sin tocar la vista; borra el alias heredado `tab=antecedentes`. */
export const hrefToFicha = (pathname: string, params: Params, open: boolean) =>
  href(pathname, params, { ficha: open ? "1" : null, ...(params.get("tab") === "antecedentes" ? { tab: null } : {}) })
/** La matriz (estructura) con filtros extra: lo usa la acción «Ver los pendientes» del siguiente paso. */
export const hrefToMatrixWith = (pathname: string, params: Params, patch: Record<string, string | null>) =>
  href(pathname, params, { ...CLEAR_VIEW, ...patch })
