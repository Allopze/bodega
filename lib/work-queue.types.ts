/**
 * Types for the work-queue module.
 * Tasks, actors, rows, and progress types.
 */

export type WorkTaskType =
  | "request_followup"
  | "approval"
  | "purchase"
  | "purchase_order"
  | "receipt"
  | "warehouse_delivery"
  | "pdtp"
  | "capa"
  | "inspection"
  | "documentation"
  | "ppa"
  | "sst"

export type WorkPriority = "critical" | "high" | "normal" | "low"

/**
 * Módulos de la cola operacional. Vive aquí y no en
 * `lib/services/operational-work-queue.ts` para que los componentes cliente
 * puedan tipar y etiquetar módulos sin arrastrar drizzle al bundle.
 */
export type OperationalModule =
  | "solicitudes"
  | "aprobaciones"
  | "compras"
  | "recepciones"
  | "entregas"
  | "pdtp"
  | "capa"
  | "inspecciones"
  | "documentacion"
  | "ppa"
  | "sst"

export interface WorkTask {
  id:          string
  type:        WorkTaskType
  title:       string
  subtitle:    string
  /** Faena ya autorizada desde la que se originó la tarea. Permite filtrar la
   * cola sin volver a inferirla desde texto de presentación. */
  worksiteId:  string
  worksiteName: string
  statusLabel: string
  priority:    WorkPriority
  createdAt:   string
  href:        string
  ctaLabel:    string
}


export interface RequestProgressItem {
  id:            string
  productName:   string
  status:        string
  quantity:      number
  unitOfMeasure: string
}

export interface RequestProgress {
  currentStage: string
  completedStages: string[]
  nextAction: string
  items: {
    id:            string
    productName:   string
    quantityLabel: string
    statusLabel:   string
    stageLabel:    string
  }[]
}
