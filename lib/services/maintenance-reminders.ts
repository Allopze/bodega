import { and, eq, inArray, lte } from "drizzle-orm"
import { db } from "@/db"
import { maintenanceRecords, roles, users, userRoles, worksiteUsers } from "@/db/schema"
import { createNotifications } from "@/lib/services/notification-create"

export interface MaintenanceReminderResult {
  examined: number
  dueSoon: number
  overdue: number
  deliveries: number
}

/** Recordatorios idempotentes y escalamiento por SLA para órdenes abiertas. */
export async function runMaintenanceReminders(now = new Date()): Promise<MaintenanceReminderResult> {
  const nowIso = now.toISOString()
  const warningAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const recordsQuery = db.select({
    id: maintenanceRecords.id,
    code: maintenanceRecords.code,
    worksiteId: maintenanceRecords.worksiteId,
    assignedToUserId: maintenanceRecords.assignedToUserId,
    assignedToUserIsActive: users.isActive,
    slaDueAt: maintenanceRecords.slaDueAt,
    priority: maintenanceRecords.priority,
  }).from(maintenanceRecords).leftJoin(users, eq(users.id, maintenanceRecords.assignedToUserId)).where(and(
    inArray(maintenanceRecords.status, ["scheduled", "in_progress"]),
    lte(maintenanceRecords.slaDueAt, warningAt),
  ))

  const managersQuery = db.select({
    userId: users.id,
    isGlobal: roles.isGlobal,
    worksiteId: worksiteUsers.worksiteId,
  }).from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(worksiteUsers, eq(worksiteUsers.userId, users.id))
    .where(and(eq(roles.name, "jefe_mantencion"), eq(users.isActive, true)))

  // Ninguna de las dos lecturas depende de la otra: se resuelven en paralelo.
  const [records, managers] = await Promise.all([recordsQuery, managersQuery])

  let dueSoon = 0
  let overdue = 0
  let deliveries = 0
  for (const record of records) {
    if (!record.slaDueAt) continue
    const isOverdue = record.slaDueAt < nowIso
    if (isOverdue) overdue += 1
    else dueSoon += 1
    const recipientIds = new Set<string>()
    const activeAssigneeId = record.assignedToUserIsActive ? record.assignedToUserId : null
    if (activeAssigneeId) recipientIds.add(activeAssigneeId)
    if (isOverdue || record.priority === "critical" || !activeAssigneeId) {
      for (const manager of managers) {
        if (manager.isGlobal || manager.worksiteId === record.worksiteId) recipientIds.add(manager.userId)
      }
    }
    if (recipientIds.size === 0) continue
    const stage = isOverdue ? "overdue" : "due-soon"
    await createNotifications([...recipientIds], {
      type: isOverdue ? "maintenance_overdue" : "maintenance_due_soon",
      title: isOverdue ? `OT ${record.code ?? record.id} fuera de SLA` : `OT ${record.code ?? record.id} próxima a vencer`,
      body: isOverdue ? "La orden sigue abierta después de su compromiso SLA. Revisa responsable, bloqueo y fecha de recuperación." : "La orden vence dentro de las próximas 24 horas.",
      entityType: "maintenance_record",
      entityId: record.id,
      entityHref: `/mantenciones/${record.id}`,
      dedupeKey: `maintenance:${record.id}:${stage}:${record.slaDueAt}`,
    })
    deliveries += recipientIds.size
  }
  return { examined: records.length, dueSoon, overdue, deliveries }
}
