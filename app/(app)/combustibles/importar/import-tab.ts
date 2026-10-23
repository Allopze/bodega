export type ImportTab = "consumos" | "operaciones"

/**
 * Pestaña con la que abre /combustibles/importar. `?tab=operaciones` es el
 * destino de «Log operacional» en el botón «Importar» de Cargas
 * (`fuel-import-button.tsx`). El log operacional solo lo importan los roles
 * globales: quien no puede (o trae un valor desconocido o repetido) cae en
 * consumos en vez de ver una pestaña que no existe para él.
 */
export function resolveImportTab(tab: string | string[] | undefined, canImportOperations: boolean): ImportTab {
  return tab === "operaciones" && canImportOperations ? "operaciones" : "consumos"
}
