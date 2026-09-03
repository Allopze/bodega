import { eq, and, isNull, desc, asc, inArray, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itLicenses, itLicenseAssignments, suppliers, workers, itAssets, worksites, users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"

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
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    if (worksiteIds !== "all") {
      throw new Error("Las licencias globales solo pueden gestionarse desde un alcance TI global")
    }
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
  worksiteIds: TiWorksiteScope = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itLicenses).where(eq(itLicenses.id, input.id)).for("update")
    if (!existing) throw new Error("Licencia no encontrada")
    await assertLicenseInScope(tx, input.id, worksiteIds)

    const [activeAssignments] = await tx.select({
      count: sql<number>`count(*)::int`,
    }).from(itLicenseAssignments)
      .where(and(eq(itLicenseAssignments.licenseId, input.id), isNull(itLicenseAssignments.revokedAt)))
    if (activeAssignments && input.purchasedQuantity < activeAssignments.count) {
      throw new Error(`La cantidad comprada no puede ser menor que las ${activeAssignments.count} asignaciones vigentes`)
    }

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
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [license] = await tx.select().from(itLicenses).where(eq(itLicenses.id, input.licenseId)).for("update")
    if (!license) throw new Error("Licencia no encontrada")
    if (!license.isActive) throw new Error("La licencia está inactiva")

    const [worker] = input.workerId
      ? await tx.select({ id: workers.id, worksiteId: workers.worksiteId, isActive: workers.isActive })
        .from(workers).where(eq(workers.id, input.workerId))
      : [undefined]
    if (input.workerId && !worker) throw new Error("Trabajador no encontrado")
    if (worker && !worker.isActive) throw new Error("El trabajador está inactivo")

    const [asset] = input.assetId
      ? await tx.select({ id: itAssets.id, worksiteId: itAssets.worksiteId, deletedAt: itAssets.deletedAt, status: itAssets.status })
        .from(itAssets).where(eq(itAssets.id, input.assetId))
      : [undefined]
    if (input.assetId && (!asset || asset.deletedAt)) throw new Error("Activo no encontrado")
    if (asset && ["dado_de_baja", "perdido", "robado"].includes(asset.status)) {
      throw new Error("No puedes asignar una licencia a un activo retirado")
    }

    const targetWorksites = [...new Set([
      input.worksiteId || null,
      worker?.worksiteId ?? null,
      asset?.worksiteId ?? null,
    ].filter((value): value is string => Boolean(value)))]
    if (targetWorksites.length > 1) {
      throw new Error("El trabajador, activo y faena de la licencia deben pertenecer a la misma faena")
    }
    const targetWorksiteId = targetWorksites[0] ?? null
    assertTiWorksiteAccess(worksiteIds, targetWorksiteId)

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
      worksiteId: targetWorksiteId,
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
  worksiteIds: TiWorksiteScope = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [assignment] = await tx.select().from(itLicenseAssignments).where(eq(itLicenseAssignments.id, assignmentId)).for("update")
    if (!assignment) throw new Error("Asignación no encontrada")
    if (assignment.revokedAt) throw new Error("La asignación ya fue revocada")
    await assertLicenseAssignmentInScope(tx, assignmentId, worksiteIds)

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

export async function listLicenses(scope?: SQL, worksiteIds: TiWorksiteScope = "all") {
  const worksiteScope = licenseScopeCondition(worksiteIds)
  return db
    .select({
      id: itLicenses.id,
      name: itLicenses.name,
      supplierId: itLicenses.supplierId,
      supplierName: suppliers.name,
      type: itLicenses.type,
      purchasedQuantity: itLicenses.purchasedQuantity,
      assignedQuantity: assignedQuantityCondition(worksiteIds).as("assignedQuantity"),
      cost: itLicenses.cost,
      periodicity: itLicenses.periodicity,
      startDate: itLicenses.startDate,
      renewalDate: itLicenses.renewalDate,
      responsibleUserId: itLicenses.responsibleUserId,
      responsibleName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itLicenses.responsibleUserId})`,
      notes: itLicenses.notes,
      isActive: itLicenses.isActive,
    })
    .from(itLicenses)
    .leftJoin(suppliers, eq(itLicenses.supplierId, suppliers.id))
    .where(scope || worksiteScope ? and(scope, worksiteScope) : undefined)
    .orderBy(asc(itLicenses.name))
}

export async function getLicenseAssignments(licenseId: string, worksiteIds: TiWorksiteScope = "all") {
  const conditions: SQL[] = [eq(itLicenseAssignments.licenseId, licenseId)]
  if (worksiteIds !== "all") {
    if (worksiteIds.length === 0) conditions.push(sql`false`)
    else conditions.push(or(
      inArray(itLicenseAssignments.worksiteId, worksiteIds),
      inArray(workers.worksiteId, worksiteIds),
      inArray(itAssets.worksiteId, worksiteIds),
    )!)
  }
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
    .where(and(...conditions))
    .orderBy(desc(itLicenseAssignments.assignedAt))
}

type TiTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function assertLicenseAssignmentInScope(tx: TiTransaction, assignmentId: string, worksiteIds: TiWorksiteScope): Promise<void> {
  if (worksiteIds === "all") return
  const [assignment] = await tx.select({
    worksiteId: itLicenseAssignments.worksiteId,
    workerWorksiteId: workers.worksiteId,
    assetWorksiteId: itAssets.worksiteId,
  })
    .from(itLicenseAssignments)
    .leftJoin(workers, eq(itLicenseAssignments.workerId, workers.id))
    .leftJoin(itAssets, eq(itLicenseAssignments.assetId, itAssets.id))
    .where(eq(itLicenseAssignments.id, assignmentId))
    .limit(1)
  const target = assignment?.worksiteId ?? assignment?.workerWorksiteId ?? assignment?.assetWorksiteId
  assertTiWorksiteAccess(worksiteIds, target)
}

async function assertLicenseInScope(tx: TiTransaction, licenseId: string, worksiteIds: TiWorksiteScope): Promise<void> {
  if (worksiteIds === "all") return
  if (worksiteIds.length === 0) throw new Error("No tienes acceso a esta faena")
  const [assignment] = await tx.select({ id: itLicenseAssignments.id })
    .from(itLicenseAssignments)
    .leftJoin(workers, eq(itLicenseAssignments.workerId, workers.id))
    .leftJoin(itAssets, eq(itLicenseAssignments.assetId, itAssets.id))
    .where(and(
      eq(itLicenseAssignments.licenseId, licenseId),
      or(
        inArray(itLicenseAssignments.worksiteId, worksiteIds),
        inArray(workers.worksiteId, worksiteIds),
        inArray(itAssets.worksiteId, worksiteIds),
      ),
    ))
    .limit(1)
  if (!assignment) throw new Error("No tienes acceso a esta licencia")
}

function licenseScopeCondition(worksiteIds: TiWorksiteScope): SQL | undefined {
  if (worksiteIds === "all") return undefined
  if (worksiteIds.length === 0) return sql`false`
  const ids = sql.join(worksiteIds.map((id) => sql`${id}`), sql`, `)
  return sql`EXISTS (
    SELECT 1
    FROM it_license_assignments ila
    LEFT JOIN workers lw ON lw.id = ila.worker_id
    LEFT JOIN it_assets la ON la.id = ila.asset_id
    WHERE ila.license_id = ${itLicenses.id}
      AND (ila.worksite_id IN (${ids}) OR lw.worksite_id IN (${ids}) OR la.worksite_id IN (${ids}))
  )`
}

function assignedQuantityCondition(worksiteIds: TiWorksiteScope): SQL<number> {
  if (worksiteIds === "all") {
    return sql<number>`(
      SELECT count(*)::int
      FROM it_license_assignments ila
      WHERE ila.license_id = ${itLicenses.id}
        AND ila.revoked_at IS NULL
    )`
  }
  if (worksiteIds.length === 0) return sql<number>`0`
  const ids = sql.join(worksiteIds.map((id) => sql`${id}`), sql`, `)
  return sql<number>`(
    SELECT count(*)::int
    FROM it_license_assignments ila
    LEFT JOIN workers lw ON lw.id = ila.worker_id
    LEFT JOIN it_assets la ON la.id = ila.asset_id
    WHERE ila.license_id = ${itLicenses.id}
      AND ila.revoked_at IS NULL
      AND (ila.worksite_id IN (${ids}) OR lw.worksite_id IN (${ids}) OR la.worksite_id IN (${ids}))
  )`
}
