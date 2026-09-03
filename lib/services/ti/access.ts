import { eq, and, desc, asc, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  itAccessSystems, itSystemAccess, itWorkerChecklists, itChecklistTasks,
  workers, worksites, users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { ONBOARDING_CHECKLIST_TEMPLATE, OFFBOARDING_CHECKLIST_TEMPLATE } from "./constants"

/* ── Sistemas (catálogo configurable) ────────────────────────────────────── */

export async function createAccessSystem(
  input: { name: string; description?: string | null },
  actor: { userId: string; userEmail?: string },
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    await tx.insert(itAccessSystems).values({
      id,
      name: input.name,
      description: input.description?.trim() || null,
    })
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_access_system",
      entityId: id,
      newState: { name: input.name },
    }, tx)
  })
  return id
}

export async function toggleAccessSystem(
  systemId: string,
  isActive: boolean,
  actor: { userId: string; userEmail?: string },
): Promise<void> {
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

export async function listAccessSystems(options?: { includeInactive?: boolean }) {
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
      accessCount: sql<number>`(
        SELECT count(*)::int
        FROM "it_system_access"
        WHERE "it_system_access"."system_id" = "it_access_systems"."id"
          AND "it_system_access"."status" = 'activo'
      )`,
    })
    .from(itAccessSystems)
    .where(options?.includeInactive ? undefined : eq(itAccessSystems.isActive, true))
    .orderBy(asc(itAccessSystems.name))
}

/* ── Accesos por trabajador (nunca contraseñas) ──────────────────────────── */

export async function upsertSystemAccess(
  input: { systemId: string; workerId: string; status: string; responsibleUserId?: string | null; notes?: string | null },
  actor: { userId: string; userEmail?: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itSystemAccess)
      .where(and(eq(itSystemAccess.systemId, input.systemId), eq(itSystemAccess.workerId, input.workerId)))
      .for("update")

    const now = new Date().toISOString()
    if (existing) {
      await tx.update(itSystemAccess).set({
        status: input.status,
        revokedAt: input.status === "baja" ? now : existing.revokedAt,
        responsibleUserId: input.responsibleUserId || existing.responsibleUserId,
        notes: input.notes?.trim() || null,
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

export async function listWorkerAccess(workerId: string) {
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
    .where(eq(itSystemAccess.workerId, workerId))
    .orderBy(asc(itAccessSystems.name))
}

export async function listWorkersWithAccess(filters?: { systemId?: string; worksiteId?: string; search?: string }) {
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
    ))
    .orderBy(asc(workers.firstName), asc(workers.lastName))

  if (workersList.length === 0) return []

  const accesses = await db
    .select({
      workerId: itSystemAccess.workerId,
      systemId: itSystemAccess.systemId,
      systemName: itAccessSystems.name,
      status: itSystemAccess.status,
    })
    .from(itSystemAccess)
    .innerJoin(itAccessSystems, eq(itSystemAccess.systemId, itAccessSystems.id))
    .where(filters?.systemId ? eq(itSystemAccess.systemId, filters.systemId) : undefined)

  const accessByWorker = new Map<string, { systemName: string; status: string }[]>()
  for (const access of accesses) {
    const list = accessByWorker.get(access.workerId) ?? []
    list.push({ systemName: access.systemName, status: access.status })
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
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [worker] = await tx.select({ id: workers.id }).from(workers).where(eq(workers.id, input.workerId))
    if (!worker) throw new Error("Trabajador no encontrado")

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
): Promise<void> {
  await db.transaction(async (tx) => {
    const [task] = await tx.select().from(itChecklistTasks).where(eq(itChecklistTasks.id, input.taskId)).for("update")
    if (!task) throw new Error("Tarea no encontrada")

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
    if (remaining && remaining.pending === 0) {
      await tx.update(itWorkerChecklists).set({ completedAt: new Date().toISOString() })
        .where(eq(itWorkerChecklists.id, task.checklistId))
    }
  })
}

export async function listChecklists(filters?: { workerId?: string; kind?: string }) {
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
    ))
    .orderBy(desc(itWorkerChecklists.startedAt))
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
