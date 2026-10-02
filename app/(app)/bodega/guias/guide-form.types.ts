export interface GuideWorksiteOption {
  id: string
  name: string
}

export interface GuideWorkerOption {
  id: string
  name: string
  rut: string | null
  position: string | null
  worksiteId: string
  worksiteName: string
}

export interface GuideVehicleOption {
  id: string
  plate: string
  code: string | null
  brand: string | null
  model: string | null
  responsibleName: string | null
}

export interface GuideProductOption {
  productId: string
  sku: string
  name: string
  unitOfMeasure: string
  available: number
}

export interface GuideFormItem {
  productId: string
  quantity: string
  unitOfMeasure: string
  notes: string
  /** Guía de adquisiciones: renglón del borrador del que sale la fila. */
  sourceGuideItemId?: string
  /** Distingue líneas del mismo producto (p. ej. "SOL-0022 · línea 1 de 2"). */
  sourceLabel?: string
}

export interface GuideFormInitialValues {
  guideId: string
  destinationWorksiteId: string
  dispatcherWorkerId: string
  receiverWorkerId: string
  vehicleId: string
  driverWorkerId: string
  notes: string
  items: GuideFormItem[]
}
