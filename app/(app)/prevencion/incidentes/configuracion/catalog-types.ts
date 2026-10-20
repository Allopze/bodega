export type CatalogRow = {
  id: string
  category: string
  code: string
  name: string
  isActive: boolean
  sortOrder: number
  parentCode: string | null
  /** Rótulo en español de la lista a la que pertenece. */
  listLabel: string
  /** Para agentes causantes: nombre de su categoría. */
  parentLabel: string
  /** Primera fila de su lista, para marcar el corte entre listas. */
  firstInList: boolean
  statusLabel: string
}
