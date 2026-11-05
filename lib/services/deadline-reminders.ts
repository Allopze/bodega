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
 * CAPA avisa por vencimiento y capacitación con 60 días de anticipación. La
 * infraestructura de recordatorios existe y funciona en cinco dominios; estos
 * tres no la usaban.
 *
 * Desde 2026-11 el barrido de flota mira también las fechas guardadas en el
 * propio equipo (SOAP, permiso de circulación, revisión técnica y seguro), que
 * son las que edita la ficha y las que muestran la lista y el Panel operacional:
 * antes sólo leía los documentos subidos y el vencimiento declarado no avisaba a
 * nadie. Y suma las licencias de conducir (`remindDriverLicenses`): vencida, por
 * vencer, o trabajador cuyo cargo la exige y no la tiene.
 *
 * «Hoy» es el día civil en Chile (`todayInChile`), no el de UTC: entre las 20:00
 * y la medianoche chilena UTC ya está en el día siguiente y el aviso salía un
 * día antes de tiempo.
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
import { loadDriverRosterForReminders } from "@/lib/services/driver-licenses"
import { createNotifications } from "@/lib/services/notification-create"
import {
  getUserIdsWithPermission,
  getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notification-targeting"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { addDaysToPlainDate, formatDate, todayInChile } from "@/lib/utils"
import { formatLicenseClassList } from "@/lib/validation/driver-licenses"
import { expiringDocuments } from "@/lib/validation/fleet-documents"

/** Cuánto antes se avisa. Un mes para un trámite legal es margen de gestión. */
export const DEADLINE_WARNING_DAYS = 30

export interface DeadlineReminderResult {
  fleetDocuments: number
  driverLicenses: number
  riskReviews: number
  privacyRequests: number
  deliveries: number
}

const plusDays = (from: Date, days: number) =>
  new Date(from.getTime() + days * 86_400_000)

const etiqueta = (vencido: boolean) => (vencido ? "vencido" : "por vencer")

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * «Conductor de camión» → «conductor de camión» para componerlo en una frase,
 * pero «TI» o «SSO» se quedan como están.
 */
const inSentence = (text: string) =>
  /^[A-ZÁÉÍÓÚÑ]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1)

/**
 * Los destinatarios de un permiso por faena se resuelven con varias consultas:
 * un barrido que recorre decenas de filas de la misma faena no debe repetirlas.
 */
function recipientsByWorksite(permission: string) {
  const cache = new Map<string, Promise<string[]>>()
  return (worksiteId: string): Promise<string[]> => {
    let hit = cache.get(worksiteId)
    if (!hit) {
      hit = getUserIdsWithPermissionForWorksite(permission, worksiteId)
      cache.set(worksiteId, hit)
    }
    return hit
  }
}

/* ── FLO-002 · documentos legales del vehículo ───────────────────────────── */

/**
 * Cómo se nombra cada tipo documental en una frase («KA-63: la revisión técnica
 * está por vencer»). El género importa para «vencida»/«vencido». Las claves son
 * los valores de `FLEET_DOCUMENT_TYPES`, que es lo que hay guardado; el mapa
 * anterior usaba slugs (`revision_tecnica`) que nunca calzaban y todo salía con
 * el rótulo genérico.
 */
const DOCUMENT_PHRASE: ReadonlyMap<string, { phrase: string; feminine: boolean }> = new Map([
  ["SOAP", { phrase: "el SOAP", feminine: false }],
  ["Permiso de circulación", { phrase: "el permiso de circulación", feminine: false }],
  ["Revisión técnica", { phrase: "la revisión técnica", feminine: true }],
  ["Seguro", { phrase: "el seguro", feminine: false }],
  ["Padrón", { phrase: "el padrón", feminine: false }],
  ["Certificado de emisiones", { phrase: "el certificado de emisiones", feminine: false }],
])

const documentPhrase = (documentType: string) =>
  DOCUMENT_PHRASE.get(documentType) ?? { phrase: `el documento «${documentType}»`, feminine: false }

/**
 * Recorre los equipos ACTIVOS con sus cuatro fechas declaradas y sus documentos
 * vigentes (mismo agrupamiento que `lib/services/fleet.ts`) y avisa de lo que
 * vence dentro de la ventana de flota (`fleet.document.warning_days`). La
 * columna del equipo manda sobre el documento del mismo tipo: es lo que edita la
 * ficha y lo que muestran la lista y el Panel operacional (`expiringDocuments`).
 */
async function remindFleetDocuments(today: string, warningDays: number): Promise<{ examined: number; deliveries: number }> {
  const horizon = addDaysToPlainDate(today, warningDays)

  const vehicles = await db
    .select({
      id: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      worksiteId: fuelVehicles.worksiteId,
      soapExpiresAt: fuelVehicles.soapExpiresAt,
      technicalReviewExpiresAt: fuelVehicles.technicalReviewExpiresAt,
      circulationPermitExpiresAt: fuelVehicles.circulationPermitExpiresAt,
      insuranceExpiresAt: fuelVehicles.insuranceExpiresAt,
    })
    .from(fuelVehicles)
    .where(eq(fuelVehicles.isActive, true))

  const documentRows = await db
    .select({
      vehicleId: fleetVehicleDocuments.vehicleId,
      documentType: fleetVehicleDocuments.documentType,
      expiresAt: fleetVehicleDocuments.expiresAt,
    })
    .from(fleetVehicleDocuments)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetVehicleDocuments.vehicleId))
    .where(and(
      eq(fuelVehicles.isActive, true),
      // Sólo el documento vigente de cada tipo: la historia `replaced` está ahí
      // para poder auditar, no para reclamar por una póliza que ya se renovó.
      eq(fleetVehicleDocuments.status, "current"),
      isNotNull(fleetVehicleDocuments.expiresAt),
      lte(fleetVehicleDocuments.expiresAt, horizon),
    ))
  const documentsByVehicle = new Map<string, Array<{ documentType: string; expiresAt: string | null }>>()
  for (const row of documentRows) {
    const list = documentsByVehicle.get(row.vehicleId) ?? []
    list.push({ documentType: row.documentType, expiresAt: row.expiresAt })
    documentsByVehicle.set(row.vehicleId, list)
  }

  const recipientsOf = recipientsByWorksite("flota:manage_documents")
  let examined = 0
  let deliveries = 0
  for (const vehicle of vehicles) {
    const entries = expiringDocuments(
      {
        soapExpiresAt: vehicle.soapExpiresAt,
        technicalReviewExpiresAt: vehicle.technicalReviewExpiresAt,
        circulationPermitExpiresAt: vehicle.circulationPermitExpiresAt,
        insuranceExpiresAt: vehicle.insuranceExpiresAt,
      },
      documentsByVehicle.get(vehicle.id) ?? [],
      horizon,
    )
    // Un equipo sin código (bateas, carros) se identifica por su patente.
    const identifier = vehicle.code?.trim() || vehicle.plate

    for (const entry of entries) {
      examined += 1
      const vencido = entry.expiresAt < today
      const recipients = await recipientsOf(vehicle.worksiteId)
      if (recipients.length === 0) continue

      const { phrase, feminine } = documentPhrase(entry.documentType)
      const estado = vencido ? (feminine ? "vencida" : "vencido") : "por vencer"
      await createNotifications(recipients, {
        type: vencido ? "fleet_document_overdue" : "fleet_document_due_soon",
        title: `${identifier}: ${phrase} está ${estado}`,
        body: vencido
          ? `${capitalize(phrase)} venció el ${formatDate(entry.expiresAt)}. El vehículo no puede circular hasta renovarlo.`
          : `${capitalize(phrase)} vence el ${formatDate(entry.expiresAt)}.`,
        entityType: "fleet_vehicle",
        entityId: vehicle.id,
        entityHref: `/flota/${vehicle.id}`,
        // La fecha va en la llave: renovar el documento (o corregir la fecha)
        // crea un aviso nuevo, que es lo correcto.
        dedupeKey: `fleet-document:${vehicle.id}:${entry.documentType}:${etiqueta(vencido)}:${entry.expiresAt}`,
      })
      deliveries += recipients.length
    }
  }
  return { examined, deliveries }
}

/* ── Licencias de conducir ───────────────────────────────────────────────── */

/**
 * Avisa a quien gestiona licencias (`flota:manage_licenses`) en la faena del
 * conductor. Usa la misma nómina y el mismo estado que la pantalla
 * `/flota/conductores` (`loadDriverRosterForReminders` → `resolveDriverStatus`),
 * así que el correo no puede contradecirla.
 *
 *  - Vencida o por vencer: un aviso por tramo y por fecha (`dedupeKey` con la
 *    fecha: al renovar nace un aviso nuevo en el próximo vencimiento).
 *  - Sin licencia o clase insuficiente para el cargo: **una sola vez** por
 *    trabajador y cargo. Repetirlo cada día convertiría el correo en ruido para
 *    algo que no cambia hasta que alguien carga la licencia; si el cargo cambia
 *    la exigencia es otra y vuelve a avisar.
 */
async function remindDriverLicenses(today: string, warningDays: number): Promise<{ examined: number; deliveries: number }> {
  const roster = await loadDriverRosterForReminders(today, warningDays)
  const recipientsOf = recipientsByWorksite("flota:manage_licenses")

  let examined = 0
  let deliveries = 0
  for (const row of roster) {
    const entityHref = `/flota/conductores?editar=${row.workerId}`

    if ((row.status === "vencida" || row.status === "por_vencer") && row.license?.expiresAt) {
      examined += 1
      const recipients = await recipientsOf(row.worksiteId)
      if (recipients.length === 0) continue

      const vencido = row.status === "vencida"
      const expiresAt = row.license.expiresAt
      await createNotifications(recipients, {
        type: vencido ? "driver_license_overdue" : "driver_license_due_soon",
        title: `Licencia de ${row.name}: ${vencido ? "vencida" : "por vencer"}`,
        body: vencido
          ? `La licencia de ${row.name} venció el ${formatDate(expiresAt)}. No debe conducir hasta renovarla.`
          : `La licencia de ${row.name} vence el ${formatDate(expiresAt)}.`,
        entityType: "worker",
        entityId: row.workerId,
        entityHref,
        dedupeKey: `driver-license:${row.workerId}:${etiqueta(vencido)}:${expiresAt}`,
      })
      deliveries += recipients.length
      continue
    }

    if ((row.status === "sin_licencia" || row.status === "clase_insuficiente") && row.requiresLicense) {
      examined += 1
      const recipients = await recipientsOf(row.worksiteId)
      if (recipients.length === 0) continue

      const exige = row.requiredClasses.length > 0
        ? `licencia ${formatLicenseClassList(row.requiredClasses)}`
        : "licencia de conducir"
      const quien = row.positionName
        ? `${row.name} es ${inSentence(row.positionName)}, que exige ${exige}`
        : `${row.name} debe tener ${exige}`
      await createNotifications(recipients, {
        type: "driver_license_missing",
        title: row.status === "sin_licencia"
          ? `Licencia de ${row.name}: sin registrar`
          : `Licencia de ${row.name}: clase insuficiente`,
        body: row.status === "sin_licencia"
          ? `${quien}, y no tiene una registrada.`
          : `${quien}, y su licencia no incluye esa clase.`,
        entityType: "worker",
        entityId: row.workerId,
        entityHref,
        dedupeKey: `driver-license-missing:${row.workerId}:${row.positionId ?? "sin-cargo"}:${row.status}`,
      })
      deliveries += recipients.length
    }
  }
  return { examined, deliveries }
}

/* ── MIP-001 · revisiones de la matriz de riesgos ────────────────────────── */

async function remindRiskReviews(today: string): Promise<{ examined: number; deliveries: number }> {
  // `dueAt` es una fecha civil: «hoy» y la ventana se miden en días de Chile.
  const horizon = addDaysToPlainDate(today, DEADLINE_WARNING_DAYS)

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
 * Todos los barridos en una corrida. Van juntos porque son el mismo trabajo
 * —mirar una fecha y avisar— sobre varias tablas, y separarlos en crones habría
 * multiplicado la configuración del planificador externo sin ganar nada.
 *
 * `now` fija «hoy» (día civil en Chile) para todos: el cron real llama sin
 * argumento y las pruebas pasan un instante fijo.
 */
export async function runDeadlineReminders(now = new Date()): Promise<DeadlineReminderResult> {
  const today = todayInChile(now)
  // La ventana de flota y de licencias es el ajuste `fleet.document.warning_days`
  // (el mismo que usan la lista de Flota y el Panel operacional); riesgo y
  // privacidad conservan sus 30 días.
  const { warningDays } = await getFleetAdminSettings()
  const [fleet, drivers, risk, privacy] = await Promise.all([
    remindFleetDocuments(today, warningDays),
    remindDriverLicenses(today, warningDays),
    remindRiskReviews(today),
    remindPrivacyRequests(now),
  ])
  return {
    fleetDocuments: fleet.examined,
    driverLicenses: drivers.examined,
    riskReviews: risk.examined,
    privacyRequests: privacy.examined,
    deliveries: fleet.deliveries + drivers.deliveries + risk.deliveries + privacy.deliveries,
  }
}
