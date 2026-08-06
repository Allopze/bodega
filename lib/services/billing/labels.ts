/**
 * lib/services/billing/labels.ts
 *
 * Vocabulario visible del módulo: cada estado interno tiene un texto en español
 * y un tono del sistema visual.
 *
 * Reglas que este archivo hace cumplir:
 * - **el estado siempre se dice con palabras**, el color solo acompaña;
 * - el verde no premia cualquier cosa positiva ni el rojo castiga cualquier cosa
 *   no final: "pendiente de pago" es neutro, no rojo; "vencida" sí es peligro;
 * - "facturado" y "cobrado" nunca comparten etiqueta ni tono.
 */

import type { BillingProviderId } from "@/db/schema"

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "signal" | "info" | "danger" | "outline"

/**
 * Regla de tonos (UI/UX 2026-08-05, M1): las dimensiones de ESTADO usan solo
 * variantes con tipografia severity (neutral/primary/success/warning/signal/
 * danger) para que una misma columna no mezcle mono-uppercase con prose.
 * `info`/`outline`/`default` (prose) quedan para chips informativos sueltos.
 */
export interface StatusLabel {
  label: string
  tone: BadgeTone
  /** Explicación breve para tooltip o glosario. */
  hint?: string
}

/* ── Estado documental ───────────────────────────────────────────────────── */

const DOCUMENT_STATUS: Record<string, StatusLabel> = {
  draft:    { label: "Pendiente de envío", tone: "neutral", hint: "Emitida en el portal pero aún no enviada al SII." },
  issued:   { label: "Emitida",            tone: "primary",    hint: "Enviada al SII; sin acuse de aceptación todavía." },
  accepted: { label: "Aceptada por el SII", tone: "success", hint: "El SII acusó recibo conforme." },
  rejected: { label: "Rechazada por el SII", tone: "danger", hint: "El SII rechazó el documento." },
  void:     { label: "Anulada",            tone: "neutral", hint: "No cuenta como facturación válida." },
  unknown:  { label: "Sin estado",         tone: "neutral", hint: "La fuente no informa estado tributario." },
}

export function documentStatusLabel(status: string): StatusLabel {
  return DOCUMENT_STATUS[status] ?? DOCUMENT_STATUS.unknown!
}

/* ── Estado de pago ──────────────────────────────────────────────────────── */

const PAYMENT_STATUS: Record<string, StatusLabel> = {
  // Pendiente de pago NO es un problema por sí solo: es el estado normal de una
  // factura recién emitida. El peligro es el vencimiento, no la deuda.
  unpaid:   { label: "Pendiente de pago",  tone: "neutral", hint: "Sin pagos confirmados." },
  partial:  { label: "Pago parcial",       tone: "warning", hint: "Tiene pagos confirmados por menos del total." },
  paid:     { label: "Pagada",             tone: "success", hint: "Pagos confirmados cubren el total." },
  overpaid: { label: "Pagada de más",      tone: "signal",  hint: "Los pagos confirmados superan el total: revisar." },
}

export function paymentStatusLabel(status: string): StatusLabel {
  return PAYMENT_STATUS[status] ?? PAYMENT_STATUS.unpaid!
}

/* ── Estado de cobranza ──────────────────────────────────────────────────── */

const COLLECTION_STATUS: Record<string, StatusLabel> = {
  none:        { label: "Sin gestión",         tone: "neutral" },
  in_progress: { label: "En gestión",          tone: "primary" },
  committed:   { label: "Compromiso de pago",  tone: "primary", hint: "El cliente comprometió una fecha de pago." },
  disputed:    { label: "En disputa",          tone: "warning", hint: "El cliente objetó el cobro." },
  closed:      { label: "Gestión cerrada",     tone: "success" },
  written_off: { label: "Castigada",           tone: "neutral", hint: "Se dio por incobrable." },
}

export function collectionStatusLabel(status: string): StatusLabel {
  return COLLECTION_STATUS[status] ?? COLLECTION_STATUS.none!
}

/* ── Vencimiento ─────────────────────────────────────────────────────────── */

/**
 * Estado de vencimiento en texto. Distingue "vencida" de "pendiente": una
 * factura pendiente dentro de plazo no es un problema.
 */
export function dueStatusLabel(
  daysOverdue: number | null,
  paymentStatus: string,
): StatusLabel | null {
  if (daysOverdue === null) return { label: "Sin vencimiento", tone: "neutral", hint: "Ni el documento ni el contrato definen plazo." }
  if (paymentStatus === "paid") return null
  if (daysOverdue > 0) {
    return {
      label: `Vencida hace ${daysOverdue} ${daysOverdue === 1 ? "día" : "días"}`,
      tone: "danger",
    }
  }
  const remaining = Math.abs(daysOverdue)
  if (remaining <= 7) {
    return { label: remaining === 0 ? "Vence hoy" : `Vence en ${remaining} ${remaining === 1 ? "día" : "días"}`, tone: "warning" }
  }
  return { label: `Vence en ${remaining} días`, tone: "neutral" }
}

/* ── Propuestas ──────────────────────────────────────────────────────────── */

const PROPOSAL_STATUS: Record<string, StatusLabel> = {
  draft:     { label: "Borrador",             tone: "neutral" },
  in_review: { label: "En revisión",          tone: "primary" },
  observed:  { label: "Observada",            tone: "warning", hint: "Devuelta con observaciones que hay que resolver." },
  approved:  { label: "Aprobada",             tone: "success" },
  ready:     { label: "Lista para facturar",  tone: "primary", hint: "Aprobada y con antecedentes completos. La emisión del DTE sigue siendo manual." },
  invoiced:  { label: "Relacionada con factura", tone: "success" },
  closed:    { label: "Cerrada",              tone: "neutral" },
  rejected:  { label: "Rechazada",            tone: "danger" },
  cancelled: { label: "Anulada",              tone: "neutral" },
}

export function proposalStatusLabel(status: string): StatusLabel {
  return PROPOSAL_STATUS[status] ?? PROPOSAL_STATUS.draft!
}

/* ── Sincronización ──────────────────────────────────────────────────────── */

const SYNC_STATUS: Record<string, StatusLabel> = {
  running: { label: "En curso",   tone: "primary" },
  success: { label: "Exitosa",    tone: "success" },
  partial: { label: "Parcial",    tone: "warning", hint: "Terminó, pero con documentos que no se pudieron procesar." },
  failed:  { label: "Con error",  tone: "danger" },
  skipped: { label: "Omitida",    tone: "neutral" },
}

export function syncStatusLabel(status: string): StatusLabel {
  return SYNC_STATUS[status] ?? SYNC_STATUS.skipped!
}

const SYNC_SCOPE: Record<string, string> = {
  sales_invoices:    "Facturas de venta",
  purchase_invoices: "Facturas de proveedor",
  bank_transactions: "Movimientos bancarios",
}

export function syncScopeLabel(scope: string): string {
  return SYNC_SCOPE[scope] ?? scope
}

const SYNC_TRIGGER: Record<string, string> = {
  manual:   "Manual",
  cron:     "Automática",
  backfill: "Carga histórica",
}

export function syncTriggerLabel(trigger: string): string {
  return SYNC_TRIGGER[trigger] ?? trigger
}

/* ── Procedencia del dato ────────────────────────────────────────────────── */

const PROVIDER_LABEL: Record<BillingProviderId, string> = {
  factura_en_linea: "FacturaEnLínea",
  chipax:           "Chipax",
  manual:           "Carga manual",
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider as BillingProviderId] ?? provider
}

/** De dónde salió el vencimiento. Se muestra para no confundir dato con inferencia. */
const DUE_DATE_SOURCE: Record<string, string> = {
  provider: "declarado en el documento",
  contract: "derivado del plazo del contrato",
  client:   "derivado del plazo del cliente",
  manual:   "fijado a mano",
}

export function dueDateSourceLabel(source: string | null): string | null {
  return source ? DUE_DATE_SOURCE[source] ?? source : null
}

/* ── Vínculos y pagos ────────────────────────────────────────────────────── */

const VERIFICATION_STATUS: Record<string, StatusLabel> = {
  suggested: { label: "Sugerido",  tone: "neutral",    hint: "Propuesto por la plataforma. No cuenta hasta que una persona lo confirme." },
  confirmed: { label: "Confirmado", tone: "success", hint: "Validado por una persona autorizada." },
  rejected:  { label: "Descartado", tone: "neutral" },
}

export function verificationStatusLabel(status: string): StatusLabel {
  return VERIFICATION_STATUS[status] ?? VERIFICATION_STATUS.suggested!
}

const CONFIDENCE: Record<string, StatusLabel> = {
  high:   { label: "Confianza alta",  tone: "success" },
  medium: { label: "Confianza media", tone: "warning" },
  low:    { label: "Confianza baja",  tone: "neutral" },
}

export function confidenceLabel(confidence: string | null): StatusLabel | null {
  return confidence ? CONFIDENCE[confidence] ?? null : null
}

/* ── Gestiones de cobranza ───────────────────────────────────────────────── */

const ACTION_TYPE: Record<string, string> = {
  call:       "Llamada",
  email:      "Correo",
  meeting:    "Reunión",
  note:       "Observación",
  claim:      "Reclamo formal",
  commitment: "Compromiso de pago",
  dispute:    "Disputa",
}

export function actionTypeLabel(type: string): string {
  return ACTION_TYPE[type] ?? type
}

const ACTION_OUTCOME: Record<string, StatusLabel> = {
  contacted:        { label: "Contactado",          tone: "primary" },
  no_answer:        { label: "Sin respuesta",       tone: "neutral" },
  promised_payment: { label: "Prometió pago",       tone: "primary" },
  disputed:         { label: "Objetó el cobro",     tone: "warning" },
  escalated:        { label: "Escalado",            tone: "warning" },
  resolved:         { label: "Resuelto",            tone: "success" },
  other:            { label: "Otro",                tone: "neutral" },
}

export function actionOutcomeLabel(outcome: string): StatusLabel {
  return ACTION_OUTCOME[outcome] ?? ACTION_OUTCOME.other!
}

const CHANNEL: Record<string, string> = {
  phone:     "Teléfono",
  email:     "Correo",
  in_person: "Presencial",
  portal:    "Portal del cliente",
  letter:    "Carta",
  other:     "Otro",
}

export function channelLabel(channel: string | null): string | null {
  return channel ? CHANNEL[channel] ?? channel : null
}

/* ── Tipos de documento tributario ───────────────────────────────────────── */

const DOC_TYPE: Record<string, string> = {
  "33":  "Factura electrónica",
  "34":  "Factura exenta",
  "39":  "Boleta electrónica",
  "41":  "Boleta exenta",
  "43":  "Liquidación factura",
  "46":  "Factura de compra",
  "52":  "Guía de despacho",
  "56":  "Nota de débito",
  "61":  "Nota de crédito",
  "110": "Factura de exportación",
  "111": "Nota de débito exportación",
  "112": "Nota de crédito exportación",
}

export function docTypeLabel(docType: string): string {
  return DOC_TYPE[docType] ?? `Documento ${docType}`
}

/** Forma corta para tablas: "Factura 1234". */
export function docTypeShortLabel(docType: string): string {
  const map: Record<string, string> = {
    "33": "Factura", "34": "Factura exenta", "39": "Boleta", "41": "Boleta exenta",
    "56": "Nota de débito", "61": "Nota de crédito", "52": "Guía",
  }
  return map[docType] ?? `Doc. ${docType}`
}

/* ── Fechas ──────────────────────────────────────────────────────────────── */

/** Fecha absoluta y legible: "15 de julio de 2026". Nunca "hace 3 días". */
export function formatDate(date: string | null): string {
  if (!date) return "—"
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString("es-CL", {
    day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago",
  })
}

/** Fecha corta para tablas: "15-07-2026". */
export function formatDateShort(date: string | null): string {
  if (!date) return "—"
  const [year, month, day] = date.slice(0, 10).split("-")
  return year && month && day ? `${day}-${month}-${year}` : date
}

/** Fecha y hora de un timestamp, con zona horaria explícita. */
export function formatDateTime(timestamp: string | null): string {
  if (!timestamp) return "—"
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return timestamp
  return `${parsed.toLocaleString("es-CL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago",
  })} (hora de Chile)`
}

/** Período "2026-07" → "julio de 2026". */
export function formatPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("es-CL", {
    month: "long", year: "numeric", timeZone: "UTC",
  })
}
