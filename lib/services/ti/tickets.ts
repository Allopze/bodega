import { eq, and, isNull, desc, asc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itTickets, itTicketComments, itAssets, workers, worksites, users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { codeYear } from "@/lib/utils"


const OPEN_STATUSES = ["nuevo", "asignado", "en_diagnostico", "en_progreso", "esperando_usuario", "esperando_proveedor"]

export interface CreateTicketInput {
  subject: string
  description: string
  category: string
  priority: string
  workerId?: string | null
  worksiteId: string
  assetId?: string | null
}

/**
 * Crea un ticket TI. El `requesterUserId` es SIEMPRE el usuario que lo crea:
 * los trabajadores de faena sin cuenta son representados por un usuario con
 * cuenta (admin de contrato, jefe de terreno, TI).
 */
export async function createTicket(
  input: CreateTicketInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: string[] | "all" = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    if (worksiteIds !== "all" && !worksiteIds.includes(input.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const [worker] = input.workerId
      ? await tx.select({ id: workers.id, worksiteId: workers.worksiteId, name: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))` })
          .from(workers).where(eq(workers.id, input.workerId))
      : [undefined]
    if (input.workerId && !worker) throw new Error("Trabajador no encontrado")
    if (worker && worker.worksiteId !== input.worksiteId) {
      throw new Error("El trabajador no pertenece a la faena seleccionada")
    }

    if (input.assetId) {
      const [asset] = await tx.select({ id: itAssets.id, worksiteId: itAssets.worksiteId }).from(itAssets)
        .where(and(eq(itAssets.id, input.assetId), isNull(itAssets.deletedAt)))
      if (!asset) throw new Error("Activo no encontrado")
      if (asset.worksiteId !== input.worksiteId) {
        throw new Error("El activo no pertenece a la faena seleccionada")
      }
    }

    const code = await nextCodeTx(tx, "INC", codeYear())

    await tx.insert(itTickets).values({
      id,
      code,
      subject: input.subject,
      description: input.description,
      category: input.category,
      priority: input.priority,
      status: "nuevo",
      requesterUserId: actor.userId,
      workerId: input.workerId || null,
      worksiteId: input.worksiteId,
      assetId: input.assetId || null,
    })

    if (input.assetId) {
      await appendAssetHistory({
        assetId: input.assetId,
        action: "ticket",
        detail: `Ticket ${code} creado: ${input.subject}.`,
        changes: { ticketId: id, ticketCode: code },
        actorUserId: actor.userId,
      }, tx)
    }

    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_ticket",
      entityId: id,
      entityCode: code,
      newState: {
        subject: input.subject, category: input.category, priority: input.priority,
        workerId: input.workerId ?? null, assetId: input.assetId ?? null, worksiteId: input.worksiteId,
      },
    }, tx)
  })
  return id
}

export interface TransitionTicketInput {
  ticketId: string
  status: string
  reason: string
  resolution?: string | null
  assigneeUserId?: string | null
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  nuevo: ["asignado", "en_diagnostico", "en_progreso", "esperando_usuario", "resuelto", "cerrado"],
  asignado: ["en_diagnostico", "en_progreso", "esperando_usuario", "esperando_proveedor", "resuelto", "cerrado"],
  en_diagnostico: ["en_progreso", "esperando_usuario", "esperando_proveedor", "resuelto", "cerrado"],
  en_progreso: ["esperando_usuario", "esperando_proveedor", "resuelto", "cerrado"],
  esperando_usuario: ["en_progreso", "resuelto", "cerrado"],
  esperando_proveedor: ["en_progreso", "resuelto", "cerrado"],
  resuelto: ["cerrado", "en_progreso"],
  cerrado: ["en_progreso"],
}

export async function transitionTicket(
  input: TransitionTicketInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: string[] | "all" = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(itTickets)
      .where(eq(itTickets.id, input.ticketId)).for("update")
    if (!ticket) throw new Error("Ticket no encontrado")
    if (worksiteIds !== "all" && !worksiteIds.includes(ticket.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const allowed = ALLOWED_TRANSITIONS[ticket.status] ?? []
    if (!allowed.includes(input.status)) {
      throw new Error(`No se puede pasar de '${ticket.status}' a '${input.status}'`)
    }

    const now = new Date().toISOString()
    await tx.update(itTickets).set({
      status: input.status,
      assigneeUserId: input.assigneeUserId ?? ticket.assigneeUserId,
      resolvedAt: input.status === "resuelto" ? now : ticket.resolvedAt,
      resolution: input.status === "resuelto" ? (input.resolution?.trim() || null) : ticket.resolution,
      updatedAt: now,
    }).where(eq(itTickets.id, input.ticketId))

    if (ticket.assetId) {
      await appendAssetHistory({
        assetId: ticket.assetId,
        action: "ticket",
        detail: `Ticket ${ticket.code}: ${ticket.status} → ${input.status}.`,
        changes: { ticketId: ticket.id, reason: input.reason },
        actorUserId: actor.userId,
      }, tx)
    }

    await recordStatusChange({
      entityType: "it_ticket",
      entityId: ticket.id,
      fromStatus: ticket.status,
      toStatus: input.status,
      changedBy: actor.userId,
      reason: input.reason,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "status_change",
      entityType: "it_ticket",
      entityId: ticket.id,
      entityCode: ticket.code,
      oldState: { status: ticket.status },
      newState: { status: input.status },
      reason: input.reason,
    }, tx)
  })
}

export async function addTicketComment(
  input: { ticketId: string; body: string; isInternal: boolean },
  actor: { userId: string; userEmail?: string },
  worksiteIds: string[] | "all" = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [ticket] = await tx.select({ id: itTickets.id, worksiteId: itTickets.worksiteId })
      .from(itTickets).where(eq(itTickets.id, input.ticketId)).for("update")
    if (!ticket) throw new Error("Ticket no encontrado")
    if (worksiteIds !== "all" && !worksiteIds.includes(ticket.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    await tx.insert(itTicketComments).values({
      id,
      ticketId: input.ticketId,
      body: input.body,
      authorUserId: actor.userId,
      isInternal: input.isInternal,
    })
    await tx.update(itTickets).set({ updatedAt: new Date().toISOString() })
      .where(eq(itTickets.id, input.ticketId))
  })
  return id
}

export interface TicketListFilters {
  status?: string
  priority?: string
  category?: string
  worksiteId?: string
  workerId?: string
  assetId?: string
  assigneeUserId?: string
  requesterUserId?: string
  scope?: SQL
  search?: string
}

export async function listTickets(filters: TicketListFilters) {
  const conditions: SQL[] = []
  if (filters.status) conditions.push(eq(itTickets.status, filters.status))
  if (filters.priority) conditions.push(eq(itTickets.priority, filters.priority))
  if (filters.category) conditions.push(eq(itTickets.category, filters.category))
  if (filters.worksiteId) conditions.push(eq(itTickets.worksiteId, filters.worksiteId))
  if (filters.workerId) conditions.push(eq(itTickets.workerId, filters.workerId))
  if (filters.assetId) conditions.push(eq(itTickets.assetId, filters.assetId))
  if (filters.assigneeUserId) conditions.push(eq(itTickets.assigneeUserId, filters.assigneeUserId))
  if (filters.requesterUserId) conditions.push(eq(itTickets.requesterUserId, filters.requesterUserId))
  if (filters.scope) conditions.push(filters.scope)
  if (filters.search) {
    const like = `%${filters.search}%`
    conditions.push(sql`(${itTickets.code} ILIKE ${like} OR ${itTickets.subject} ILIKE ${like} OR ${itTickets.description} ILIKE ${like})`)
  }

  return db
    .select({
      id: itTickets.id,
      code: itTickets.code,
      subject: itTickets.subject,
      category: itTickets.category,
      priority: itTickets.priority,
      status: itTickets.status,
      workerId: itTickets.workerId,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      worksiteId: itTickets.worksiteId,
      worksiteName: worksites.name,
      assetId: itTickets.assetId,
      assetCode: itAssets.code,
      assigneeUserId: itTickets.assigneeUserId,
      assigneeName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itTickets.assigneeUserId})`,
      requesterName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itTickets.requesterUserId})`,
      createdAt: itTickets.createdAt,
      updatedAt: itTickets.updatedAt,
      resolvedAt: itTickets.resolvedAt,
    })
    .from(itTickets)
    .leftJoin(workers, eq(itTickets.workerId, workers.id))
    .innerJoin(worksites, eq(itTickets.worksiteId, worksites.id))
    .leftJoin(itAssets, eq(itTickets.assetId, itAssets.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(itTickets.createdAt))
}

export async function getTicketById(id: string, scope?: SQL) {
  const conditions: SQL[] = [eq(itTickets.id, id)]
  if (scope) conditions.push(scope)
  const [row] = await db
    .select({
      id: itTickets.id,
      code: itTickets.code,
      subject: itTickets.subject,
      description: itTickets.description,
      category: itTickets.category,
      priority: itTickets.priority,
      status: itTickets.status,
      workerId: itTickets.workerId,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      worksiteId: itTickets.worksiteId,
      worksiteName: worksites.name,
      assetId: itTickets.assetId,
      assetCode: itAssets.code,
      assigneeUserId: itTickets.assigneeUserId,
      assigneeName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itTickets.assigneeUserId})`,
      requesterUserId: itTickets.requesterUserId,
      requesterName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itTickets.requesterUserId})`,
      resolution: itTickets.resolution,
      createdAt: itTickets.createdAt,
      updatedAt: itTickets.updatedAt,
      resolvedAt: itTickets.resolvedAt,
    })
    .from(itTickets)
    .leftJoin(workers, eq(itTickets.workerId, workers.id))
    .innerJoin(worksites, eq(itTickets.worksiteId, worksites.id))
    .leftJoin(itAssets, eq(itTickets.assetId, itAssets.id))
    .where(and(...conditions))
    .limit(1)
  return row ?? null
}

export async function getTicketComments(ticketId: string, includeInternal: boolean) {
  return db
    .select({
      id: itTicketComments.id,
      body: itTicketComments.body,
      isInternal: itTicketComments.isInternal,
      authorName: users.name,
      createdAt: itTicketComments.createdAt,
    })
    .from(itTicketComments)
    .innerJoin(users, eq(itTicketComments.authorUserId, users.id))
    .where(includeInternal
      ? eq(itTicketComments.ticketId, ticketId)
      : and(eq(itTicketComments.ticketId, ticketId), eq(itTicketComments.isInternal, false)))
    .orderBy(asc(itTicketComments.createdAt))
}

export function isTicketOpen(status: string): boolean {
  return OPEN_STATUSES.includes(status)
}
