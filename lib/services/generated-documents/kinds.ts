/**
 * Qué documentos generados se archivan y cómo. Módulo puro: lo importan el
 * encolado (dentro de transacciones de negocio), el procesador y la pantalla de
 * administración.
 *
 * Alcance decidido el 2026-09-24: solo documentos formales de Prevención, que
 * van a la cuenta de Cloudreve de Prevención. La OC, la guía de despacho y el
 * acta TI quedan fuera: irán más adelante a otra cuenta de la empresa, y por
 * eso cada tipo declara su `destination` en vez de suponer una sola.
 */
import type { GeneratedDocumentRenderMode } from "@/db/schema/generated-documents"

export const GENERATED_DOCUMENT_KINDS = [
  "entrega",
  "inspeccion",
  "acta_sst",
  "pdtp_cierre",
  "pdtp_re36",
  "miper",
  "incidente",
] as const
export type GeneratedDocumentKind = (typeof GENERATED_DOCUMENT_KINDS)[number]

export type GeneratedDocumentDestination = "prevencion"

export interface GeneratedDocumentKindSpec {
  kind: GeneratedDocumentKind
  /** Cómo se llama el documento en administración. */
  label: string
  /** Carpeta de módulo en el orden año › faena › módulo. */
  moduleLabel: string
  extension: "pdf" | "xlsx"
  renderMode: GeneratedDocumentRenderMode
  destination: GeneratedDocumentDestination
  /**
   * Permiso para ver el documento en la plataforma. El reintento manual lo
   * exige además de `admin:storage`: reintentar un PDF lo imprime con la sesión
   * de quien pulsa el botón.
   */
  viewPermission: string
}

export const GENERATED_DOCUMENT_KIND_SPECS: Record<GeneratedDocumentKind, GeneratedDocumentKindSpec> = {
  entrega: {
    kind: "entrega", label: "Comprobante de entrega de EPP", moduleLabel: "Entregas de EPP",
    extension: "pdf", renderMode: "session", destination: "prevencion", viewPermission: "deliveries:view",
  },
  inspeccion: {
    kind: "inspeccion", label: "Informe de inspección", moduleLabel: "Inspecciones",
    extension: "pdf", renderMode: "session", destination: "prevencion", viewPermission: "prevention:inspections:view",
  },
  acta_sst: {
    kind: "acta_sst", label: "Acta SST", moduleLabel: "Evaluaciones SST",
    extension: "pdf", renderMode: "session", destination: "prevencion", viewPermission: "sst:view",
  },
  pdtp_cierre: {
    kind: "pdtp_cierre", label: "Cierre de período del PDTP", moduleLabel: "Programa preventivo",
    extension: "xlsx", renderMode: "inprocess", destination: "prevencion", viewPermission: "prevention:pdtp:view",
  },
  pdtp_re36: {
    kind: "pdtp_re36", label: "Planilla RE-36 del programa vigente", moduleLabel: "Programa preventivo",
    extension: "xlsx", renderMode: "inprocess", destination: "prevencion", viewPermission: "prevention:pdtp:view",
  },
  miper: {
    kind: "miper", label: "Matriz MIPER publicada", moduleLabel: "MIPER",
    extension: "xlsx", renderMode: "inprocess", destination: "prevencion", viewPermission: "prevention:risk:view",
  },
  incidente: {
    kind: "incidente", label: "Expediente de incidente cerrado", moduleLabel: "Incidentes",
    extension: "xlsx", renderMode: "inprocess", destination: "prevencion", viewPermission: "prevention:incidents:view",
  },
}

export function isGeneratedDocumentKind(value: string): value is GeneratedDocumentKind {
  return (GENERATED_DOCUMENT_KINDS as readonly string[]).includes(value)
}

/** Hitos con su rótulo para nombres de archivo y la pantalla. */
export const GENERATED_DOCUMENT_MILESTONE_LABELS: Record<string, string> = {
  registrada: "registrada",
  anulada: "anulada",
  completada: "completada",
  revisada: "revisada",
  cerrada: "cerrada",
  cierre: "cierre",
  vigente: "vigente",
  publicada: "publicada",
  cerrado: "cerrado",
}

/** `<programa>:<faena>`: el RE-36 del programa vigente es una planilla por faena operativa. */
export function pdtpRe36EntityId(programId: string, worksiteId: string): string {
  return `${programId}:${worksiteId}`
}

export function generatedDocumentDedupeKey(ref: {
  kind: GeneratedDocumentKind
  entityId: string
  milestone: string
  revision: number
}): string {
  return `${ref.kind}:${ref.entityId}:${ref.milestone}:${ref.revision}`
}

export const GENERATED_DOCUMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  staged: "Por subir",
  uploaded: "Subido",
  failed: "Fallido",
  superseded: "Reemplazado",
}

/**
 * Códigos de error con su explicación para el administrador. El código es lo
 * único que se guarda: un mensaje de excepción puede traer datos o rutas.
 */
export const GENERATED_DOCUMENT_ERROR_LABELS: Record<string, string> = {
  RENDER_UNAUTHORIZED: "La sesión que lo imprimió no puede ver el documento.",
  RENDER_CREDENTIAL_MISSING: "Pasó el momento del hecho sin poder imprimirlo: reinténtalo desde acá.",
  RENDER_FAILED: "No se pudo generar el archivo.",
  PDF_ORIGIN_NOT_CONFIGURED: "Falta PDF_RENDER_ORIGIN o APP_URL en el servidor.",
  INVALID_OUTPUT: "El archivo generado no es válido.",
  SOURCE_NOT_FOUND: "El registro de origen ya no existe.",
  CLOUDREVE_NOT_CONFIGURED: "Cloudreve no está configurado.",
  CLOUDREVE_AUTH: "Cloudreve rechazó las credenciales.",
  CLOUDREVE_TIMEOUT: "Cloudreve no respondió a tiempo.",
  CLOUDREVE_IO: "No se pudo conectar con Cloudreve.",
  CLOUDREVE_UPSTREAM: "Cloudreve respondió con un error.",
  CLOUDREVE_NOT_FOUND: "Cloudreve no encontró la carpeta.",
  UPLOAD_SIZE_MISMATCH: "El archivo subido no coincide en tamaño.",
  REMOTE_KEY_EXHAUSTED: "Ya existen demasiados archivos con ese nombre.",
  STAGING_MISSING: "Se perdió la copia local antes de subirla.",
  ARCHIVE_DISABLED: "El archivado está apagado.",
  UNKNOWN: "Error inesperado.",
}

/** Bytes mágicos: un PDF empieza con `%PDF` y un .xlsx es un ZIP (`PK`). */
export function hasExpectedSignature(buffer: Uint8Array, extension: "pdf" | "xlsx"): boolean {
  const head = String.fromCharCode(...buffer.subarray(0, 4))
  return extension === "pdf" ? head === "%PDF" : head.startsWith("PK")
}
