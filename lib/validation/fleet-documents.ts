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
