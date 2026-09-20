import path from "node:path"

const DELIVERY_ATTACHMENT_PREFIX = "storage/deliveries/"
const INVOICE_ATTACHMENT_PREFIX = "storage/purchase-orders/"
const QUOTATION_ATTACHMENT_PREFIX = "storage/repuestos/"
const SERVICE_QUOTATION_PREFIX = "storage/servicios/"
const FLEET_DOCUMENT_PREFIX = "storage/flota/"
const MAINTENANCE_DOCUMENT_PREFIX = "storage/mantenciones/"
const SST_DOCUMENT_PREFIX = "storage/sst-documents/"
const PDTP_EVIDENCE_PREFIX = "storage/pdtp-evidence/"
const INSPECTION_EVIDENCE_PREFIX = "storage/inspection-evidence/"
const PREVENTION_TRAINING_EVIDENCE_PREFIX = "storage/prevention-training-evidence/"
const PREVENTION_DRILL_EVIDENCE_PREFIX = "storage/prevention-drill-evidence/"
const PREVENTION_ALCOTEST_EVIDENCE_PREFIX = "storage/prevention-alcotest-evidence/"
const CAMPAIGN_EVIDENCE_PREFIX = "storage/campaign-evidence/"
const CGRD_EVIDENCE_PREFIX = "storage/cgrd-evidence/"
const HYGIENE_EVIDENCE_PREFIX = "storage/hygiene-evidence/"
const RISK_MAP_PREFIX = "storage/risk-map/"
const FUEL_IMPORT_PREFIX = "storage/imports/"
const FUEL_TAE_EVIDENCE_PREFIX = "storage/fuel-tae/"
const PREVENTION_SENSITIVE_FILE_PREFIX = "storage/prevention-sensitive/"
const EMERGENCY_RESOURCE_CERTIFICATE_PREFIX = "storage/emergency-resource-certificates/"
const TI_FILE_PREFIX = "storage/ti/"

/**
 * Resolves the base storage directory.
 *
 * Use the env var STORAGE_PATH to override the default location
 * (process.cwd() + "/storage").  On ephemeral / serverless hosts this
 * should point to a persistent volume or object-storage mount.
 *
 * All path.join / path.resolve calls below carry `turbopackIgnore: true`
 * because their first argument is always a runtime value (env var or
 * process.cwd()).  Without the comments Turbopack traces the entire project
 * directory into the standalone bundle and emits the "unexpected file in NFT
 * list" warning.
 */
export function resolveStorageDir(): string {
  if (process.env.STORAGE_PATH?.trim()) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_PATH)
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "storage")
}

export function resolveDeliveriesDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "deliveries")
}

export function createDeliveryAttachmentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid delivery attachment file name")
  }
  return `${DELIVERY_ATTACHMENT_PREFIX}${storageName}`
}

export function resolveDeliveryAttachmentFile(filePath: string): string | null {
  if (!filePath.startsWith(DELIVERY_ATTACHMENT_PREFIX)) {
    return null
  }

  const storageName = filePath.slice(DELIVERY_ATTACHMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }

  return path.join(/*turbopackIgnore: true*/ resolveDeliveriesDir(), storageName)
}

export function resolvePurchaseOrdersDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "purchase-orders")
}

export function createInvoiceAttachmentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid invoice attachment file name")
  }
  return `${INVOICE_ATTACHMENT_PREFIX}${storageName}`
}

export function resolveInvoiceAttachmentFile(filePath: string): string | null {
  if (!filePath.startsWith(INVOICE_ATTACHMENT_PREFIX)) {
    return null
  }

  const storageName = filePath.slice(INVOICE_ATTACHMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }

  return path.join(/*turbopackIgnore: true*/ resolvePurchaseOrdersDir(), storageName)
}

export function resolveRepuestosDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "repuestos")
}

export function resolveServiciosDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "servicios")
}

export function createQuotationAttachmentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid quotation attachment file name")
  }
  return `${QUOTATION_ATTACHMENT_PREFIX}${storageName}`
}

export function resolveQuotationAttachmentFile(filePath: string): string | null {
  if (!filePath.startsWith(QUOTATION_ATTACHMENT_PREFIX)) {
    return null
  }

  const storageName = filePath.slice(QUOTATION_ATTACHMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }

  return path.join(/*turbopackIgnore: true*/ resolveRepuestosDir(), storageName)
}

export function createServiceQuotationPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid service quotation file name")
  }
  return `${SERVICE_QUOTATION_PREFIX}${storageName}`
}

export function resolveServiceQuotationFile(filePath: string): string | null {
  if (!filePath.startsWith(SERVICE_QUOTATION_PREFIX)) {
    return null
  }

  const storageName = filePath.slice(SERVICE_QUOTATION_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }

  return path.join(/*turbopackIgnore: true*/ resolveServiciosDir(), storageName)
}

function isSafeStorageName(storageName: string): boolean {
  return Boolean(storageName)
    && storageName !== "."
    && storageName !== ".."
    && storageName === path.posix.basename(storageName)
    && !storageName.includes("\\")
    && !/[\u0000-\u001f]/.test(storageName)
}

/**
 * Ruta absoluta de un archivo almacenado, a partir de su directorio y su nombre.
 *
 * **Este es el único lugar donde se arma esa ruta.** Turbopack evalúa `path.join` como un
 * patrón de archivo y traza todo lo que calce; cuando el primer argumento es un valor de
 * runtime el patrón globea el proyecto entero. Sin el `turbopackIgnore` de abajo, cada
 * sitio de subida metía el repositorio completo en el trazado: `.next/standalone` llegó a
 * pesar 2,5 GB e incluía `storage/` con 10.316 archivos reales subidos por usuarios
 * —certificados, facturas, documentos SST— dentro de la imagen de producción.
 *
 * El comentario es **léxico**, así que no se puede delegar: tiene que estar en el
 * `path.join` mismo. Por eso vive acá y los llamadores ya no importan `node:path`; un
 * sitio nuevo no puede reintroducir la fuga sin salirse de este módulo a propósito.
 *
 * Valida el nombre igual que `createXPath`: el punto de escritura no tenía esa defensa
 * —sólo la tenía la construcción de la ruta relativa— y es donde más importa.
 */
export function resolveStorageFile(dir: string, storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error(`Invalid storage file name: ${JSON.stringify(storageName)}`)
  }
  return path.join(/*turbopackIgnore: true*/ dir, storageName)
}

/* ── Subdirectorios que se armaban con un join suelto en el sitio de uso ──── */

/** Adjuntos de feedback interno. Antes: `path.join(resolveStorageDir(), "feedback")`. */
export function resolveFeedbackDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "feedback")
}

/** Excel original de cada lote de importación de riesgos (MIPER). */
export function resolveRiskImportsDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "risk-imports")
}

export function resolveFleetDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "flota")
}

export function createFleetDocumentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid fleet document file name")
  }
  return `${FLEET_DOCUMENT_PREFIX}${storageName}`
}

export function resolveFleetDocumentFile(filePath: string): string | null {
  if (!filePath.startsWith(FLEET_DOCUMENT_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(FLEET_DOCUMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolveFleetDir(), storageName)
}

export function resolveMaintenanceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "mantenciones")
}

export function createMaintenanceDocumentPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) throw new Error("Invalid maintenance document file name")
  return `${MAINTENANCE_DOCUMENT_PREFIX}${storageName}`
}

export function resolveMaintenanceDocumentFile(filePath: string): string | null {
  if (!filePath.startsWith(MAINTENANCE_DOCUMENT_PREFIX)) return null
  const storageName = filePath.slice(MAINTENANCE_DOCUMENT_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveMaintenanceDir(), storageName)
}

/* ── Biblioteca SST ────────────────────────────────────────────────────────
 *
 * Almacenamiento para los documentos preventivos de la biblioteca SST.
 * NO comparte espacio con la flota ni con la bodega.
 * El `storageName` es siempre un nanoid con extensión segura; nunca se
 * acepta el nombre original del usuario para evitar traversal.
 */
export function resolveSstDocumentsDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "sst-documents")
}

export function createSstDocumentPath(storageName: string, folderSegments?: readonly string[]): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid sst document storage name")
  }
  const safeSegments = (folderSegments ?? []).map((segment) => {
    if (!isSafeStorageName(segment)) {
      throw new Error("Invalid sst document folder segment")
    }
    return segment
  })
  return `${SST_DOCUMENT_PREFIX}${[...safeSegments, storageName].join("/")}`
}

export function resolveSstDocumentFile(filePath: string): string | null {
  if (!filePath.startsWith(SST_DOCUMENT_PREFIX)) {
    return null
  }
  // El path lógico puede ser anidado: storage/sst-documents/<carpetas>/<name>.
  // Cada segmento se valida por separado (anti-traversal por nivel).
  const relative = filePath.slice(SST_DOCUMENT_PREFIX.length)
  const segments = relative.split("/")
  if (segments.length === 0 || !segments.every(isSafeStorageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolveSstDocumentsDir(), ...segments)
}

/* Archivos sensibles de Prevención: siempre contienen ciphertext AES-GCM. */
export function resolvePreventionSensitiveFilesDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "prevention-sensitive")
}

export function createPreventionSensitiveFilePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) throw new Error("Invalid prevention sensitive storage name")
  return `${PREVENTION_SENSITIVE_FILE_PREFIX}${storageName}`
}

export function resolvePreventionSensitiveFile(filePath: string): string | null {
  if (!filePath.startsWith(PREVENTION_SENSITIVE_FILE_PREFIX)) return null
  const storageName = filePath.slice(PREVENTION_SENSITIVE_FILE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolvePreventionSensitiveFilesDir(), storageName)
}

/* ── Evidencia PDTP ────────────────────────────────────────────────────────
 *
 * Almacenamiento para la evidencia (foto/archivo) de ejecuciones del
 * Programa de Trabajo Preventivo SG-SST. NO comparte espacio con la
 * biblioteca SST ni con el resto de módulos.
 * El `storageName` es siempre un nanoid con extensión segura; nunca se
 * acepta el nombre original del usuario para evitar traversal.
 */
export function resolvePdtpEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "pdtp-evidence")
}

export function createPdtpEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid pdtp evidence storage name")
  }
  return `${PDTP_EVIDENCE_PREFIX}${storageName}`
}

export function resolvePdtpEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(PDTP_EVIDENCE_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(PDTP_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolvePdtpEvidenceDir(), storageName)
}

/* ── Evidencia de campañas preventivas y CGRD ──────────────────────────────
 *
 * Espacios propios, con el mismo criterio anti-traversal que el resto: el
 * `storageName` es siempre un nanoid con extensión segura, nunca el nombre
 * original del archivo.
 */
export function resolveCampaignEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "campaign-evidence")
}

export function createCampaignEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) throw new Error("Invalid campaign evidence storage name")
  return `${CAMPAIGN_EVIDENCE_PREFIX}${storageName}`
}

export function resolveCampaignEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(CAMPAIGN_EVIDENCE_PREFIX)) return null
  const storageName = filePath.slice(CAMPAIGN_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveCampaignEvidenceDir(), storageName)
}

export function resolveCgrdEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "cgrd-evidence")
}

export function createCgrdEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) throw new Error("Invalid cgrd evidence storage name")
  return `${CGRD_EVIDENCE_PREFIX}${storageName}`
}

export function resolveCgrdEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(CGRD_EVIDENCE_PREFIX)) return null
  const storageName = filePath.slice(CGRD_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveCgrdEvidenceDir(), storageName)
}

/* ── Evidencia de inspecciones ─────────────────────────────────────────────
 *
 * Espacio propio, no compartido con la evidencia PDTP: la retención y la
 * auditabilidad de una inspección son las suyas, y mezclarlas obligaría a
 * razonar sobre ambas cada vez que se toca una. Mismo criterio anti-traversal.
 */
export function resolveInspectionEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "inspection-evidence")
}

export function createInspectionEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid inspection evidence storage name")
  }
  return `${INSPECTION_EVIDENCE_PREFIX}${storageName}`
}

export function resolveInspectionEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(INSPECTION_EVIDENCE_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(INSPECTION_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolveInspectionEvidenceDir(), storageName)
}

/* ── Evidencia de ocurrencias de capacitación ────────────────────────────
 * Espacio dedicado para conservar PDF, Office y fotografías del control anual.
 * Las ocurrencias sólo cambian de estado; los archivos no se borran al
 * corregir una marca, por lo que la ruta sigue siendo auditable.
 */
export function resolvePreventionTrainingEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "prevention-training-evidence")
}

export function createPreventionTrainingEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid prevention training evidence storage name")
  }
  return `${PREVENTION_TRAINING_EVIDENCE_PREFIX}${storageName}`
}

export function resolvePreventionTrainingEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(PREVENTION_TRAINING_EVIDENCE_PREFIX)) return null
  const storageName = filePath.slice(PREVENTION_TRAINING_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolvePreventionTrainingEvidenceDir(), storageName)
}

/* ── Evidencia de simulacros de emergencia ───────────────────────────────
 * Mismo contrato que la evidencia de capacitación: los archivos no se borran
 * al corregir el estado de un simulacro, así que la ruta sigue siendo
 * auditable. Antes el simulacro guardaba una sola ruta en su propia fila y la
 * UI nunca la enviaba, de modo que la N°84 acreditaba con un rótulo sintético.
 */
export function resolvePreventionDrillEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "prevention-drill-evidence")
}

export function createPreventionDrillEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid prevention drill evidence storage name")
  }
  return `${PREVENTION_DRILL_EVIDENCE_PREFIX}${storageName}`
}

export function resolvePreventionDrillEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(PREVENTION_DRILL_EVIDENCE_PREFIX)) return null
  const storageName = filePath.slice(PREVENTION_DRILL_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolvePreventionDrillEvidenceDir(), storageName)
}

/* ── Evidencia de higiene ocupacional ─────────────────────────────────────
 * El informe del laboratorio que respalda una medición de exposición. Antes la
 * N°45 se acreditaba con `report_reference`, un folio escrito a mano: un folio
 * no se puede abrir en una fiscalización.
 */
export function resolveHygieneEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "hygiene-evidence")
}

export function createHygieneEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid hygiene evidence storage name")
  }
  return `${HYGIENE_EVIDENCE_PREFIX}${storageName}`
}

export function resolveHygieneEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(HYGIENE_EVIDENCE_PREFIX)) return null
  const storageName = filePath.slice(HYGIENE_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveHygieneEvidenceDir(), storageName)
}

/* ── Evidencia de las casillas de alcotest ────────────────────────────────
 * Mismo contrato que capacitación y simulacros. Cuelga de la casilla y no del
 * control: lo que el programa pide respaldar es el cumplimiento del mes —la
 * planilla de controles, el correo del envío—, no cada lectura del alcotómetro.
 * Antes la N°30/31 y la N°32 acreditaban con un rótulo sintético cuando la UI
 * no mandaba archivo, que es la misma falla que ya tuvo la N°84.
 */
export function resolvePreventionAlcotestEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "prevention-alcotest-evidence")
}

export function createPreventionAlcotestEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid prevention alcotest evidence storage name")
  }
  return `${PREVENTION_ALCOTEST_EVIDENCE_PREFIX}${storageName}`
}

export function resolvePreventionAlcotestEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(PREVENTION_ALCOTEST_EVIDENCE_PREFIX)) return null
  const storageName = filePath.slice(PREVENTION_ALCOTEST_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolvePreventionAlcotestEvidenceDir(), storageName)
}

/* ── Mapa de riesgos (MIPER) ──────────────────────────────────────────────
 *
 * Almacenamiento para el plano de planta de cada faena sobre el que se ubican
 * los marcadores de riesgo. Un plano por faena a la vez (el anterior se
 * archiva, no se borra). Mismo criterio anti-traversal que la evidencia PDTP.
 */
export function resolveRiskMapDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "risk-map")
}

export function createRiskMapPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid risk map storage name")
  }
  return `${RISK_MAP_PREFIX}${storageName}`
}

export function resolveRiskMapFile(filePath: string): string | null {
  if (!filePath.startsWith(RISK_MAP_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(RISK_MAP_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolveRiskMapDir(), storageName)
}

/* ── Importaciones de combustible ────────────────────────────────────────────
 *
 * Almacenamiento para el archivo Excel original de cada lote de importación de
 * consumos de combustible por patente (trazabilidad — ver AGENTS.md).
 * El `storageName` es siempre `${timestamp}-${nanoid}-${nombreSanitizado}`;
 * nunca se acepta el nombre original tal cual para evitar traversal.
 */
export function resolveFuelImportsDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "imports")
}

export function createFuelImportPath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid fuel import file name")
  }
  return `${FUEL_IMPORT_PREFIX}${storageName}`
}

export function resolveFuelImportFile(filePath: string): string | null {
  if (!filePath.startsWith(FUEL_IMPORT_PREFIX)) {
    return null
  }
  const storageName = filePath.slice(FUEL_IMPORT_PREFIX.length)
  if (!isSafeStorageName(storageName)) {
    return null
  }
  return path.join(/*turbopackIgnore: true*/ resolveFuelImportsDir(), storageName)
}

/* ── Evidencia de cargas TAE ──────────────────────────────────────────────── */

export function resolveFuelTaeEvidenceDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "fuel-tae")
}

export function createFuelTaeEvidencePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid TAE evidence storage name")
  }
  return `${FUEL_TAE_EVIDENCE_PREFIX}${storageName}`
}

export function resolveFuelTaeEvidenceFile(filePath: string): string | null {
  if (!filePath.startsWith(FUEL_TAE_EVIDENCE_PREFIX)) return null
  const storageName = filePath.slice(FUEL_TAE_EVIDENCE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveFuelTaeEvidenceDir(), storageName)
}

/* ── XML de proveedores (portal DTE) ─────────────────────────────────────────
 *
 * Copia local del XML del proveedor descargado bajo demanda desde la Bandeja
 * de Entrada del portal DTE (ver dte-portal/bandeja-entrada.ts). Se guarda al
 * verlo por primera vez para no volver a descargarlo del portal.
 */
const DTE_XML_PREFIX = "storage/dte/"

export function resolveDteDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "dte")
}

export function createDtePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) {
    throw new Error("Invalid DTE XML storage name")
  }
  return `${DTE_XML_PREFIX}${storageName}`
}

export function resolveDteFile(filePath: string): string | null {
  if (!filePath.startsWith(DTE_XML_PREFIX)) return null
  const storageName = filePath.slice(DTE_XML_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveDteDir(), storageName)
}

/* ── Certificados de recarga de activos de emergencia ───────────────────── */
export function resolveEmergencyResourceCertificatesDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "emergency-resource-certificates")
}

export function createEmergencyResourceCertificatePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) throw new Error("Invalid emergency resource certificate name")
  return `${EMERGENCY_RESOURCE_CERTIFICATE_PREFIX}${storageName}`
}

export function resolveEmergencyResourceCertificateFile(filePath: string): string | null {
  if (!filePath.startsWith(EMERGENCY_RESOURCE_CERTIFICATE_PREFIX)) return null
  const storageName = filePath.slice(EMERGENCY_RESOURCE_CERTIFICATE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveEmergencyResourceCertificatesDir(), storageName)
}

/* ── Archivos y evidencia fotográfica TI ────────────────────────────────────
 *
 * Espacio propio para fotos de entrega/devolución y documentos del módulo TI.
 * La evidencia ya anclada al acta es inmutable; una carga pendiente que se
 * cancela antes del acta se elimina junto a su fila. Mismo criterio
 * anti-traversal que el resto de prefijos.
 */
export function resolveTiDir(): string {
  return path.join(/*turbopackIgnore: true*/ resolveStorageDir(), "ti")
}

export function createTiFilePath(storageName: string): string {
  if (!isSafeStorageName(storageName)) throw new Error("Invalid TI file storage name")
  return `${TI_FILE_PREFIX}${storageName}`
}

export function resolveTiFile(filePath: string): string | null {
  if (!filePath.startsWith(TI_FILE_PREFIX)) return null
  const storageName = filePath.slice(TI_FILE_PREFIX.length)
  if (!isSafeStorageName(storageName)) return null
  return path.join(/*turbopackIgnore: true*/ resolveTiDir(), storageName)
}
