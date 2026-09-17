/**
 * lib/services/pdtp/period-closure-distribution.ts
 *
 * Distribución del cierre mensual (Fase 4, G7): quién recibe la foto del mes
 * y por qué vía.
 *
 * ## Quién
 *
 * La intersección de dos condiciones, no una sola:
 *
 *  1. tener `prevention:pdtp:view` **en esa faena** (mismo helper de
 *     destinatarios que usan los recordatorios del módulo, que ya resuelve
 *     alcance por faena y roles globales); y
 *  2. tener alguno de los roles de `PDTP_CLOSURE_DISTRIBUTION_ROLES`.
 *
 * Sólo la primera condición mandaría el cierre a todo el que pueda mirar el
 * programa —supervisores, jefes de terreno—, que es ruido mensual para gente
 * que no decide nada con eso. Sólo la segunda ignoraría el alcance por faena y
 * mandaría el cierre de una faena a quien no la tiene asignada.
 *
 * ## Cómo
 *
 * `createNotifications` inserta la notificación **y** dispara el correo
 * (`lib/services/notification-create.ts`). El `dedupeKey` lleva la versión del
 * cierre: reenviar el mismo cierre no vuelve a notificar a quien ya lo tiene,
 * pero cerrar de nuevo (que sube `version`) sí produce un envío nuevo — que es
 * exactamente la semántica que se quiere, porque la foto cambió.
 *
 * Sin adjunto: el correo enlaza al detalle del cierre, que tiene la descarga.
 * Mandar un Excel de varios megas por SMTP a media docena de personas cada mes
 * es un problema distinto del que esta tarea resuelve.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpPeriodClosures, roles, userRoles, users, worksites } from "@/db/schema"
import { createNotifications } from "@/lib/services/notification-create"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { assertWorksiteAccess, type WorksiteScope } from "./helpers"
import type { PdtpPeriodClosureSnapshot } from "./period-closures"

/**
 * Roles que reciben el cierre mensual: jefatura, prevención (central y de
 * faena), la subgerencia y la gerencia que firman el programa, y la
 * administración del contrato de la faena.
 */
export const PDTP_CLOSURE_DISTRIBUTION_ROLES = [
  "jefa_chome",
  "prevencionista",
  "subgerente_operaciones",
  "gerente_legal_rrhh",
  "admin_contrato",
  "prevencionista_faena",
] as const

export type PdtpClosureRecipient = { userId: string; email: string }

/** Destinatarios efectivos del cierre de una faena. Ver el encabezado. */
export async function resolvePdtpClosureRecipients(worksiteId: string): Promise<PdtpClosureRecipient[]> {
  const viewerIds = await getUserIdsWithPermissionForWorksite("prevention:pdtp:view", worksiteId)
  if (viewerIds.length === 0) return []

  const rows = await db.selectDistinct({ userId: users.id, email: users.email })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(
      inArray(users.id, viewerIds),
      eq(users.isActive, true),
      inArray(roles.name, [...PDTP_CLOSURE_DISTRIBUTION_ROLES]),
    ))

  // Dedupe por usuario: alguien con dos de estos roles aparece una sola vez.
  const byUserId = new Map<string, PdtpClosureRecipient>()
  for (const row of rows) {
    if (!row.email) continue
    if (!byUserId.has(row.userId)) byUserId.set(row.userId, { userId: row.userId, email: row.email })
  }
  return [...byUserId.values()]
}

/** "87 %" — el porcentaje del mes, o "sin planificación" cuando no hay denominador. */
function monthPercentLabel(snapshot: PdtpPeriodClosureSnapshot): string {
  const month = snapshot.indicators.monthly.find((entry) => entry.month === snapshot.cutoff.month)
  if (!month || month.percent === null) return "sin planificación en el mes"
  return `${Math.round(month.percent * 100)} % de cumplimiento`
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Resumen de una línea que va en la notificación y en el cuerpo del correo. */
function closureBody(snapshot: PdtpPeriodClosureSnapshot): string {
  const month = snapshot.indicators.monthly.find((entry) => entry.month === snapshot.cutoff.month)
  const zero = month?.zeroActivities ?? 0
  return [
    monthPercentLabel(snapshot),
    plural(zero, "actividad en cero", "actividades en cero"),
    plural(snapshot.deviations.length, "desvío declarado", "desvíos declarados"),
  ].join(", ")
}

const MONTH_LABEL = (year: number, month: number) => `${String(month).padStart(2, "0")}/${year}`

/**
 * Envía (o reenvía) la notificación y el correo del cierre, y deja constancia
 * de a quién se mandó.
 *
 * `distributedAt` se actualiza en cada intento aunque el dedupe no haya
 * producido correos nuevos: la pregunta que responde es "¿cuándo se distribuyó
 * por última vez?", y `distributionJson` guarda la nómina completa de esa
 * corrida para que el reenvío sea auditable.
 */
export async function distributePdtpPeriodClosure(
  input: { closureId: string },
  userId: string,
  scope: WorksiteScope,
): Promise<{ recipients: number }> {
  const [closure] = await db.select().from(pdtpPeriodClosures)
    .where(eq(pdtpPeriodClosures.id, input.closureId)).limit(1)
  if (!closure) throw new Error("Cierre PDTP no encontrado.")
  assertWorksiteAccess(closure.worksiteId, scope)

  const [worksite] = await db.select({ name: worksites.name })
    .from(worksites).where(eq(worksites.id, closure.worksiteId)).limit(1)
  const worksiteName = worksite?.name ?? "la faena"

  const recipients = await resolvePdtpClosureRecipients(closure.worksiteId)
  const snapshot = closure.snapshotJson as PdtpPeriodClosureSnapshot
  const now = new Date().toISOString()

  if (recipients.length > 0) {
    await createNotifications(recipients.map((recipient) => recipient.userId), {
      type: "pdtp_period_closed",
      title: `Cierre PDTP ${MONTH_LABEL(closure.year, closure.month)} · ${worksiteName}`,
      body: closureBody(snapshot),
      entityType: "pdtp_period_closure",
      entityId: closure.id,
      entityHref: `/prevencion/pdtp/${closure.programId}/cierres/${closure.id}`,
      // La versión es parte de la llave: reenviar el mismo cierre no duplica,
      // pero una foto nueva (cierre v2) sí vuelve a avisar.
      dedupeKey: `pdtp-closure-${closure.id}-v${closure.version}`,
    })
  }

  await db.update(pdtpPeriodClosures).set({
    distributedAt: now,
    distributionJson: recipients.map((recipient) => ({ ...recipient, at: now, byUserId: userId })),
    updatedAt: now,
  }).where(eq(pdtpPeriodClosures.id, closure.id))

  return { recipients: recipients.length }
}
