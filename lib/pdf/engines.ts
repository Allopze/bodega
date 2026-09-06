/**
 * Qué motor arma cada documento PDF.
 *
 * La plataforma tiene dos: `chromium`, que abre la página de impresión en un
 * navegador sin interfaz y llama a `page.pdf()` (ver `lib/pdf/browser-pool.ts`),
 * y `pdfcn`, que compone el PDF dentro del proceso Node con Takumi. Cada
 * documento declara aquí qué motores tiene **implementados hoy**, y esa lista es
 * la que manda: el ajuste guardado en base de datos y el override de la URL se
 * validan contra ella, no al revés.
 *
 * Este módulo es puro a propósito —sin `@/db`, sin `next/*`, sin `takumi`— para
 * que lo puedan importar tanto la ruta que despacha como el formulario de
 * administración que dibuja el selector. Añadir un documento al selector es una
 * entrada en `PDF_DOCUMENT_SPECS` y nada más.
 */

export const PDF_ENGINES = ["chromium", "pdfcn"] as const
export type PdfEngine = (typeof PDF_ENGINES)[number]

export const PDF_ENGINE_LABELS: Record<PdfEngine, string> = {
  chromium: "Chromium (actual)",
  pdfcn:    "pdfcn / Takumi",
}

export type PdfDocumentId = "oc" | "sst" | "ti" | "entrega" | "guia" | "inspeccion"

export interface PdfDocumentSpec {
  id:            PdfDocumentId
  /** Cómo se llama el documento en administración. */
  label:         string
  /** Clave en `system_settings`. */
  settingKey:    string
  /** Motores implementados para este documento. Uno solo ⇒ no hay nada que elegir. */
  engines:       readonly PdfEngine[]
  defaultEngine: PdfEngine
}

/**
 * Los seis documentos imprimibles. Solo la OC tiene hoy un segundo motor; los
 * demás están listados para que el selector muestre el mapa completo y no
 * parezca que la fila de la OC es un ajuste suelto.
 */
export const PDF_DOCUMENT_SPECS: Record<PdfDocumentId, PdfDocumentSpec> = {
  oc: {
    id: "oc",
    label: "Orden de compra",
    settingKey: "pdf.engine.oc",
    engines: ["chromium", "pdfcn"],
    defaultEngine: "chromium",
  },
  sst: {
    id: "sst",
    label: "Acta SST",
    settingKey: "pdf.engine.sst",
    engines: ["chromium"],
    defaultEngine: "chromium",
  },
  ti: {
    id: "ti",
    label: "Acta de asignación TI",
    settingKey: "pdf.engine.ti",
    engines: ["chromium"],
    defaultEngine: "chromium",
  },
  entrega: {
    id: "entrega",
    label: "Comprobante de entrega",
    settingKey: "pdf.engine.entrega",
    engines: ["chromium"],
    defaultEngine: "chromium",
  },
  guia: {
    id: "guia",
    label: "Guía de despacho",
    settingKey: "pdf.engine.guia",
    engines: ["chromium"],
    defaultEngine: "chromium",
  },
  inspeccion: {
    id: "inspeccion",
    label: "Inspección de prevención",
    settingKey: "pdf.engine.inspeccion",
    engines: ["chromium"],
    defaultEngine: "chromium",
  },
}

/** Orden estable para renderizar el selector. */
export const PDF_DOCUMENT_LIST: readonly PdfDocumentSpec[] = [
  PDF_DOCUMENT_SPECS.oc,
  PDF_DOCUMENT_SPECS.sst,
  PDF_DOCUMENT_SPECS.ti,
  PDF_DOCUMENT_SPECS.entrega,
  PDF_DOCUMENT_SPECS.guia,
  PDF_DOCUMENT_SPECS.inspeccion,
]

/**
 * Interpreta un valor suelto (fila de `system_settings`, query string, campo de
 * formulario) como motor válido **para ese documento**. Devuelve `null` cuando
 * no lo es, en vez de lanzar: quien llama decide si eso significa caer al
 * siguiente escalón o rechazar el guardado.
 */
export function parsePdfEngine(
  doc: PdfDocumentId,
  value: string | null | undefined,
): PdfEngine | null {
  if (typeof value !== "string") return null
  const candidate = value.trim().toLowerCase()
  if (!candidate) return null
  const spec = PDF_DOCUMENT_SPECS[doc]
  return spec.engines.find((engine) => engine === candidate) ?? null
}

/**
 * Precedencia: override de la URL → ajuste guardado → motor por defecto.
 *
 * Cada escalón ya viene validado contra `spec.engines`, y un escalón inválido
 * cae al siguiente en lugar de lanzar. Es deliberado por los dos lados: un
 * `?motor=` mal escrito no debe romper la descarga de un documento, y un ajuste
 * huérfano en base de datos —un motor que se retiró del código— no debe dejar
 * el documento sin generar.
 */
export function resolvePdfEngine(
  doc: PdfDocumentId,
  source: { override?: PdfEngine | null; configured?: PdfEngine | null },
): PdfEngine {
  const spec = PDF_DOCUMENT_SPECS[doc]
  const available = (engine: PdfEngine | null | undefined): engine is PdfEngine =>
    !!engine && spec.engines.includes(engine)

  if (available(source.override)) return source.override
  if (available(source.configured)) return source.configured
  return spec.defaultEngine
}
