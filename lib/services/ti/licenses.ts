import { eq, and, isNull, desc, asc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itLicenses, itLicenseAssignments, suppliers, workers, itAssets, worksites, users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"

export interface CreateLicenseInput {
  name: string
  supplierId?: string | null
  type?: string | null
  purchasedQuantity: number
  cost?: number | null
  periodicity: string
  startDate?: string | null
  renewalDate?: string | null
  responsibleUserId?: string | null
  notes?: string | null
}

export async function createLicense(
  input: CreateLicenseInput,
  actor: { userId: string; userEmail?: string },
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    await tx.insert(itLicenses).values({
      id,
      name: input.name,
      supplierId: input.supplierId || null,
      type: input.type?.trim() || null,
      purchasedQuantity: input.purchasedQuantity,
      cost: input.cost ?? null,
      periodicity: input.periodicity,
      startDate: input.startDate || null,
      renewalDate: input.renewalDate || null,
      responsibleUserId: input.responsibleUserId || null,
      notes: input.notes?.trim() || null,
    })
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_license",
      entityId: id,
      newState: { name: input.name, purchasedQuantity: input.purchasedQuantity, periodicity: input.periodicity },
    }, tx)
  })
  return id
}

export async function updateLicense(
  input: CreateLicenseInput & { id: string; isActive: boolean },
  actor: { userId: string; userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itLicenses).where(eq(itLicenses.id, input.id)).for("update")
    if (!existing) throw new Error("Licencia no encontrada")

    await tx.update(itLicenses).set({
      name: input.name,
      supplierId: input.supplierId || null,
      type: input.type?.trim() || null,
      purchasedQuantity: input.purchasedQuantity,
      cost: input.cost ?? null,
      periodicity: input.periodicity,
      startDate: input.startDate || null,
      renewalDate: input.renewalDate || null,
      responsibleUserId: input.responsibleUserId || null,
      notes: input.notes?.trim() || null,
      isActive: input.isActive,
      updatedAt: new Date().toISOString(),
    }).where(eq(itLicenses.id, input.id))

    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_license",
      entityId: input.id,
      oldState: { name: existing.name, purchasedQuantity: existing.purchasedQuantity },
      newState: { name: input.name, purchasedQuantity: input.purchasedQuantity },
    }, tx)
  })
}

export interface AssignLicenseInput {
  licenseId: string
  workerId?: string | null
  assetId?: string | null
  area?: string | null
  worksiteId?: string | null
  notes?: string | null
}

export async function assignLicense(
  input: AssignLicenseInput,
  actor: { userId: string; userEmail?: string },
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [license] = await tx.select().from(itLicenses).where(eq(itLicenses.id, input.licenseId)).for("update")
    if (!license) throw new Error("Licencia no encontrada")
    if (!license.isActive) throw new Error("La licencia está inactiva")

    // Capacidad: asignadas vigentes vs compradas. Solo aplica cuando la
    // cantidad comprada es mayor a 0 (catálogos abiertos no se limitan).
    if (license.purchasedQuantity > 0) {
      const [assigned] = await tx.select({
        count: sql<number>`count(*)::int`,
      }).from(itLicenseAssignments)
        .where(and(eq(itLicenseAssignments.licenseId, input.licenseId), isNull(itLicenseAssignments.revokedAt)))
      if (assigned && assigned.count >= license.purchasedQuantity) {
        throw new Error(`La licencia tiene las ${license.purchasedQuantity} asignaciones usadas`)
      }
    }

    await tx.insert(itLicenseAssignments).values({
      id,
      licenseId: input.licenseId,
      workerId: input.workerId || null,
      assetId: input.assetId || null,
      area: input.area?.trim() || null,
      worksiteId: input.worksiteId || null,
      notes: input.notes?.trim() || null,
    })
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_license_assignment",
      entityId: id,
      newState: { licenseId: input.licenseId, workerId: input.workerId ?? null, assetId: input.assetId ?? null, area: input.area ?? null },
    }, tx)
  })
  return id
}

export async function revokeLicenseAssignment(
  assignmentId: string,
  actor: { userId: string; userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [assignment] = await tx.select().from(itLicenseAssignments).where(eq(itLicenseAssignments.id, assignmentId)).for("update")
    if (!assignment) throw new Error("Asignación no encontrada")
    if (assignment.revokedAt) throw new Error("La asignación ya fue revocada")

    await tx.update(itLicenseAssignments).set({ revokedAt: new Date().toISOString() })
      .where(eq(itLicenseAssignments.id, assignmentId))

    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_license_assignment",
      entityId: assignmentId,
      oldState: { revokedAt: null },
      newState: { revokedAt: new Date().toISOString() },
    }, tx)
  })
}

export async function listLicenses(scope?: SQL) {
  return db
    .select({
      id: itLicenses.id,
      name: itLicenses.name,
      supplierId: itLicenses.supplierId,
      supplierName: suppliers.name,
      type: itLicenses.type,
      purchasedQuantity: itLicenses.purchasedQuantity,
      assignedQuantity: sql<number>`(SELECT count(*)::int FROM ${itLicenseAssignments} WHERE ${itLicenseAssignments.licenseId} = ${itLicenses.id} AND ${itLicenseAssignments.revokedAt} IS NULL)`,
      cost: itLicenses.cost,
      periodicity: itLicenses.periodicity,
      startDate: itLicenses.startDate,
      renewalDate: itLicenses.renewalDate,
      responsibleName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itLicenses.responsibleUserId})`,
      notes: itLicenses.notes,
      isActive: itLicenses.isActive,
    })
    .from(itLicenses)
    .leftJoin(suppliers, eq(itLicenses.supplierId, suppliers.id))
    .where(scope ?? undefined)
    .orderBy(asc(itLicenses.name))
}

export async function getLicenseAssignments(licenseId: string) {
  return db
    .select({
      id: itLicenseAssignments.id,
      licenseId: itLicenseAssignments.licenseId,
      workerId: itLicenseAssignments.workerId,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      assetId: itLicenseAssignments.assetId,
      assetCode: itAssets.code,
      area: itLicenseAssignments.area,
      worksiteId: itLicenseAssignments.worksiteId,
      worksiteName: worksites.name,
      assignedAt: itLicenseAssignments.assignedAt,
      revokedAt: itLicenseAssignments.revokedAt,
      notes: itLicenseAssignments.notes,
    })
    .from(itLicenseAssignments)
    .leftJoin(workers, eq(itLicenseAssignments.workerId, workers.id))
    .leftJoin(itAssets, eq(itLicenseAssignments.assetId, itAssets.id))
    .leftJoin(worksites, eq(itLicenseAssignments.worksiteId, worksites.id))
    .where(eq(itLicenseAssignments.licenseId, licenseId))
    .orderBy(desc(itLicenseAssignments.assignedAt))
}
