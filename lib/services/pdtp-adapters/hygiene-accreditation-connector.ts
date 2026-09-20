/**
 * lib/services/pdtp-adapters/hygiene-accreditation-connector.ts
 *
 * Conector entre el módulo de Higiene y Vigilancia y el motor de
 * auto-acreditación PDTP (`accreditPdtpFromEvent`).
 *
 * Mapeo de actividades del programa 2026:
 * - N°45 "Evaluación cuantitativas por mutual" → una medición de exposición
 *   registrada. La N°44 (cualitativa) NO está aquí: es constancia manual, ver
 *   `scripts/apply-pdtp-2026-mechanisms.ts`.
 * - N°46 a N°49 "Desarrollo protocolo MINSAL y seguimiento" → el pronunciamiento
 *   sobre la aplicabilidad del protocolo en la faena, uno por protocolo.
 * - N°50 "Controlar trabajadores expuestos a programa de vigilancia" → cada
 *   control efectivamente realizado (matrícula en `attended`). Se mide por
 *   cobertura contra el padrón de expuestos.
 *
 * Va en un archivo propio, y no dentro de `pdtp-accreditation-connectors.ts`,
 * por el mismo criterio que el conector del RE-20: es un dominio con su propia
 * tabla de mapeos.
 *
 * Todos los conectores son fire-and-forget: el registro de higiene ya está
 * confirmado en su transacción y una acreditación fallida se reintenta al
 * repetir el hecho, nunca tumba el registro.
 */

import type { AccreditationInput } from "@/lib/services/pdtp/accreditation"
import { recordPdtpFulfillmentEvent, recordPdtpFulfillmentRevocation } from "@/lib/services/pdtp/fulfillment"
import { recordPdtpTriggerEventSafe } from "@/lib/services/pdtp/trigger-events"
import { pdtpCatalogActivityIdForLegacyNumber } from "./catalog-activities-2026"

/** N°45: "Evaluación cuantitativas por mutual". */
const PDTP_QUANTITATIVE_MEASUREMENT_ACTIVITY_NUMBER = 45
/** N°50: "Controlar trabajadores expuestos a programa de vigilancia". */
const PDTP_SURVEILLANCE_CONTROL_ACTIVITY_NUMBER = 50

/**
 * Los cuatro protocolos MINSAL que el programa 2026 planifica uno por uno.
 *
 * Los otros cuatro del catálogo (`lib/prevention/minsal-protocols.ts`: sílice,
 * citostáticos, hiperbaria y frío/calor) no tienen actividad en el programa:
 * pronunciarse sobre ellos es correcto y no acredita nada. Por eso el mapa es
 * parcial a propósito y `pdtpActivityNumberForProtocol` devuelve `null` en vez
 * de lanzar.
 */
export const PDTP_PROTOCOL_ACTIVITY_NUMBERS: Readonly<Record<string, number>> = {
  prexor: 46,
  tmert: 47,
  psicosocial: 48,
  uv: 49,
}

/** Número de actividad PDTP de un protocolo MINSAL, o `null` si no acredita. */
export function pdtpActivityNumberForProtocol(protocolCode: string): number | null {
  return PDTP_PROTOCOL_ACTIVITY_NUMBERS[protocolCode] ?? null
}

/**
 * Ancla una fecha civil al mediodía UTC (08:00–09:00 en Chile).
 *
 * `measuredOn`, `attendedOn` y `lastAssessedOn` son fechas civiles `YYYY-MM-DD`,
 * no timestamps. El motor ubica el período contando el día en
 * `America/Santiago`, así que `new Date("2026-03-01")` —que es medianoche UTC,
 * o sea las 21:00 del 28 de febrero en Chile— archivaría la medición en
 * febrero semana 4. Mismo criterio que `lib/services/deliveries-worker-stock.ts`,
 * sin su excepción para "hoy": ahí se conserva la hora real para ordenar las
 * entregas del día, y acá sólo importa en qué mes y semana cae el hecho.
 */
function occurredAtFromChileDate(plainDate: string): string {
  return `${plainDate}T12:00:00.000Z`
}

/** Ejecuta la acreditación de forma durable: el registro de higiene ya existe. */
async function safeAccredit(input: AccreditationInput): Promise<void> {
  await recordPdtpFulfillmentEvent(input)
}

// ── N°45: medición cuantitativa de exposición ─────────────────────────────────

/**
 * Llama desde `recordExposureMeasurement`, después del commit.
 *
 * El módulo de higiene no distingue borrador de confirmado —cada insert es
 * final— así que el registro de la medición ES el hecho acreditable. La
 * medición no tiene faena propia: se deriva del GES que la agrupa.
 */
export async function onExposureMeasurementRecorded(input: {
  measurementId: string
  worksiteId: string
  groupCode: string
  agentCode: string
  outcome: string
  measuredOn: string
  reportReference: string | null
  /** Ruta del informe de laboratorio. Es la evidencia real de la N°45. */
  evidencePath?: string | null
}): Promise<void> {
  await recordPdtpTriggerEventSafe({
    connectorKey: "hygiene",
    eventKey: "measurement_completed",
    sourceType: "higiene",
    sourceId: `medicion:${input.measurementId}`,
    worksiteId: input.worksiteId,
    occurredAt: occurredAtFromChileDate(input.measuredOn),
    payload: { measurementId: input.measurementId, groupCode: input.groupCode, agentCode: input.agentCode, outcome: input.outcome },
  })
  /* La ruta del informe primero: es el documento, no su folio. `reportReference`
   * queda como segunda opción para las mediciones anteriores a que el archivo
   * fuera obligatorio, y el rótulo descriptivo como último recurso — el motor
   * decide mirando el prefijo `storage/`. */
  const evidenceRef = input.evidencePath?.trim()
    || input.reportReference?.trim()
    || `Medición de exposición ${input.measurementId} · GES ${input.groupCode}`

  await safeAccredit({
    sourceType: "higiene",
    sourceId: `medicion:${input.measurementId}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(PDTP_QUANTITATIVE_MEASUREMENT_ACTIVITY_NUMBER)],
    occurredAt: occurredAtFromChileDate(input.measuredOn),
    executedQuantity: 1,
    evidenceRef,
    metadata: {
      groupCode: input.groupCode,
      agentCode: input.agentCode,
      outcome: input.outcome,
      measuredOn: input.measuredOn,
    },
  })
}

// ── N°46 a N°49: protocolos MINSAL ────────────────────────────────────────────

/**
 * Llama desde `setProtocolApplicability`, después del commit.
 *
 * Acredita cualquier pronunciamiento salvo `pending_assessment`: declarar que
 * un protocolo NO aplica —con justificación obligatoria y respaldo del asesor
 * mutual— también es la evaluación que la actividad pide. Volver a
 * `pending_assessment` es retirar el pronunciamiento, no evaluar.
 *
 * @param version - El `version` YA incrementado que devuelve el upsert. Es el
 *   discriminador de ocurrencia: la clave idempotente del motor no incluye año
 *   ni mes, y la N°46 se planifica cuatro veces al año sobre la MISMA fila de
 *   aplicabilidad (índice único por faena y protocolo). Sin el sufijo `:vN` la
 *   segunda evaluación sería un no-op silencioso.
 */
export async function onProtocolApplicabilityAssessed(input: {
  applicabilityId: string
  worksiteId: string
  protocolCode: string
  protocolShortName: string
  status: "applicable" | "not_applicable" | "pending_assessment"
  version: number
  assessedOn: string
  nextAssessmentOn: string | null
}): Promise<void> {
  if (input.status === "pending_assessment") return

  const activityNumber = pdtpActivityNumberForProtocol(input.protocolCode)
  if (activityNumber === null) return

  await safeAccredit({
    sourceType: "higiene",
    sourceId: `protocolo:${input.applicabilityId}:v${input.version}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(activityNumber)],
    occurredAt: occurredAtFromChileDate(input.assessedOn),
    executedQuantity: 1,
    evidenceRef: `Protocolo ${input.protocolShortName}: ${input.status} (v${input.version})`,
    metadata: {
      protocolCode: input.protocolCode,
      status: input.status,
      version: input.version,
      nextAssessmentOn: input.nextAssessmentOn,
    },
  })
}

// ── N°50: control de vigilancia ───────────────────────────────────────────────

/**
 * Llama desde `recordSurveillanceOutcome` cuando la matrícula queda `attended`.
 *
 * Una ejecución por persona controlada: el numerador de la cobertura es la suma
 * de controles del mes contra el padrón de expuestos cargado en
 * `pdtp_activity_worksite_params`. El id de matrícula ya es "una vez por persona
 * por ciclo" —su índice único es (programa, trabajador, vencimiento)— así que
 * sirve de `sourceId` sin sufijo.
 *
 * @param surveillanceProgramId - El programa de VIGILANCIA, que no es el
 *   programa PDTP. Viaja sólo en `metadata`: pasarlo al `programId` del motor
 *   rompería la resolución del programa anual en silencio.
 */
export async function onSurveillanceControlAttended(input: {
  enrollmentId: string
  worksiteId: string
  surveillanceProgramId: string
  protocol: string
  workerId: string
  groupId: string | null
  attendedOn: string
}): Promise<void> {
  await safeAccredit({
    sourceType: "vigilancia",
    sourceId: `vigilancia:${input.enrollmentId}`,
    worksiteId: input.worksiteId,
    catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(PDTP_SURVEILLANCE_CONTROL_ACTIVITY_NUMBER)],
    occurredAt: occurredAtFromChileDate(input.attendedOn),
    executedQuantity: 1,
    evidenceRef: `Control de vigilancia realizado: ${input.enrollmentId}`,
    metadata: {
      surveillanceProgramId: input.surveillanceProgramId,
      protocol: input.protocol,
      workerId: input.workerId,
      groupId: input.groupId,
      attendedOn: input.attendedOn,
    },
  })
}

/**
 * Revierte la N°50 cuando la matrícula deja de estar `attended`: el control que
 * la sostenía dejó de existir. Las ejecuciones ya aprobadas por una persona no
 * se tocan —eso lo decide `revokePdtpAccreditation`, que las reporta en
 * `skippedApproved`—, porque deshacer una aprobación humana es una decisión
 * humana.
 */
export async function onSurveillanceControlReverted(input: {
  enrollmentId: string
  worksiteId: string
  revokedBy?: string
  reason: string
}): Promise<void> {
  await recordPdtpFulfillmentRevocation({
    sourceType: "vigilancia",
    sourceId: `vigilancia:${input.enrollmentId}`,
    worksiteId: input.worksiteId,
    revokedBy: input.revokedBy,
    reason: input.reason,
  })
}
