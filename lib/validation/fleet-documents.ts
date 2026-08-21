import { z } from "zod"
import { civilDate } from "./dates"

/**
 * Taxonomía de documentos de flota.
 *
 * Antes la lista vivía sólo en el componente y el servidor aceptaba cualquier
 * string: un POST directo creaba tipos inventados que después no calzaban con
 * ningún filtro ni alerta de vencimiento, y nadie los veía como error.
 */
/*
 * Los valores son las etiquetas que la ficha viene escribiendo desde siempre;
 * son también lo que hay guardado en `fleet_vehicle_documents.document_type`.
 * No se migran a slugs para no dejar el histórico fuera de su propia taxonomía.
 */
export const FLEET_DOCUMENT_TYPES = [
  "SOAP",
  "Revisión técnica",
  "Permiso de circulación",
  "Seguro",
  "Padrón",
  "Certificado de emisiones",
  "Manual del vehículo",
  "Otro",
] as const

export type FleetDocumentType = (typeof FLEET_DOCUMENT_TYPES)[number]

export const fleetDocumentMetadataSchema = z.object({
  vehicleId: z.string().trim().min(1, "Vehículo requerido"),
  documentType: z.string().trim().min(1, "Tipo de documento requerido")
    .pipe(z.enum(FLEET_DOCUMENT_TYPES, { message: "Tipo de documento no reconocido" })),
  expiresAt: civilDate("Fecha de vencimiento inválida").nullable().optional(),
})

export type FleetDocumentMetadata = z.infer<typeof fleetDocumentMetadataSchema>

/**
 * Tipos documentales que duplican una columna del equipo.
 *
 * La columna es la fuente canónica: es la que edita la ficha y la que alimenta
 * las alertas desde siempre. El documento vigente sólo aporta su vencimiento
 * cuando esa columna está vacía, para no contar dos veces el mismo hecho ni
 * dejar que una póliza subida sin actualizar la ficha mueva la vigencia sola.
 */
export const DOCUMENT_TYPE_CANONICAL_FIELD = {
  "SOAP": "soapExpiresAt",
  "Revisión técnica": "technicalReviewExpiresAt",
  "Permiso de circulación": "circulationPermitExpiresAt",
  "Seguro": "insuranceExpiresAt",
} as const satisfies Partial<Record<FleetDocumentType, string>>

export type CanonicalExpiryField = (typeof DOCUMENT_TYPE_CANONICAL_FIELD)[keyof typeof DOCUMENT_TYPE_CANONICAL_FIELD]

/**
 * Vencimiento vigente de un equipo: las columnas declaradas, más el documento
 * vigente de cada tipo cuya columna no esté declarada.
 */
export function resolveExpiryCandidates(
  declared: Partial<Record<CanonicalExpiryField, string | null>>,
  currentDocuments: Array<{ documentType: string; expiresAt: string | null }>,
): string[] {
  const candidates = Object.values(declared).filter((value): value is string => Boolean(value))
  for (const document of currentDocuments) {
    if (!document.expiresAt) continue
    const field = DOCUMENT_TYPE_CANONICAL_FIELD[document.documentType as keyof typeof DOCUMENT_TYPE_CANONICAL_FIELD]
    if (field && declared[field]) continue
    candidates.push(document.expiresAt)
  }
  return candidates
}
