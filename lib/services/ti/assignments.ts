import { eq, and, isNull, inArray, sql, desc, asc, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itAssets, itAssetAssignments, itAssignmentAccessories, itAssignmentPhotos,
  workers, worksites, users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { chileLocalDateTimeToUtc, codeYear } from "@/lib/utils"
import { appendAssetHistory } from "./history"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"
import { assignmentTargetStatus } from "./constants"

export interface CreateAssignmentInput {
  assetId: string
  workerId: string
  worksiteId: string
  kind?: string
  deliveredAt: string // ISO local datetime
  physicalState: string
  observations?: string | null
  accepted?: boolean
  accessoryNames: string[]
  photoIds: string[]
}

const ASSIGNABLE_STATUSES = ["disponible", "en_bodega"]

export async function createAssignment(
  input: CreateAssignmentInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    if (worksiteIds !== "all" && !worksiteIds.includes(input.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const [asset] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, input.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!asset) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)
    if (!ASSIGNABLE_STATUSES.includes(asset.status)) {
      throw new Error(`El activo está en estado '${asset.status}' y no puede entregarse`)
    }
    const [openAssignment] = await tx.select({ id: itAssetAssignments.id })
      .from(itAssetAssignments)
      .where(and(eq(itAssetAssignments.assetId, input.assetId), isNull(itAssetAssignments.returnedAt)))
      .limit(1)
    if (openAssignment) throw new Error("El activo ya tiene una asignación abierta")

    const [worker] = await tx
      .select({ id: workers.id, worksiteId: workers.worksiteId, name: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))` })
      .from(workers).where(eq(workers.id, input.workerId))
    if (!worker) throw new Error("Trabajador no encontrado")
    if (worker.worksiteId !== input.worksiteId) {
      throw new Error("El trabajador no pertenece a la faena seleccionada")
    }

    const deliveredAt = chileLocalDateTimeToUtc(input.deliveredAt)
    const now = new Date().toISOString()
    const code = await nextCodeTx(tx, "ACT", codeYear())

    await tx.insert(itAssetAssignments).values({
      id,
      code,
      assetId: input.assetId,
      workerId: input.workerId,
      worksiteId: input.worksiteId,
      kind: input.kind ?? "delivery",
      deliveredAt,
      deliveredByUserId: actor.userId,
      physicalState: input.physicalState,
      observations: input.observations ?? null,
      acceptedAt: input.accepted !== false ? deliveredAt : null,
      acceptedByUserId: input.accepted !== false ? actor.userId : null,
    })

    if (input.accessoryNames.length > 0) {
      await tx.insert(itAssignmentAccessories).values(
        input.accessoryNames.map((name) => ({ id: nanoid(), assignmentId: id, name })),
      )
    }

    // Las fotos ya fueron persistidas por el upload previo (stage delivery).
    // Se anclan a esta asignación dentro de la misma transacción.
    if (input.photoIds.length > 0) {
      const updated = await tx.update(itAssignmentPhotos)
        .set({ assignmentId: id })
        .where(sql`${itAssignmentPhotos.id} IN ${input.photoIds}
          AND ${itAssignmentPhotos.assignmentId} IS NULL
          AND ${itAssignmentPhotos.stage} = 'delivery'
          AND ${itAssignmentPhotos.uploadedByUserId} = ${actor.userId}`)
        .returning({ id: itAssignmentPhotos.id })
      if (updated.length !== input.photoIds.length) {
        throw new Error("Las fotografías no están pendientes para este técnico y esta entrega")
      }
    }

    await tx.update(itAssets).set({
      status: assignmentTargetStatus(input.kind ?? "delivery"),
      workerId: input.workerId,
      worksiteId: input.worksiteId,
      updatedAt: now,
    }).where(eq(itAssets.id, input.assetId))

    await appendAssetHistory({
      assetId: input.assetId,
      action: "assigned",
      detail: `Asignado a ${worker.name} (acta ${code}).`,
      changes: { assignmentId: id, assignmentCode: code, kind: input.kind ?? "delivery" },
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_asset_assignment",
      entityId: id,
      entityCode: code,
      newState: { assetId: input.assetId, workerId: input.workerId, worksiteId: input.worksiteId, kind: input.kind ?? "delivery" },
    }, tx)
  })
  return id
}

export interface ReturnAssignmentInput {
  assignmentId: string
  returnedAt: string // ISO local datetime
  returnPhysicalState: string
  returnObservations?: string | null
  returnedAccessoryNames: string[]
  nextStatus: "disponible" | "en_bodega"
  photoIds: string[]
}

export async function returnAssignment(
  input: ReturnAssignmentInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: string[] | "all" = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [assignment] = await tx.select().from(itAssetAssignments)
      .where(eq(itAssetAssignments.id, input.assignmentId)).for("update")
    if (!assignment) throw new Error("Asignación no encontrada")
    if (assignment.returnedAt) throw new Error("Esta asignación ya fue devuelta")
    if (worksiteIds !== "all" && !worksiteIds.includes(assignment.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const [asset] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, assignment.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!asset) throw new Error("Activo no encontrado")
    if (!["asignado", "en_prestamo", "en_reparacion"].includes(asset.status)) {
      throw new Error(`El activo está en estado '${asset.status}'; solo se devuelve desde asignado, en préstamo o en reparación`)
    }

    const returnedAt = chileLocalDateTimeToUtc(input.returnedAt)
    const now = new Date().toISOString()

    await tx.update(itAssetAssignments).set({
      returnedAt,
      returnedByUserId: actor.userId,
      returnPhysicalState: input.returnPhysicalState,
      returnObservations: input.returnObservations ?? null,
      updatedAt: now,
    }).where(eq(itAssetAssignments.id, input.assignmentId))

    if (input.returnedAccessoryNames.length > 0) {
      const accessories = await tx.select({ id: itAssignmentAccessories.id, name: itAssignmentAccessories.name })
        .from(itAssignmentAccessories)
        .where(and(eq(itAssignmentAccessories.assignmentId, input.assignmentId), isNull(itAssignmentAccessories.returnedAt)))
      const nameSet = new Set(input.returnedAccessoryNames.map((n) => n.trim().toLowerCase()))
      for (const acc of accessories) {
        if (nameSet.has(acc.name.trim().toLowerCase())) {
          await tx.update(itAssignmentAccessories).set({ returnedAt }).where(eq(itAssignmentAccessories.id, acc.id))
        }
      }
    }

    // La devolución solo ancla fotos pendientes para ESTA asignación y ESTE
    // técnico. Hasta este punto aún podían descartarse; después son evidencia
    // append-only del acta.
    if (input.photoIds.length > 0) {
      const updated = await tx.update(itAssignmentPhotos)
        .set({ assignmentId: input.assignmentId, pendingAssignmentId: null })
        .where(sql`${itAssignmentPhotos.id} IN ${input.photoIds}
          AND ${itAssignmentPhotos.assignmentId} IS NULL
          AND ${itAssignmentPhotos.pendingAssignmentId} = ${input.assignmentId}
          AND ${itAssignmentPhotos.stage} = 'return'
          AND ${itAssignmentPhotos.uploadedByUserId} = ${actor.userId}`)
        .returning({ id: itAssignmentPhotos.id })
      if (updated.length !== input.photoIds.length) {
        throw new Error("Las fotografías no están pendientes para este técnico y esta devolución")
      }
    }

    await tx.update(itAssets).set({
      status: input.nextStatus,
      workerId: null,
      updatedAt: now,
    }).where(eq(itAssets.id, assignment.assetId))

    await appendAssetHistory({
      assetId: assignment.assetId,
      action: "returned",
      detail: `Devuelto (acta ${assignment.code}). Estado físico: ${input.returnPhysicalState}.`,
      changes: { assignmentId: assignment.id, returnPhysicalState: input.returnPhysicalState, nextStatus: input.nextStatus },
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_asset_assignment",
      entityId: assignment.id,
      entityCode: assignment.code,
      oldState: { returnedAt: null },
      newState: { returnedAt, returnPhysicalState: input.returnPhysicalState },
    }, tx)
  })
}

/** Transferencia = devolución + nueva entrega en una sola transacción. */
export async function transferAssignment(
  input: {
    assignmentId: string
    returnedAt: string
    returnPhysicalState: string
    returnObservations?: string | null
    newWorkerId: string
    newWorksiteId: string
    newKind?: string
    newDeliveredAt: string
    newPhysicalState: string
    newObservations?: string | null
    newAccessoryNames: string[]
    photoIds: string[]
  },
  actor: { userId: string; userEmail?: string },
  worksiteIds: string[] | "all" = "all",
): Promise<string> {
  const newAssignmentId = nanoid()
  await db.transaction(async (tx) => {
    if (worksiteIds !== "all" && !worksiteIds.includes(input.newWorksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    const [assignment] = await tx.select().from(itAssetAssignments)
      .where(eq(itAssetAssignments.id, input.assignmentId)).for("update")
    if (!assignment) throw new Error("Asignación no encontrada")
    if (assignment.returnedAt) throw new Error("Esta asignación ya fue devuelta")
    if (worksiteIds !== "all" && !worksiteIds.includes(assignment.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const [asset] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, assignment.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!asset) throw new Error("Activo no encontrado")

    const [worker] = await tx.select({ id: workers.id, worksiteId: workers.worksiteId }).from(workers).where(eq(workers.id, input.newWorkerId))
    if (!worker) throw new Error("Trabajador no encontrado")
    if (worker.worksiteId !== input.newWorksiteId) {
      throw new Error("El trabajador no pertenece a la faena seleccionada")
    }

    const returnedAt = chileLocalDateTimeToUtc(input.returnedAt)
    const newDeliveredAt = chileLocalDateTimeToUtc(input.newDeliveredAt)
    const now = new Date().toISOString()
    const code = await nextCodeTx(tx, "ACT", codeYear())

    // Una transferencia cierra la custodia anterior completa. Los accesorios
    // abiertos se devuelven en el acta anterior y se vuelven a entregar en la
    // nueva, conservando ambos tramos de trazabilidad.
    const carriedAccessories = await tx.select({ id: itAssignmentAccessories.id, name: itAssignmentAccessories.name })
      .from(itAssignmentAccessories)
      .where(and(eq(itAssignmentAccessories.assignmentId, assignment.id), isNull(itAssignmentAccessories.returnedAt)))
    if (carriedAccessories.length > 0) {
      await tx.update(itAssignmentAccessories).set({ returnedAt })
        .where(and(eq(itAssignmentAccessories.assignmentId, assignment.id), isNull(itAssignmentAccessories.returnedAt)))
    }

    await tx.update(itAssetAssignments).set({
      returnedAt,
      returnedByUserId: actor.userId,
      returnPhysicalState: input.returnPhysicalState,
      returnObservations: input.returnObservations ?? null,
      updatedAt: now,
    }).where(eq(itAssetAssignments.id, input.assignmentId))

    await tx.insert(itAssetAssignments).values({
      id: newAssignmentId,
      code,
      assetId: assignment.assetId,
      workerId: input.newWorkerId,
      worksiteId: input.newWorksiteId,
      kind: input.newKind ?? "transfer",
      deliveredAt: newDeliveredAt,
      deliveredByUserId: actor.userId,
      physicalState: input.newPhysicalState,
      observations: input.newObservations ?? null,
      acceptedAt: newDeliveredAt,
      acceptedByUserId: actor.userId,
    })

    const newAccessoryNames = [...carriedAccessories.map((accessory) => accessory.name), ...input.newAccessoryNames]
      .map((name) => name.trim())
      .filter((name, index, names) => Boolean(name) && names.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index)
    if (newAccessoryNames.length > 0) {
      await tx.insert(itAssignmentAccessories).values(
        newAccessoryNames.map((name) => ({ id: nanoid(), assignmentId: newAssignmentId, name })),
      )
    }

    if (input.photoIds.length > 0) {
      const updated = await tx.update(itAssignmentPhotos)
        .set({ assignmentId: newAssignmentId })
        .where(sql`${itAssignmentPhotos.id} IN ${input.photoIds}
          AND ${itAssignmentPhotos.assignmentId} IS NULL
          AND ${itAssignmentPhotos.stage} = 'delivery'
          AND ${itAssignmentPhotos.uploadedByUserId} = ${actor.userId}`)
        .returning({ id: itAssignmentPhotos.id })
      if (updated.length !== input.photoIds.length) {
        throw new Error("Las fotografías no están pendientes para este técnico y esta entrega")
      }
    }

    await tx.update(itAssets).set({
      status: assignmentTargetStatus(input.newKind ?? "transfer"),
      workerId: input.newWorkerId,
      worksiteId: input.newWorksiteId,
      updatedAt: now,
    }).where(eq(itAssets.id, assignment.assetId))

    await appendAssetHistory({
      assetId: assignment.assetId,
      action: "assigned",
      detail: `Transferido (acta ${code}).`,
      changes: { fromAssignmentId: assignment.id, newAssignmentId, newAssignmentCode: code },
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_asset_assignment",
      entityId: newAssignmentId,
      entityCode: code,
      // El mismo valor que se insertó arriba, no "transfer" fijo: si la UI
      // llega a ofrecer transferir como préstamo, la auditoría no debe mentir.
      newState: { assetId: assignment.assetId, workerId: input.newWorkerId, kind: input.newKind ?? "transfer" },
    }, tx)
  })
  return newAssignmentId
}

export interface AssignmentListFilters {
  assetId?: string
  workerId?: string
  worksiteId?: string
  status?: "active" | "returned"
  scope?: SQL
}

export async function listAssignments(filters: AssignmentListFilters) {
  const conditions: SQL[] = []
  if (filters.assetId) conditions.push(eq(itAssetAssignments.assetId, filters.assetId))
  if (filters.workerId) conditions.push(eq(itAssetAssignments.workerId, filters.workerId))
  if (filters.worksiteId) conditions.push(eq(itAssetAssignments.worksiteId, filters.worksiteId))
  if (filters.status === "active") conditions.push(isNull(itAssetAssignments.returnedAt))
  if (filters.status === "returned") conditions.push(sql`${itAssetAssignments.returnedAt} IS NOT NULL`)
  if (filters.scope) conditions.push(filters.scope)

  return db
    .select({
      id: itAssetAssignments.id,
      code: itAssetAssignments.code,
      assetId: itAssetAssignments.assetId,
      assetCode: itAssets.code,
      assetBrand: itAssets.brand,
      assetModel: itAssets.model,
      workerId: itAssetAssignments.workerId,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      worksiteId: itAssetAssignments.worksiteId,
      worksiteName: worksites.name,
      kind: itAssetAssignments.kind,
      deliveredAt: itAssetAssignments.deliveredAt,
      physicalState: itAssetAssignments.physicalState,
      returnedAt: itAssetAssignments.returnedAt,
      returnPhysicalState: itAssetAssignments.returnPhysicalState,
      deliveredByName: users.name,
    })
    .from(itAssetAssignments)
    .innerJoin(itAssets, eq(itAssetAssignments.assetId, itAssets.id))
    .innerJoin(workers, eq(itAssetAssignments.workerId, workers.id))
    .innerJoin(worksites, eq(itAssetAssignments.worksiteId, worksites.id))
    .leftJoin(users, eq(itAssetAssignments.deliveredByUserId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(itAssetAssignments.deliveredAt))
}

export async function getAssignmentById(id: string, scope?: SQL) {
  const conditions: SQL[] = [eq(itAssetAssignments.id, id)]
  if (scope) conditions.push(scope)
  const [row] = await db
    .select({
      id: itAssetAssignments.id,
      code: itAssetAssignments.code,
      assetId: itAssetAssignments.assetId,
      assetCode: itAssets.code,
      assetBrand: itAssets.brand,
      assetModel: itAssets.model,
      assetSerialNumber: itAssets.serialNumber,
      workerId: itAssetAssignments.workerId,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      workerRut: workers.rut,
      workerPosition: workers.position,
      worksiteId: itAssetAssignments.worksiteId,
      worksiteName: worksites.name,
      kind: itAssetAssignments.kind,
      deliveredAt: itAssetAssignments.deliveredAt,
      deliveredByUserId: itAssetAssignments.deliveredByUserId,
      deliveredByName: users.name,
      physicalState: itAssetAssignments.physicalState,
      observations: itAssetAssignments.observations,
      acceptedAt: itAssetAssignments.acceptedAt,
      acceptedByUserId: itAssetAssignments.acceptedByUserId,
      acceptedByName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itAssetAssignments.acceptedByUserId})`,
      returnedAt: itAssetAssignments.returnedAt,
      returnedByUserId: itAssetAssignments.returnedByUserId,
      returnedByName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itAssetAssignments.returnedByUserId})`,
      returnPhysicalState: itAssetAssignments.returnPhysicalState,
      returnObservations: itAssetAssignments.returnObservations,
    })
    .from(itAssetAssignments)
    .innerJoin(itAssets, eq(itAssetAssignments.assetId, itAssets.id))
    .innerJoin(workers, eq(itAssetAssignments.workerId, workers.id))
    .innerJoin(worksites, eq(itAssetAssignments.worksiteId, worksites.id))
    .leftJoin(users, eq(itAssetAssignments.deliveredByUserId, users.id))
    .where(and(...conditions))
    .limit(1)
  return row ?? null
}

export async function getAssignmentAccessories(assignmentId: string) {
  return db
    .select()
    .from(itAssignmentAccessories)
    .where(eq(itAssignmentAccessories.assignmentId, assignmentId))
    .orderBy(asc(itAssignmentAccessories.name))
}

/** Variante en lote de `getAssignmentAccessories`: evita 1 query por asignación en la ficha del activo. */
export async function getAssignmentsAccessories(
  assignmentIds: string[],
): Promise<Map<string, Awaited<ReturnType<typeof getAssignmentAccessories>>>> {
  const map = new Map<string, Awaited<ReturnType<typeof getAssignmentAccessories>>>()
  if (assignmentIds.length === 0) return map
  const rows = await db
    .select()
    .from(itAssignmentAccessories)
    .where(inArray(itAssignmentAccessories.assignmentId, assignmentIds))
    .orderBy(asc(itAssignmentAccessories.name))
  for (const row of rows) {
    const list = map.get(row.assignmentId) ?? []
    list.push(row)
    map.set(row.assignmentId, list)
  }
  return map
}

export async function getAssignmentPhotos(assignmentId: string) {
  return db
    .select({
      id: itAssignmentPhotos.id,
      stage: itAssignmentPhotos.stage,
      fileName: itAssignmentPhotos.fileName,
      filePath: itAssignmentPhotos.filePath,
      mimeType: itAssignmentPhotos.mimeType,
      caption: itAssignmentPhotos.caption,
      uploadedAt: itAssignmentPhotos.createdAt,
      uploadedByName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itAssignmentPhotos.uploadedByUserId})`,
    })
    .from(itAssignmentPhotos)
    .where(eq(itAssignmentPhotos.assignmentId, assignmentId))
    .orderBy(asc(itAssignmentPhotos.createdAt))
}

/** Variante en lote de `getAssignmentPhotos`: evita 1 query por asignación en la ficha del activo. */
export async function getAssignmentsPhotos(
  assignmentIds: string[],
): Promise<Map<string, Awaited<ReturnType<typeof getAssignmentPhotos>>>> {
  const map = new Map<string, Awaited<ReturnType<typeof getAssignmentPhotos>>>()
  if (assignmentIds.length === 0) return map
  const rows = await db
    .select({
      assignmentId: itAssignmentPhotos.assignmentId,
      id: itAssignmentPhotos.id,
      stage: itAssignmentPhotos.stage,
      fileName: itAssignmentPhotos.fileName,
      filePath: itAssignmentPhotos.filePath,
      mimeType: itAssignmentPhotos.mimeType,
      caption: itAssignmentPhotos.caption,
      uploadedAt: itAssignmentPhotos.createdAt,
      uploadedByName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itAssignmentPhotos.uploadedByUserId})`,
    })
    .from(itAssignmentPhotos)
    .where(inArray(itAssignmentPhotos.assignmentId, assignmentIds))
    .orderBy(asc(itAssignmentPhotos.createdAt))
  for (const row of rows) {
    const { assignmentId, ...rest } = row
    if (!assignmentId) continue
    const list = map.get(assignmentId) ?? []
    list.push(rest)
    map.set(assignmentId, list)
  }
  return map
}

export async function getActiveAssignmentForAsset(assetId: string) {
  const [row] = await db
    .select()
    .from(itAssetAssignments)
    .where(and(eq(itAssetAssignments.assetId, assetId), isNull(itAssetAssignments.returnedAt)))
    .limit(1)
  return row ?? null
}
