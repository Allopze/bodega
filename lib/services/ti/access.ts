import { eq, and, desc, asc, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itAccessSystems, itSystemAccess, itWorkerChecklists, itChecklistTasks,
  workers, worksites, users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { ONBOARDING_CHECKLIST_TEMPLATE, OFFBOARDING_CHECKLIST_TEMPLATE } from "./constants"
import { assertTiGlobalAccess, assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"

/* ── Sistemas (catálogo configurable) ────────────────────────────────────── */

export async function createAccessSystem(
  input: { name: string; description?: string | null },
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  assertTiGlobalAccess(worksiteIds)
  const id = nanoid()
  const name = input.name.trim()
  await db.transaction(async (tx) => {
    const [duplicate] = await tx.select({ id: itAccessSystems.id })
      .from(itAccessSystems)
      .where(sql`lower(${itAccessSystems.name}) = lower(${name})`)
      .limit(1)
    if (duplicate) throw new Error("Ya existe un sistema con ese nombre")

    await tx.insert(itAccessSystems).values({
      id,
      name,
      description: input.description?.trim() || null,
    })
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_access_system",
      entityId: id,
      newState: { name },
    }, tx)
  })
  return id
}

export async function toggleAccessSystem(
  systemId: string,
  isActive: boolean,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<void> {
  assertTiGlobalAccess(worksiteIds)
  await db.transaction(async (tx) => {
    const [system] = await tx.select().from(itAccessSystems).where(eq(itAccessSystems.id, systemId)).for("update")
    if (!system) throw new Error("Sistema no encontrado")
    await tx.update(itAccessSystems).set({ isActive, updatedAt: new Date().toISOString() })
      .where(eq(itAccessSystems.id, systemId))
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_access_system",
      entityId: systemId,
      oldState: { isActive: system.isActive },
      newState: { isActive },
    }, tx)
  })
}

export async function listAccessSystems(options?: { includeInactive?: boolean }, worksiteIds: TiWorksiteScope = "all") {
  return db
    .select({
      id: itAccessSystems.id,
      name: itAccessSystems.name,
      description: itAccessSystems.description,
      isActive: itAccessSystems.isActive,
      // Subconsulta correlacionada con nombres de columna completamente
      // calificados (misma convención que stock-documents.ts): en una query de
      // una sola tabla, Drizzle renderiza las columnas interpoladas sin
      // prefijo de tabla, y el `"id"` desnudo se resuelve contra la tabla
      // interna (contando 0 siempre).
      accessCount: accessCountSql(worksiteIds).as("accessCount"),
    })
    .from(itAccessSystems)
    .where(options?.includeInactive ? undefined : eq(itAccessSystems.isActive, true))
    .orderBy(asc(itAccessSystems.name))
}

/* ── Accesos por trabajador (nunca contraseñas) ──────────────────────────── */

export async function upsertSystemAccess(
  input: { systemId: string; workerId: string; status: string; responsibleUserId?: string | null; notes?: string | null },
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  return db.transaction(async (tx) => {
    const [worker] = await tx.select({ id: workers.id, worksiteId: workers.worksiteId })
      .from(workers).where(eq(workers.id, input.workerId))
    if (!worker) throw new Error("Trabajador no encontrado")
    assertTiWorksiteAccess(worksiteIds, worker.worksiteId)
    const [existing] = await tx.select().from(itSystemAccess)
      .where(and(eq(itSystemAccess.systemId, input.systemId), eq(itSystemAccess.workerId, input.workerId)))
      .for("update")

    const now = new Date().toISOString()
    if (existing) {
      await tx.update(itSystemAccess).set({
        status: input.status,
        revokedAt: input.status === "baja" ? now : null,
        responsibleUserId: input.responsibleUserId || existing.responsibleUserId,
        notes: input.notes == null ? existing.notes : input.notes.trim() || null,
        updatedAt: now,
      }).where(eq(itSystemAccess.id, existing.id))
      await recordAudit({
        userId: actor.userId,
        userEmail: actor.userEmail,
        action: "update",
        entityType: "it_system_access",
        entityId: existing.id,
        oldState: { status: existing.status },
        newState: { status: input.status },
      }, tx)
      return existing.id
    }

    const id = nanoid()
    await tx.insert(itSystemAccess).values({
      id,
      systemId: input.systemId,
      workerId: input.workerId,
      status: input.status,
      revokedAt: input.status === "baja" ? now : null,
      responsibleUserId: input.responsibleUserId || null,
      notes: input.notes?.trim() || null,
    })
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_system_access",
      entityId: id,
      newState: { systemId: input.systemId, workerId: input.workerId, status: input.status },
    }, tx)
    return id
  })
}

export async function listWorkerAccess(workerId: string, worksiteIds: TiWorksiteScope = "all") {
  const conditions: SQL[] = [eq(itSystemAccess.workerId, workerId)]
  if (worksiteIds !== "all") conditions.push(worksiteIds.length ? inArray(workers.worksiteId, worksiteIds) : sql`false`)
  return db
    .select({
      id: itSystemAccess.id,
      systemId: itSystemAccess.systemId,
      systemName: itAccessSystems.name,
      status: itSystemAccess.status,
      grantedAt: itSystemAccess.grantedAt,
      revokedAt: itSystemAccess.revokedAt,
      responsibleName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itSystemAccess.responsibleUserId})`,
      notes: itSystemAccess.notes,
    })
    .from(itSystemAccess)
    .innerJoin(itAccessSystems, eq(itSystemAccess.systemId, itAccessSystems.id))
    .innerJoin(workers, eq(itSystemAccess.workerId, workers.id))
    .where(and(...conditions))
    .orderBy(asc(itAccessSystems.name))
}

export async function listWorkersWithAccess(filters?: { systemId?: string; worksiteId?: string; search?: string; scope?: SQL }) {
  const workersList = await db
    .select({
      id: workers.id,
      name: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      worksiteId: workers.worksiteId,
      worksiteName: worksites.name,
    })
    .from(workers)
    .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
    .where(and(
      eq(workers.isActive, true),
      filters?.worksiteId ? eq(workers.worksiteId, filters.worksiteId) : undefined,
      filters?.scope,
    ))
    .orderBy(asc(workers.firstName), asc(workers.lastName))

  if (workersList.length === 0) return []

  const accesses = await db
    .select({
      workerId: itSystemAccess.workerId,
      systemId: itSystemAccess.systemId,
      systemName: itAccessSystems.name,
      status: itSystemAccess.status,
      notes: itSystemAccess.notes,
    })
    .from(itSystemAccess)
    .innerJoin(itAccessSystems, eq(itSystemAccess.systemId, itAccessSystems.id))
    .innerJoin(workers, eq(itSystemAccess.workerId, workers.id))
    .where(and(
      filters?.systemId ? eq(itSystemAccess.systemId, filters.systemId) : undefined,
      filters?.scope,
    ))

  const accessByWorker = new Map<string, { systemId: string; systemName: string; status: string; notes: string | null }[]>()
  for (const access of accesses) {
    const list = accessByWorker.get(access.workerId) ?? []
    list.push({ systemId: access.systemId, systemName: access.systemName, status: access.status, notes: access.notes })
    accessByWorker.set(access.workerId, list)
  }

  return workersList
    .map((worker) => ({ ...worker, accesses: accessByWorker.get(worker.id) ?? [] }))
    .filter((worker) => !filters?.search || worker.name.toLowerCase().includes(filters.search.toLowerCase()))
}

/* ── Checklists de alta/baja ─────────────────────────────────────────────── */

export async function createChecklist(
  input: { workerId: string; kind: "onboarding" | "offboarding"; notes?: string | null },
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [worker] = await tx.select({ id: workers.id, worksiteId: workers.worksiteId }).from(workers).where(eq(workers.id, input.workerId))
    if (!worker) throw new Error("Trabajador no encontrado")
    assertTiWorksiteAccess(worksiteIds, worker.worksiteId)

    await tx.insert(itWorkerChecklists).values({
      id,
      workerId: input.workerId,
      kind: input.kind,
      createdByUserId: actor.userId,
      notes: input.notes?.trim() || null,
    })

    // Los nombres se instancian desde la plantilla: si la plantilla evoluciona,
    // los checklists ya creados conservan sus tareas históricas.
    const template = input.kind === "onboarding" ? ONBOARDING_CHECKLIST_TEMPLATE : OFFBOARDING_CHECKLIST_TEMPLATE
    await tx.insert(itChecklistTasks).values(
      template.map((name) => ({ id: nanoid(), checklistId: id, name })),
    )
  })
  return id
}

export async function toggleChecklistTask(
  input: { taskId: string; done: boolean; notes?: string | null },
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [task] = await tx.select({
      id: itChecklistTasks.id,
      checklistId: itChecklistTasks.checklistId,
      workerWorksiteId: workers.worksiteId,
    }).from(itChecklistTasks)
      .innerJoin(itWorkerChecklists, eq(itChecklistTasks.checklistId, itWorkerChecklists.id))
      .innerJoin(workers, eq(itWorkerChecklists.workerId, workers.id))
      .where(eq(itChecklistTasks.id, input.taskId)).for("update")
    if (!task) throw new Error("Tarea no encontrada")
    assertTiWorksiteAccess(worksiteIds, task.workerWorksiteId)

    await tx.update(itChecklistTasks).set({
      done: input.done,
      doneAt: input.done ? new Date().toISOString() : null,
      doneByUserId: input.done ? actor.userId : null,
      notes: input.notes?.trim() || null,
    }).where(eq(itChecklistTasks.id, input.taskId))

    // Si todas las tareas quedaron hechas, se cierra el checklist.
    const [remaining] = await tx.select({
      pending: sql<number>`count(*) filter (where ${itChecklistTasks.done} = false)::int`,
    }).from(itChecklistTasks).where(eq(itChecklistTasks.checklistId, task.checklistId))
    await tx.update(itWorkerChecklists).set({
      completedAt: remaining?.pending === 0 ? new Date().toISOString() : null,
    }).where(eq(itWorkerChecklists.id, task.checklistId))
  })
}

export async function listChecklists(filters?: { workerId?: string; kind?: string; scope?: SQL }) {
  return db
    .select({
      id: itWorkerChecklists.id,
      workerId: itWorkerChecklists.workerId,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      worksiteName: worksites.name,
      kind: itWorkerChecklists.kind,
      startedAt: itWorkerChecklists.startedAt,
      completedAt: itWorkerChecklists.completedAt,
      createdByName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itWorkerChecklists.createdByUserId})`,
      notes: itWorkerChecklists.notes,
      totalTasks: sql<number>`(SELECT count(*)::int FROM ${itChecklistTasks} WHERE ${itChecklistTasks.checklistId} = ${itWorkerChecklists.id})`,
      doneTasks: sql<number>`(SELECT count(*) filter (where ${itChecklistTasks.done})::int FROM ${itChecklistTasks} WHERE ${itChecklistTasks.checklistId} = ${itWorkerChecklists.id})`,
    })
    .from(itWorkerChecklists)
    .innerJoin(workers, eq(itWorkerChecklists.workerId, workers.id))
    .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
    .where(and(
      filters?.workerId ? eq(itWorkerChecklists.workerId, filters.workerId) : undefined,
      filters?.kind ? eq(itWorkerChecklists.kind, filters.kind) : undefined,
      filters?.scope,
    ))
    .orderBy(desc(itWorkerChecklists.startedAt))
}

function accessCountSql(worksiteIds: TiWorksiteScope): SQL<number> {
  if (worksiteIds === "all") {
    return sql<number>`(
      SELECT count(*)::int
      FROM "it_system_access"
      WHERE "it_system_access"."system_id" = "it_access_systems"."id"
        AND "it_system_access"."status" = 'activo'
    )`
  }
  if (worksiteIds.length === 0) return sql<number>`0`
  const ids = sql.join(worksiteIds.map((id) => sql`${id}`), sql`, `)
  return sql<number>`(
    SELECT count(*)::int
    FROM "it_system_access"
    INNER JOIN "workers" ON "workers"."id" = "it_system_access"."worker_id"
    WHERE "it_system_access"."system_id" = "it_access_systems"."id"
      AND "it_system_access"."status" = 'activo'
      AND "workers"."worksite_id" IN (${ids})
  )`
}

export async function getChecklistTasks(checklistId: string) {
  return db
    .select({
      id: itChecklistTasks.id,
      name: itChecklistTasks.name,
      done: itChecklistTasks.done,
      doneAt: itChecklistTasks.doneAt,
      doneByName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itChecklistTasks.doneByUserId})`,
      notes: itChecklistTasks.notes,
    })
    .from(itChecklistTasks)
    .where(eq(itChecklistTasks.checklistId, checklistId))
    .orderBy(asc(itChecklistTasks.name))
}
