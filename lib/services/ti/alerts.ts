import { eq, and, isNull, sql, lt, notInArray } from "drizzle-orm"
import { IT_RETIRED_STATUSES } from "./constants"
import { db } from "@/db"
import {
  itAssets, itLicenses, itTickets,
} from "@/db/schema"
import { createNotification } from "@/lib/services/notification-create"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { logger } from "@/lib/logger"
import { cleanupOrphanPhotos } from "./assignment-photos"
import { civilDaysUntil } from "./civil-dates"
import { todayInChile } from "@/lib/utils"
import { TICKET_SLA_WARNING_HOURS, ticketSlaStage } from "./ticket-sla"

/* ── Alertas TI diarias (cron) ──────────────────────────────────────────────
 * Notifican solo lo accionable, deduplicadas por `dedupeKey`, para no inundar
 * la campana. Tipos y cadencia de repetición:
 *   - garantías que vencen en ≤30 días → una vez por fecha de vencimiento;
 *   - licencias que renuevan en ≤14 días → una vez por fecha de renovación;
 *   - activos que llevan >30 días en reparación → una vez al mes;
 *   - tickets abiertos sin actualización en >5 días → una vez al día;
 *   - tickets abiertos con su SLA por vencer o vencido → una vez al día por
 *     tramo (TIT-001).
 *
 * La deduplicación de `createNotification` es PERMANENTE por `(userId,
 * dedupeKey)` (índice `notifications_user_dedupe_unique`), no diaria: toda
 * clave de una condición recurrente debe llevar su propio componente temporal
 * o la alerta se emite una sola vez en la vida del registro.
 */

export interface TiAlert {
  type: "ti_warranty_expiring" | "ti_license_renewal" | "ti_repair_stuck" | "ti_ticket_stale"
    | "ti_ticket_sla_due_soon" | "ti_ticket_sla_overdue"
  title: string
  body: string
  entityType: string
  entityId: string
  entityHref: string
  dedupeKey: string
}

export async function collectTiAlerts(): Promise<TiAlert[]> {
  const alerts: TiAlert[] = []
  const today = todayInChile()

  // Garantías por vencer (≤30 días).
  const warranties = await db
    .select({
      id: itAssets.id,
      code: itAssets.code,
      brand: itAssets.brand,
      model: itAssets.model,
      warrantyEndDate: itAssets.warrantyEndDate,
    })
    .from(itAssets)
    .where(and(
      isNull(itAssets.deletedAt),
      notInArray(itAssets.status, [...IT_RETIRED_STATUSES]),
      sql`${itAssets.warrantyEndDate} IS NOT NULL`,
      sql`${itAssets.warrantyEndDate} >= ${today}`,
      sql`${itAssets.warrantyEndDate} <= (${today}::date + 30)::text`,
    ))
  for (const asset of warranties) {
    const days = asset.warrantyEndDate
      ? civilDaysUntil(asset.warrantyEndDate, today)
      : 30
    alerts.push({
      type: "ti_warranty_expiring",
      title: `Garantía por vencer: ${asset.code}`,
      body: `La garantía de ${asset.code} (${[asset.brand, asset.model].filter(Boolean).join(" ") || "activo"}) vence en ${days} día${days === 1 ? "" : "s"}.`,
      entityType: "it_asset",
      entityId: asset.id,
      entityHref: `/ti/activos/${asset.id}`,
      dedupeKey: `ti:warranty:${asset.id}:${asset.warrantyEndDate}`,
    })
  }

  // Licencias que renuevan en ≤14 días.
  const licenses = await db
    .select({ id: itLicenses.id, name: itLicenses.name, renewalDate: itLicenses.renewalDate })
    .from(itLicenses)
    .where(and(
      eq(itLicenses.isActive, true),
      sql`${itLicenses.renewalDate} IS NOT NULL`,
      sql`${itLicenses.renewalDate} >= ${today}`,
      sql`${itLicenses.renewalDate} <= (${today}::date + 14)::text`,
    ))
  for (const license of licenses) {
    const days = license.renewalDate
      ? civilDaysUntil(license.renewalDate, today)
      : 14
    alerts.push({
      type: "ti_license_renewal",
      title: `Renovación próxima: ${license.name}`,
      body: `${license.name} renueva en ${days} día${days === 1 ? "" : "s"}. Revisa el contrato y la vigencia de sus asignaciones.`,
      entityType: "it_license",
      entityId: license.id,
      entityHref: "/ti/licencias",
      dedupeKey: `ti:license:${license.id}:${license.renewalDate}`,
    })
  }

  // Activos >30 días en reparación.
  const stuckRepairs = await db
    .select({
      id: itAssets.id,
      code: itAssets.code,
      brand: itAssets.brand,
      model: itAssets.model,
      updatedAt: itAssets.updatedAt,
    })
    .from(itAssets)
    .where(and(
      isNull(itAssets.deletedAt),
      eq(itAssets.status, "en_reparacion"),
      lt(itAssets.updatedAt, sql`now() - interval '30 days'`),
    ))
  for (const asset of stuckRepairs) {
    const days = Math.floor((Date.now() - new Date(asset.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
    alerts.push({
      type: "ti_repair_stuck",
      title: `Reparación demorada: ${asset.code}`,
      body: `${asset.code} lleva ${days} días en reparación. Verifica el estado con el proveedor.`,
      entityType: "it_asset",
      entityId: asset.id,
      entityHref: `/ti/activos/${asset.id}`,
      // Condición recurrente: el mes evita que un activo que vuelve a quedar
      // atascado meses después ya no alerte nunca más.
      dedupeKey: `ti:repair:${asset.id}:${today.slice(0, 7)}`,
    })
  }

  /*
   * TIT-001 (auditoría 2026-09-14): SLA por prioridad.
   *
   * Hasta aquí la prioridad de un ticket no cambiaba nada. Ahora cada ticket
   * abierto lleva su vencimiento comprometido (`due_at`, calculado al crear
   * según la prioridad) y se avisa por tramo: 24 h antes y una vez vencido. La
   * clave de deduplicación lleva el tramo y el día para que el aviso se repita
   * a diario mientras el compromiso siga sin cumplirse, y para que pasar de
   * "por vencer" a "vencido" produzca un aviso nuevo y no un silencio.
   */
  const slaHorizon = new Date(Date.now() + TICKET_SLA_WARNING_HOURS * 60 * 60 * 1000).toISOString()
  const slaTickets = await db
    .select({
      id: itTickets.id, code: itTickets.code, subject: itTickets.subject,
      priority: itTickets.priority, dueAt: itTickets.dueAt,
    })
    .from(itTickets)
    .where(and(
      sql`${itTickets.status} IN ('nuevo', 'asignado', 'en_diagnostico', 'en_progreso', 'esperando_usuario', 'esperando_proveedor')`,
      sql`${itTickets.dueAt} IS NOT NULL`,
      lt(itTickets.dueAt, slaHorizon),
    ))
  for (const ticket of slaTickets) {
    const stage = ticketSlaStage(ticket.dueAt)
    if (stage !== "due_soon" && stage !== "overdue") continue
    const vencido = stage === "overdue"
    alerts.push({
      type: vencido ? "ti_ticket_sla_overdue" : "ti_ticket_sla_due_soon",
      title: vencido
        ? `Ticket fuera de SLA (${ticket.priority}): ${ticket.code}`
        : `Ticket por vencer (${ticket.priority}): ${ticket.code}`,
      body: vencido
        ? `${ticket.code} pasó su compromiso de atención. ${ticket.subject}`
        : `${ticket.code} vence dentro de las próximas ${TICKET_SLA_WARNING_HOURS} horas. ${ticket.subject}`,
      entityType: "it_ticket",
      entityId: ticket.id,
      entityHref: `/ti/tickets/${ticket.id}`,
      dedupeKey: `ti:ticket-sla:${ticket.id}:${stage}:${today}`,
    })
  }

  /*
   * Tickets abiertos sin actualización >5 días.
   *
   * TIT-001, segunda mitad: la consulta incluía `esperando_usuario` y
   * `esperando_proveedor`. Un ticket detenido a la espera de una respuesta
   * ajena se reportaba como "sin actualización" igual que uno abandonado, de
   * modo que el aviso más ruidoso era también el menos accionable. El
   * abandono real lo cubre ahora el SLA de arriba, que sí corre para esos dos
   * estados porque el compromiso con el usuario no se suspende.
   */
  const staleTickets = await db
    .select({ id: itTickets.id, code: itTickets.code, subject: itTickets.subject, updatedAt: itTickets.updatedAt })
    .from(itTickets)
    .where(and(
      sql`${itTickets.status} IN ('nuevo', 'asignado', 'en_diagnostico', 'en_progreso')`,
      lt(itTickets.updatedAt, sql`now() - interval '5 days'`),
    ))
  for (const ticket of staleTickets) {
    const days = Math.floor((Date.now() - new Date(ticket.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
    alerts.push({
      type: "ti_ticket_stale",
      title: `Ticket sin actualización: ${ticket.code}`,
      body: `${ticket.code} lleva ${days} días sin actualización. ${ticket.subject}`,
      entityType: "it_ticket",
      entityId: ticket.id,
      entityHref: `/ti/tickets/${ticket.id}`,
      // Un ticket estancado se recuerda a diario mientras siga sin moverse.
      dedupeKey: `ti:ticket:${ticket.id}:${today}`,
    })
  }

  return alerts
}

/** Corre el trabajo diario de alertas TI. Idempotente vía dedupeKey. */
export async function runTiAlerts(): Promise<{ sent: number; skipped: number; discardedPendingPhotos: number }> {
  // Comparte el cron diario para retirar cargas que el técnico abandonó antes
  // de confirmar un acta. Un fallo de almacenamiento no impide las alertas.
  let discardedPendingPhotos = 0
  try {
    discardedPendingPhotos = await cleanupOrphanPhotos()
  } catch (error) {
    logger.error("[ti:photos:cleanup]", error)
  }

  const alerts = await collectTiAlerts()
  if (alerts.length === 0) return { sent: 0, skipped: 0, discardedPendingPhotos }

  // Destinatarios: usuarios activos con permiso de ver TI. `ti:view` se concede
  // por rol (`modules/ti/manifest.ts` → `role_permissions`), no por grant
  // directo, así que el helper canónico es obligatorio: resolverlo a mano
  // contra `user_permissions` dejaba la lista vacía y descartaba cada alerta en
  // silencio. `createNotification` lanza si falla la BD.
  const recipients = await getUserIdsWithPermission("ti:view")

  let sent = 0
  let skipped = 0
  for (const alert of alerts) {
    for (const recipientId of recipients) {
      try {
        await createNotification({
          userId: recipientId,
          type: alert.type,
          title: alert.title,
          body: alert.body,
          entityType: alert.entityType,
          entityId: alert.entityId,
          entityHref: alert.entityHref,
          dedupeKey: alert.dedupeKey,
        })
        sent += 1
      } catch (error) {
        // createNotification deduplica por índice único parcial; cualquier
        // error de inserción (incluido el duplicado de otro día) se cuenta
        // como skip para no romper la corrida.
        logger.error("[ti:alerts:insert]", error)
        skipped += 1
      }
    }
  }
  return { sent, skipped, discardedPendingPhotos }
}
