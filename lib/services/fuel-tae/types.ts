import type { fuelTaeSubmissions } from "@/db/schema"
import type { TaeEvidenceKind } from "@/lib/validation/fuel-tae"

export type { TaeEvidenceKind }

export interface TaeEvidenceUpload {
  kind: TaeEvidenceKind
  fileName: string
  mimeType: string
  buffer: Buffer
}

export interface FieldLoadVehicle {
  id: string
  code: string | null
  plate: string
  type: string
  /** `none`: el equipo no tiene tablero que leer; la lectura no se exige. */
  meterType: "odometer" | "hour_meter" | "none"
  tankCapacityLiters: number | null
  products: Array<{ id: string; name: string; unit: string }>
}

/** Lo que el formulario de terreno necesita saber: lo comparten la PWA por QR y el registro autenticado. */
export interface TaeAccessConfig {
  worksite: { id: string; name: string }
  loadingPoint: { id: string; name: string; type: string } | null
  vehicles: FieldLoadVehicle[]
  /**
   * `name` es el nombre de pantalla (`supplyMediumNameSql`); `matchName` es el que está en el catálogo.
   * La sugerencia por lugar de carga compara con `matchName`: el nombre de pantalla puede cambiar sin que
   * el lugar («Surtidor TAE») deje de nombrar a su medio. Opcional: una configuración guardada sin
   * conexión antes de existir este campo no lo trae.
   */
  supplyMedia: Array<{ id: string; name: string; matchName?: string }>
}

export type TaeSubmissionRow = typeof fuelTaeSubmissions.$inferSelect

export interface TaeAlert {
  code: "manual_identity" | "seal_mismatch" | "seal_reused" | "reading_regression" | "possible_duplicate" | "low_ocr_confidence"
  message: string
}
