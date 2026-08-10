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
