import { eq, and, isNull, desc, asc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itTickets, itTicketComments, itAssets, workers, worksites, users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { codeYear, escapeLikePattern } from "@/lib/utils"
import { IT_TICKET_UNASSIGN, itTicketNextStatuses } from "@/lib/validation/ti"


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
 * Payload devuelto por `createTicket`: lo consume la action para notificar a
 * `ti:manage_tickets` de la faena, sin una relectura extra (todos los campos
 * ya están disponibles al momento de crear).
 */
export interface TicketCreated {
  id: string
  code: string
  subject: string
  priority: string
  worksiteId: string
  requesterUserId: string
  assetId: string | null
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
): Promise<TicketCreated> {
  const id = nanoid()
  return db.transaction(async (tx) => {
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

    return {
      id, code, subject: input.subject, priority: input.priority,
      // `|| null`, igual que el INSERT de arriba: el OptionSelect vacío manda
      // `""` y el payload debe reflejar lo que quedó en la fila, no el input.
      worksiteId: input.worksiteId, requesterUserId: actor.userId, assetId: input.assetId || null,
    }
  })
}

export interface TransitionTicketInput {
  ticketId: string
  status: string
  reason: string
  resolution?: string | null
  /**
   * `undefined`/`null` = conservar el asignado actual.
   * `IT_TICKET_UNASSIGN` = desasignar. Cualquier otro valor = id de usuario.
   */
  assigneeUserId?: string | null
}

/**
 * Payload devuelto por `transitionTicket`: la action lo usa para decidir a
 * quién notificar (asignado nuevo, solicitante al resolver) sin una relectura
 * fuera de la transacción — la fila ya está bloqueada acá y una relectura
 * post-commit no podría ver el asignado *anterior*, además de poder observar
 * un estado más nuevo si otro técnico transicionó en el intermedio.
 */
export interface TicketTransitionResult {
  id: string
  code: string
  subject: string
  priority: string
  worksiteId: string
  requesterUserId: string
  assetId: string | null
  fromStatus: string
  toStatus: string
  statusChanged: boolean
  previousAssigneeUserId: string | null
  assigneeUserId: string | null
  assigneeChanged: boolean
  resolution: string | null
}

export async function transitionTicket(
  input: TransitionTicketInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: string[] | "all" = "all",
): Promise<TicketTransitionResult> {
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(itTickets)
      .where(eq(itTickets.id, input.ticketId)).for("update")
    if (!ticket) throw new Error("Ticket no encontrado")
    if (worksiteIds !== "all" && !worksiteIds.includes(ticket.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const allowed = itTicketNextStatuses(ticket.status)
    if (!allowed.includes(input.status)) {
      throw new Error(`No se puede pasar de '${ticket.status}' a '${input.status}'`)
    }

    // Asignación explícita: el centinela desasigna, un id se valida contra
    // usuarios activos y cualquier otra cosa conserva el asignado actual.
    let assigneeUserId = ticket.assigneeUserId
    if (input.assigneeUserId === IT_TICKET_UNASSIGN) {
      assigneeUserId = null
    } else if (input.assigneeUserId) {
      const [assignee] = await tx.select({ id: users.id, isActive: users.isActive })
        .from(users).where(eq(users.id, input.assigneeUserId))
      if (!assignee) throw new Error("El técnico seleccionado no existe")
      if (!assignee.isActive) throw new Error("El técnico seleccionado está inactivo")
      assigneeUserId = assignee.id
    }
    if (input.status === "asignado" && !assigneeUserId) {
      throw new Error("Selecciona el técnico responsable para dejar el ticket en 'asignado'")
    }

    const now = new Date().toISOString()
    const reopening = input.status === "en_progreso" && ["resuelto", "cerrado"].includes(ticket.status)
    const finalResolution = input.status === "resuelto" ? (input.resolution?.trim() || null) : reopening ? null : ticket.resolution
    await tx.update(itTickets).set({
      status: input.status,
      assigneeUserId,
      resolvedAt: input.status === "resuelto" ? now : reopening ? null : ticket.resolvedAt,
      resolution: finalResolution,
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

    return {
      id: ticket.id, code: ticket.code, subject: ticket.subject, priority: ticket.priority,
      worksiteId: ticket.worksiteId, requesterUserId: ticket.requesterUserId, assetId: ticket.assetId,
      fromStatus: ticket.status, toStatus: input.status, statusChanged: ticket.status !== input.status,
      previousAssigneeUserId: ticket.assigneeUserId, assigneeUserId,
      assigneeChanged: ticket.assigneeUserId !== assigneeUserId,
      resolution: finalResolution,
    }
  })
}

export async function addTicketComment(
  input: { ticketId: string; body: string; isInternal: boolean },
  actor: { userId: string; userEmail?: string },
  worksiteIds: string[] | "all" = "all",
  /**
   * Cuando viene, el ticket además debe ser de este solicitante. Es la misma
   * "doble reja" que aplica la ficha del ticket a quien solo tiene
   * `ti:create_ticket`: sin esto podía comentar por llamada directa un ticket
   * ajeno de su faena, que es justo lo que ese alcance restringido evita.
   */
  onlyRequesterUserId?: string,
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [ticket] = await tx.select({
      id: itTickets.id,
      worksiteId: itTickets.worksiteId,
      requesterUserId: itTickets.requesterUserId,
    })
      .from(itTickets).where(eq(itTickets.id, input.ticketId)).for("update")
    if (!ticket) throw new Error("Ticket no encontrado")
    if (worksiteIds !== "all" && !worksiteIds.includes(ticket.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (onlyRequesterUserId && ticket.requesterUserId !== onlyRequesterUserId) {
      throw new Error("Ticket no encontrado")
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
    const like = `%${escapeLikePattern(filters.search.trim())}%`
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

/**
 * Conteo de tickets por estado, ignorando a propósito el filtro de estado.
 * Las pastillas de la lista deben mostrar el total de cada estado; calcularlas
 * sobre las filas ya filtradas dejaba en blanco todas las pastillas menos la
 * activa. El resto de los filtros (faena, prioridad, categoría, alcance) sí se
 * respeta para que los contadores describan el conjunto que el usuario ve.
 */
export async function countTicketsByStatus(
  filters: Omit<TicketListFilters, "status">,
): Promise<Record<string, number>> {
  const conditions: SQL[] = []
  if (filters.priority) conditions.push(eq(itTickets.priority, filters.priority))
  if (filters.category) conditions.push(eq(itTickets.category, filters.category))
  if (filters.worksiteId) conditions.push(eq(itTickets.worksiteId, filters.worksiteId))
  if (filters.workerId) conditions.push(eq(itTickets.workerId, filters.workerId))
  if (filters.assetId) conditions.push(eq(itTickets.assetId, filters.assetId))
  if (filters.assigneeUserId) conditions.push(eq(itTickets.assigneeUserId, filters.assigneeUserId))
  if (filters.requesterUserId) conditions.push(eq(itTickets.requesterUserId, filters.requesterUserId))
  if (filters.scope) conditions.push(filters.scope)
  if (filters.search) {
    const like = `%${escapeLikePattern(filters.search.trim())}%`
    conditions.push(sql`(${itTickets.code} ILIKE ${like} OR ${itTickets.subject} ILIKE ${like} OR ${itTickets.description} ILIKE ${like})`)
  }

  const rows = await db
    .select({ status: itTickets.status, total: sql<number>`count(*)::int` })
    .from(itTickets)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(itTickets.status)

  return Object.fromEntries(rows.map((row) => [row.status, row.total]))
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
