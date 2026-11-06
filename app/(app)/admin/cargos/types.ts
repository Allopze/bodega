export type WorkerPositionCatalogRow = {
  id: string
  code: string
  name: string
  isActive: boolean
  needsReview: boolean
  isSystem: boolean
  /** Clases de licencia que exige el cargo (basta una); vacío = no exige una en particular. */
  requiredLicenseClasses: string[]
  workerCount: number
  aliases: Array<{ id: string; alias: string }>
  capabilities: Array<{ id: string; code: string; name: string }>
}

export type WorkerCapabilityCatalogRow = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  positionCount: number
  overrideCount: number
}

export type WorkerPositionOption = Pick<
  WorkerPositionCatalogRow,
  "id" | "code" | "name" | "isActive" | "needsReview"
>
