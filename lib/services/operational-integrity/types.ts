import type { Tx } from "@/db"
import { fingerprintFor } from "../purchasing-module/invoice-reconciliation"

export type OperationalIntegrityCode =
  | "STOCK_MOVEMENT_CHAIN_BREAK"
  | "STOCK_BALANCE_MISMATCH"
  | "RECEIPT_DISPOSITION_EXCEEDS_LIMIT"
  | "INVOICE_ALLOCATION_INVALID"
  | "INVOICE_RECONCILIATION_STALE"
  | "DISPATCH_GUIDE_SHRINKAGE_UNRESOLVED"

export interface OperationalIntegrityFinding {
  caseKey: string
  fingerprint: string
  domain: "stock" | "receiving" | "purchasing"
  code: OperationalIntegrityCode
  severity: "warning" | "high" | "critical"
  worksiteId: string
  entityType: "stock_item" | "receipt" | "purchase_order" | "dispatch_guide"
  entityId: string
  summary: string
  href: string
  snapshot: Record<string, unknown>
}

/**
 * El escaneo recibe el alcance ya resuelto, no una sesión: así lo puede invocar
 * tanto una acción de usuario como el cron, que no tiene sesión que ofrecer.
 *
 * TRZ-003: `since` es el inicio de la ventana incremental. `null` o ausente
 * significa **escaneo completo**, y es lo que reciben la verificación de un caso
 * y cualquier escaneo manual: cerrar un caso porque su entidad no se movió
 * últimamente sería resolverlo sin evidencia.
 */
export interface IntegrityScanContext { tx: Tx; scope: string[] | "all"; since?: Date | null }
export type IntegrityCaseRef = Pick<OperationalIntegrityFinding, "caseKey" | "domain" | "worksiteId" | "entityId">
export interface OperationalIntegrityDetector {
  domain: OperationalIntegrityFinding["domain"]
  scan(ctx: IntegrityScanContext): Promise<OperationalIntegrityFinding[]>
  verify(ctx: IntegrityScanContext, caseRef: IntegrityCaseRef): Promise<OperationalIntegrityFinding | null>
}

export const integrityDescriptions: Record<OperationalIntegrityCode, { severity: OperationalIntegrityFinding["severity"]; summary: string }> = {
  STOCK_MOVEMENT_CHAIN_BREAK: { severity: "critical", summary: "La secuencia del kardex presenta una diferencia." },
  STOCK_BALANCE_MISMATCH: { severity: "critical", summary: "El saldo físico no coincide con el último movimiento." },
  RECEIPT_DISPOSITION_EXCEEDS_LIMIT: { severity: "high", summary: "La recepción supera la cantidad disponible para esta etapa." },
  INVOICE_ALLOCATION_INVALID: { severity: "critical", summary: "El reparto de una línea de factura requiere corrección." },
  INVOICE_RECONCILIATION_STALE: { severity: "warning", summary: "La conciliación guardada no corresponde a la evidencia actual." },
  // GDI-001: el traslado descontó de la oficina y sumó en la faena; el cotejo
  // dice que llegó menos y ese saldo sigue contado en el destino.
  DISPATCH_GUIDE_SHRINKAGE_UNRESOLVED: { severity: "high", summary: "Una guía de despacho tiene una diferencia cotejada sin regularizar." },
}

/** Only canonical evidence enters the digest; presentation can evolve independently. */
export function integrityFinding(input: Pick<OperationalIntegrityFinding, "domain" | "code" | "worksiteId" | "entityType" | "entityId" | "href" | "snapshot"> & { identity?: string }): OperationalIntegrityFinding {
  const { identity, ...finding } = input
  const caseKey = JSON.stringify([input.code, input.worksiteId, input.entityType, identity ?? input.entityId])
  return { ...finding, ...integrityDescriptions[input.code], caseKey, fingerprint: fingerprintFor({ version: 1, caseKey, evidence: input.snapshot }, 1) }
}
