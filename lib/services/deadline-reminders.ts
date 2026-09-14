/**
 * Los tres vencimientos que no avisaban a nadie.
 *
 * Patrón P3 de la auditoría 2026-09-14 —«lo que no tiene cron depende de que
 * alguien abra la pantalla»— en sus tres instancias restantes:
 *
 *  - `FLO-002`: revisión técnica, seguro y permiso de circulación de un
 *    vehículo tienen fecha de vencimiento, salen en la ficha, en la lista y en
 *    un KPI del tablero, y no disparan ningún aviso. Es la exposición legal más
 *    directa del módulo de flota.
 *  - `MIP-001`: la revisión anual de la MIPER y el plazo de 30 días que abre un
 *    incidente crean un disparador que sólo se ve en el tablero de su propio
 *    módulo.
 *  - `PRI-001`: la respuesta a una solicitud de derechos del titular tiene
 *    plazo legal y dependía de que alguien lo escribiera a mano y después se
 *    acordara de mirar.
 *
 * El contraejemplo estaba dentro del repositorio: mantenciones avisa por SLA,
 * CAPA por vencimiento, capacitación con 60 días de anticipación. La
 * infraestructura de recordatorios existe y funciona en cinco dominios; estos
 * tres no la usaban.
 *
 * Todo aviso es **idempotente por `dedupeKey`**, con la fecha de vencimiento
 * dentro de la llave: correr el cron varias veces al día no repite el correo, y
 * si la fecha se corrige nace un aviso nuevo, que es lo correcto.
 */

import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetVehicleDocuments,
  fuelVehicles,
  preventionPrivacyRequests,
  preventionRiskReviewTriggers,
  workers,
} from "@/db/schema"
import { createNotifications } from "@/lib/services/notification-create"
import {
  getUserIdsWithPermission,
  getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notification-targeting"

/** Cuánto antes se avisa. Un mes para un trámite legal es margen de gestión. */
export const DEADLINE_WARNING_DAYS = 30

export interface DeadlineReminderResult {
  fleetDocuments: number
  riskReviews: number
  privacyRequests: number
  deliveries: number
}

const plusDays = (from: Date, days: number) =>
  new Date(from.getTime() + days * 86_400_000)

/** `YYYY-MM-DD`, que es como guardan la fecha estas tres tablas o parte de ellas. */
const asPlainDate = (value: Date) => value.toISOString().slice(0, 10)

const etiqueta = (vencido: boolean) => (vencido ? "vencido" : "por vencer")

/* ── FLO-002 · documentos legales del vehículo ───────────────────────────── */

const DOCUMENT_LABEL: Record<string, string> = {
  revision_tecnica: "La revisión técnica",
  seguro: "El seguro",
  permiso_circulacion: "El permiso de circulación",
}

async function remindFleetDocuments(now: Date): Promise<{ examined: number; deliveries: number }> {
  const horizon = asPlainDate(plusDays(now, DEADLINE_WARNING_DAYS))
  const today = asPlainDate(now)

  const rows = await db
    .select({
      id: fleetVehicleDocuments.id,
      documentType: fleetVehicleDocuments.documentType,
      expiresAt: fleetVehicleDocuments.expiresAt,
      vehicleId: fuelVehicles.id,
      vehicleCode: fuelVehicles.code,
      worksiteId: fuelVehicles.worksiteId,
    })
    .from(fleetVehicleDocuments)
    .innerJoin(fuelVehicles, eq(fleetVehicleDocuments.vehicleId, fuelVehicles.id))
    .where(and(
      // Sólo el documento vigente de cada tipo: la historia `replaced` está ahí
      // para poder auditar, no para reclamar por una póliza que ya se renovó.
      eq(fleetVehicleDocuments.status, "current"),
      isNotNull(fleetVehicleDocuments.expiresAt),
      lte(fleetVehicleDocuments.expiresAt, horizon),
    ))

  let deliveries = 0
  for (const row of rows) {
    if (!row.expiresAt) continue
    const vencido = row.expiresAt < today
    const recipients = await getUserIdsWithPermissionForWorksite("flota:manage_documents", row.worksiteId)
    if (recipients.length === 0) continue

    const que = DOCUMENT_LABEL[row.documentType] ?? `El documento «${row.documentType}»`
    await createNotifications(recipients, {
      type: vencido ? "fleet_document_overdue" : "fleet_document_due_soon",
      title: `${row.vehicleCode}: ${que.toLowerCase()} está ${etiqueta(vencido)}`,
      body: vencido
        ? `${que} venció el ${row.expiresAt}. El vehículo no puede circular hasta renovarlo.`
        : `${que} vence el ${row.expiresAt}.`,
      entityType: "fleet_vehicle",
      entityId: row.vehicleId,
      entityHref: `/flota/${row.vehicleId}`,
      dedupeKey: `fleet-document:${row.id}:${etiqueta(vencido)}:${row.expiresAt}`,
    })
    deliveries += recipients.length
  }
  return { examined: rows.length, deliveries }
}

/* ── MIP-001 · revisiones de la matriz de riesgos ────────────────────────── */

async function remindRiskReviews(now: Date): Promise<{ examined: number; deliveries: number }> {
  const horizon = asPlainDate(plusDays(now, DEADLINE_WARNING_DAYS))
  const today = asPlainDate(now)

  const rows = await db
    .select({
      id: preventionRiskReviewTriggers.id,
      worksiteId: preventionRiskReviewTriggers.worksiteId,
      description: preventionRiskReviewTriggers.description,
      dueAt: preventionRiskReviewTriggers.dueAt,
      assignedToUserId: preventionRiskReviewTriggers.assignedToUserId,
    })
    .from(preventionRiskReviewTriggers)
    .where(and(
      inArray(preventionRiskReviewTriggers.status, ["pending", "in_progress"]),
      lte(preventionRiskReviewTriggers.dueAt, horizon),
    ))

  let deliveries = 0
  for (const row of rows) {
    const vencido = row.dueAt < today
    const recipients = new Set(await getUserIdsWithPermissionForWorksite("prevention:risk:edit", row.worksiteId))
    if (row.assignedToUserId) recipients.add(row.assignedToUserId)
    if (recipients.size === 0) continue

    await createNotifications([...recipients], {
      type: vencido ? "risk_review_overdue" : "risk_review_due_soon",
      title: `Revisión de matriz de riesgos ${etiqueta(vencido)}`,
      body: `${row.description} — plazo ${row.dueAt}.`,
      entityType: "prevention_risk_review_trigger",
      entityId: row.id,
      entityHref: "/prevencion/miper",
      dedupeKey: `risk-review:${row.id}:${etiqueta(vencido)}:${row.dueAt}`,
    })
    deliveries += recipients.size
  }
  return { examined: rows.length, deliveries }
}

/* ── PRI-001 · solicitudes de derechos del titular ───────────────────────── */

async function remindPrivacyRequests(now: Date): Promise<{ examined: number; deliveries: number }> {
  const horizonIso = plusDays(now, DEADLINE_WARNING_DAYS).toISOString()
  const nowIso = now.toISOString()

  const rows = await db
    .select({
      id: preventionPrivacyRequests.id,
      rightType: preventionPrivacyRequests.rightType,
      dueAt: preventionPrivacyRequests.dueAt,
      handledByUserId: preventionPrivacyRequests.handledByUserId,
      subjectFirstName: workers.firstName,
      subjectLastName: workers.lastName,
    })
    .from(preventionPrivacyRequests)
    .innerJoin(workers, eq(preventionPrivacyRequests.subjectWorkerId, workers.id))
    .where(and(
      // Ni completada ni rechazada: ésas ya no tienen plazo que correr.
      sql`${preventionPrivacyRequests.status} NOT IN ('completada', 'rechazada')`,
      isNotNull(preventionPrivacyRequests.dueAt),
      lte(preventionPrivacyRequests.dueAt, horizonIso),
    ))

  // No tiene faena: la solicitud de un titular es un trámite de la organización.
  const responsables = await getUserIdsWithPermission("prevention:privacy:manage_requests")

  let deliveries = 0
  for (const row of rows) {
    if (!row.dueAt) continue
    const vencido = row.dueAt < nowIso
    const recipients = new Set(responsables)
    if (row.handledByUserId) recipients.add(row.handledByUserId)
    if (recipients.size === 0) continue

    const titular = `${row.subjectFirstName} ${row.subjectLastName}`.trim()
    await createNotifications([...recipients], {
      type: vencido ? "privacy_request_overdue" : "privacy_request_due_soon",
      title: `Solicitud de derechos ${etiqueta(vencido)} — ${titular}`,
      body: `Derecho de ${row.rightType}. Plazo legal: ${row.dueAt.slice(0, 10)}.`,
      entityType: "prevention_privacy_request",
      entityId: row.id,
      entityHref: "/prevencion/privacidad",
      dedupeKey: `privacy-request:${row.id}:${etiqueta(vencido)}:${row.dueAt}`,
    })
    deliveries += recipients.size
  }
  return { examined: rows.length, deliveries }
}

/**
 * Los tres barridos en una corrida. Van juntos porque son el mismo trabajo
 * —mirar una fecha y avisar— sobre tres tablas, y separarlos en tres crones
 * habría triplicado la configuración del planificador externo sin ganar nada.
 */
export async function runDeadlineReminders(now = new Date()): Promise<DeadlineReminderResult> {
  const [fleet, risk, privacy] = await Promise.all([
    remindFleetDocuments(now),
    remindRiskReviews(now),
    remindPrivacyRequests(now),
  ])
  return {
    fleetDocuments: fleet.examined,
    riskReviews: risk.examined,
    privacyRequests: privacy.examined,
    deliveries: fleet.deliveries + risk.deliveries + privacy.deliveries,
  }
}
