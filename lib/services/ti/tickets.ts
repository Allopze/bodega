import { eq, and, or, isNull, inArray, asc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itTickets, itTicketComments, itAssets, workers, worksites, users, auditLog, statusHistory,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { codeYear, escapeLikePattern } from "@/lib/utils"
import { IT_TICKET_UNASSIGN, itTicketNextStatuses } from "@/lib/validation/ti"
import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"
import {
  computeTicketDueAt, TICKET_SLA_WARNING_HOURS, DEFAULT_TICKET_ORDER, type TicketOrder,
} from "./ticket-sla"


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
      // TIT-001: la prioridad no gobernaba ningún plazo. El compromiso se fija
      // al crear —igual que en Soporte— para que el contador exista desde el
      // primer minuto y no dependa de que alguien mire la lista.
      dueAt: computeTicketDueAt(input.priority),
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

    /*
     * TIT-002 (auditoría 2026-09-14), patrón P6: se podía resolver o cerrar un
     * ticket sin una palabra sobre qué se hizo. El historial de soporte pierde
     * ahí el dato más útil para el siguiente incidente idéntico, y el resto de
     * la plataforma exige motivo para cerrar o anular casi cualquier cosa.
     *
     * Al resolver, la solución es el rastro. Al cerrar, se acepta la que ya
     * traía el ticket —cerrar después de resolver no obliga a repetirla—; lo
     * que no se admite es llegar a cerrado sin solución por ninguna vía.
     */
    if (input.status === "resuelto" && !isValidReason(input.resolution)) {
      throw new Error(reasonRequiredMessage("cómo se resolvió el ticket"))
    }
    if (input.status === "cerrado" && !isValidReason(input.resolution ?? ticket.resolution)) {
      throw new Error(reasonRequiredMessage("cómo se resolvió el ticket"))
    }

    const now = new Date().toISOString()
    const reopening = input.status === "en_progreso" && ["resuelto", "cerrado"].includes(ticket.status)
    const finalResolution = input.status === "resuelto" || input.status === "cerrado"
      ? (input.resolution?.trim() || ticket.resolution)
      : reopening ? null : ticket.resolution
    await tx.update(itTickets).set({
      status: input.status,
      assigneeUserId,
      // Un cierre directo (sin pasar por «resuelto») también es el momento en
      // que se terminó el trabajo: sin esta fecha la ficha no puede decir si
      // se cumplió el plazo.
      resolvedAt: input.status === "resuelto" ? now
        : input.status === "cerrado" ? (ticket.resolvedAt ?? now)
        : reopening ? null : ticket.resolvedAt,
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
    if (ticket.assigneeUserId !== assigneeUserId) {
      await recordAssignment(tx, ticket, assigneeUserId, actor, input.reason)
    }

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

type TicketTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Deja constancia de quién quedó a cargo del ticket. `status_history` solo
 * guarda cambios de estado, así que la asignación vive en la bitácora; la
 * línea de tiempo de la ficha la lee de ahí (`newState.evento`).
 */
async function recordAssignment(
  tx: TicketTx,
  ticket: { id: string; code: string; worksiteId: string; assigneeUserId: string | null },
  assigneeUserId: string | null,
  actor: { userId: string; userEmail?: string },
  reason: string | undefined,
): Promise<void> {
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail,
    action: "update",
    entityType: "it_ticket",
    entityId: ticket.id,
    entityCode: ticket.code,
    oldState: { assigneeUserId: ticket.assigneeUserId },
    newState: { evento: "asignacion", assigneeUserId },
    reason,
    worksiteId: ticket.worksiteId,
  }, tx)
}

export interface AssignTicketInput {
  ticketId: string
  /** Un id de usuario, o `IT_TICKET_UNASSIGN` para dejar el ticket sin responsable. */
  assigneeUserId: string
  reason?: string | null
}

/**
 * Asigna o reasigna el responsable sin tocar el estado de trabajo (TIUX-17).
 *
 * Antes la única vía era una transición de estado, que además arrastraba el
 * asignado vigente en cada envío. Aquí la asignación es el acto completo y
 * explícito (regla TI-08: nunca reasignar en silencio): quien llega a un
 * ticket que ya tiene otro responsable debe decir por qué.
 *
 * Único efecto sobre el estado: un ticket «nuevo» pasa a «asignado» al tener
 * dueño, y uno «asignado» vuelve a «nuevo» si se queda sin él — «asignado» sin
 * responsable es un estado que el servidor no admite.
 */
export async function assignTicket(
  input: AssignTicketInput,
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
    if (ticket.status === "resuelto" || ticket.status === "cerrado") {
      throw new Error("Reabre el ticket antes de cambiar su responsable")
    }

    let assigneeUserId: string | null = null
    if (input.assigneeUserId !== IT_TICKET_UNASSIGN) {
      const [assignee] = await tx.select({ id: users.id, isActive: users.isActive })
        .from(users).where(eq(users.id, input.assigneeUserId))
      if (!assignee) throw new Error("El técnico seleccionado no existe")
      if (!assignee.isActive) throw new Error("El técnico seleccionado está inactivo")
      assigneeUserId = assignee.id
    }
    if (assigneeUserId === ticket.assigneeUserId) {
      throw new Error(assigneeUserId ? "El ticket ya está asignado a esa persona" : "El ticket ya no tiene responsable")
    }

    const reason = input.reason?.trim() || undefined
    // Quitarle el ticket a quien lo tiene (o tomarlo en su lugar) exige
    // explicación; asignar uno que nadie tenía, no.
    if (ticket.assigneeUserId && (!reason || reason.length < 3)) {
      throw new Error("Indica el motivo del cambio de responsable (mínimo 3 caracteres)")
    }

    const toStatus = assigneeUserId && ticket.status === "nuevo" ? "asignado"
      : !assigneeUserId && ticket.status === "asignado" ? "nuevo"
      : ticket.status
    await tx.update(itTickets).set({
      assigneeUserId,
      status: toStatus,
      updatedAt: new Date().toISOString(),
    }).where(eq(itTickets.id, input.ticketId))

    if (toStatus !== ticket.status) {
      await recordStatusChange({
        entityType: "it_ticket",
        entityId: ticket.id,
        fromStatus: ticket.status,
        toStatus,
        changedBy: actor.userId,
        reason: reason ?? (assigneeUserId ? "Ticket asignado" : "Ticket sin responsable"),
      }, tx)
      await recordAudit({
        userId: actor.userId,
        userEmail: actor.userEmail,
        action: "status_change",
        entityType: "it_ticket",
        entityId: ticket.id,
        entityCode: ticket.code,
        oldState: { status: ticket.status },
        newState: { status: toStatus },
        reason,
      }, tx)
    }
    await recordAssignment(tx, ticket, assigneeUserId, actor, reason)

    return {
      id: ticket.id, code: ticket.code, subject: ticket.subject, priority: ticket.priority,
      worksiteId: ticket.worksiteId, requesterUserId: ticket.requesterUserId, assetId: ticket.assetId,
      fromStatus: ticket.status, toStatus, statusChanged: toStatus !== ticket.status,
      previousAssigneeUserId: ticket.assigneeUserId, assigneeUserId,
      assigneeChanged: true,
      resolution: ticket.resolution,
    }
  })
}

/** Lo que la action necesita para avisar al solicitante sin releer el ticket. */
export interface TicketCommentResult {
  id: string
  ticketId: string
  code: string
  subject: string
  requesterUserId: string
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
): Promise<TicketCommentResult> {
  const id = nanoid()
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select({
      id: itTickets.id,
      code: itTickets.code,
      subject: itTickets.subject,
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
    return {
      id, ticketId: ticket.id, code: ticket.code, subject: ticket.subject,
      requesterUserId: ticket.requesterUserId,
    }
  })
}

export interface TicketListFilters {
  status?: string
  priority?: string
  category?: string
  worksiteId?: string
  workerId?: string
  assetId?: string
  assigneeUserId?: string
  /** Solo tickets sin responsable (`?asignado=sin_asignar`). */
  unassigned?: boolean
  /** Vencidos o por vencer (24 h); solo mira tickets abiertos. */
  due?: "vencido" | "por_vencer"
  requesterUserId?: string
  scope?: SQL
  search?: string
}

/**
 * Condiciones comunes a la lista y a los contadores. `skipStatus` es para las
 * pastillas: deben contar cada estado respetando todos los demás filtros.
 */
function ticketConditions(filters: TicketListFilters, skipStatus = false): SQL[] {
  const conditions: SQL[] = []
  if (!skipStatus && filters.status) conditions.push(eq(itTickets.status, filters.status))
  if (filters.priority) conditions.push(eq(itTickets.priority, filters.priority))
  if (filters.category) conditions.push(eq(itTickets.category, filters.category))
  if (filters.worksiteId) conditions.push(eq(itTickets.worksiteId, filters.worksiteId))
  if (filters.workerId) conditions.push(eq(itTickets.workerId, filters.workerId))
  if (filters.assetId) conditions.push(eq(itTickets.assetId, filters.assetId))
  if (filters.assigneeUserId) conditions.push(eq(itTickets.assigneeUserId, filters.assigneeUserId))
  if (filters.unassigned) conditions.push(isNull(itTickets.assigneeUserId))
  if (filters.requesterUserId) conditions.push(eq(itTickets.requesterUserId, filters.requesterUserId))
  if (filters.scope) conditions.push(filters.scope)
  if (filters.due) {
    const now = new Date()
    const nowIso = now.toISOString()
    const warnIso = new Date(now.getTime() + TICKET_SLA_WARNING_HOURS * 3_600_000).toISOString()
    conditions.push(inArray(itTickets.status, OPEN_STATUSES))
    conditions.push(filters.due === "vencido"
      ? sql`${itTickets.dueAt} < ${nowIso}::timestamptz`
      : sql`${itTickets.dueAt} >= ${nowIso}::timestamptz AND ${itTickets.dueAt} <= ${warnIso}::timestamptz`)
  }
  const term = filters.search?.trim()
  if (term) {
    const like = `%${escapeLikePattern(term)}%`
    // Mismos campos que filtraba el buscador en memoria (código, asunto,
    // trabajador, faena, técnico, solicitante, activo) más la descripción: al
    // buscar en el servidor no se puede perder ninguno.
    conditions.push(or(
      sql`${itTickets.code} ILIKE ${like}`,
      sql`${itTickets.subject} ILIKE ${like}`,
      sql`${itTickets.description} ILIKE ${like}`,
      sql`concat(${workers.firstName}, ' ', ${workers.lastName}) ILIKE ${like}`,
      sql`${worksites.name} ILIKE ${like}`,
      sql`${itAssets.code} ILIKE ${like}`,
      sql`(SELECT u.name FROM ${users} u WHERE u.id = ${itTickets.assigneeUserId}) ILIKE ${like}`,
      sql`(SELECT u.name FROM ${users} u WHERE u.id = ${itTickets.requesterUserId}) ILIKE ${like}`,
    ) as SQL)
  }
  return conditions
}

function ticketOrderBy(order: TicketOrder): SQL[] {
  const now = new Date()
  const nowIso = now.toISOString()
  const warnIso = new Date(now.getTime() + TICKET_SLA_WARNING_HOURS * 3_600_000).toISOString()
  // Resueltos y cerrados siempre al final: no hay nada que atender en ellos.
  const closedLast = sql`CASE WHEN ${itTickets.status} IN ('resuelto', 'cerrado') THEN 1 ELSE 0 END`
  const stage = sql`CASE
    WHEN ${itTickets.dueAt} IS NULL THEN 2
    WHEN ${itTickets.dueAt} < ${nowIso}::timestamptz THEN 0
    WHEN ${itTickets.dueAt} <= ${warnIso}::timestamptz THEN 1
    ELSE 2 END`
  const priorityRank = sql`CASE ${itTickets.priority} WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`
  const dueFirst = sql`${itTickets.dueAt} ASC NULLS LAST`
  // `id` desempata: sin él, dos filas iguales pueden repetirse o saltarse entre páginas.
  switch (order) {
    case "vence": return [closedLast, dueFirst, priorityRank, sql`${itTickets.createdAt} DESC`, sql`${itTickets.id}`]
    case "prioridad": return [closedLast, priorityRank, dueFirst, sql`${itTickets.createdAt} DESC`, sql`${itTickets.id}`]
    case "actualizado": return [sql`${itTickets.updatedAt} DESC`, sql`${itTickets.id}`]
    case "creado": return [sql`${itTickets.createdAt} DESC`, sql`${itTickets.id}`]
    default: return [closedLast, stage, priorityRank, dueFirst, sql`${itTickets.createdAt} DESC`, sql`${itTickets.id}`]
  }
}

export async function listTickets(
  filters: TicketListFilters,
  page?: { limit: number; offset: number },
  order: TicketOrder = DEFAULT_TICKET_ORDER,
) {
  const conditions = ticketConditions(filters)
  const query = db
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
      dueAt: itTickets.dueAt,
      createdAt: itTickets.createdAt,
      updatedAt: itTickets.updatedAt,
      resolvedAt: itTickets.resolvedAt,
    })
    .from(itTickets)
    .leftJoin(workers, eq(itTickets.workerId, workers.id))
    .innerJoin(worksites, eq(itTickets.worksiteId, worksites.id))
    .leftJoin(itAssets, eq(itTickets.assetId, itAssets.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...ticketOrderBy(order))
  return page ? query.limit(page.limit).offset(page.offset) : query
}

/** Total de filas que devuelve `listTickets` con estos filtros (para paginar en el servidor). */
export async function countTickets(filters: TicketListFilters): Promise<number> {
  const conditions = ticketConditions(filters)
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(itTickets)
    .leftJoin(workers, eq(itTickets.workerId, workers.id))
    .innerJoin(worksites, eq(itTickets.worksiteId, worksites.id))
    .leftJoin(itAssets, eq(itTickets.assetId, itAssets.id))
    .where(conditions.length ? and(...conditions) : undefined)
  return row?.total ?? 0
}

/**
 * Conteo de tickets por estado, ignorando a propósito el filtro de estado.
 * Las pastillas de la lista deben mostrar el total de cada estado; calcularlas
 * sobre las filas ya filtradas dejaba en blanco todas las pastillas menos la
 * activa. El resto de los filtros (faena, prioridad, categoría, alcance,
 * búsqueda) sí se respeta para que los contadores describan el conjunto que el
 * usuario ve.
 */
export async function countTicketsByStatus(
  filters: Omit<TicketListFilters, "status">,
): Promise<Record<string, number>> {
  const conditions = ticketConditions(filters, true)
  const rows = await db
    .select({ status: itTickets.status, total: sql<number>`count(*)::int` })
    .from(itTickets)
    .leftJoin(workers, eq(itTickets.workerId, workers.id))
    .innerJoin(worksites, eq(itTickets.worksiteId, worksites.id))
    .leftJoin(itAssets, eq(itTickets.assetId, itAssets.id))
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
      dueAt: itTickets.dueAt,
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

export type TicketTimelineItem =
  | { kind: "comment"; id: string; at: string; authorName: string | null; body: string; isInternal: boolean }
  | {
      kind: "status"; id: string; at: string; authorName: string | null
      from: string | null; to: string; reason: string | null
      /** Asignación hecha en el mismo acto (misma transacción), para no repetir la línea. */
      assignment?: { assigneeName: string | null }
    }
  | { kind: "assignment"; id: string; at: string; authorName: string | null; assigneeName: string | null; reason: string | null }

/**
 * Una sola línea de tiempo con lo que le pasó al ticket: comentarios, cambios
 * de estado y asignaciones, en orden cronológico (TIUX-40).
 *
 * `includeInternal` gobierna sólo las notas internas. El *motivo* de cada cambio
 * de estado o de responsable lo ve todo el que ve el ticket: a quien reportó
 * el problema le dice por qué está esperando («Falta el número de serie») o
 * quién lo toma. Lo que TI no quiere mostrarle va en una nota interna, que es
 * para eso (decisión del 2026-10-05). La resolución va aparte en la ficha.
 *
 * Una asignación hecha junto con un cambio de estado comparte instante con él
 * (misma transacción, mismo `now()`), y se funde en una sola línea.
 */
export async function getTicketTimeline(ticketId: string, includeInternal: boolean): Promise<TicketTimelineItem[]> {
  const [comments, statuses, assignments] = await Promise.all([
    db.select({
      id: itTicketComments.id,
      body: itTicketComments.body,
      isInternal: itTicketComments.isInternal,
      authorName: users.name,
      at: itTicketComments.createdAt,
    })
      .from(itTicketComments)
      .leftJoin(users, eq(itTicketComments.authorUserId, users.id))
      .where(includeInternal
        ? eq(itTicketComments.ticketId, ticketId)
        : and(eq(itTicketComments.ticketId, ticketId), eq(itTicketComments.isInternal, false))),
    db.select({
      id: statusHistory.id,
      from: statusHistory.fromStatus,
      to: statusHistory.toStatus,
      reason: statusHistory.reason,
      authorName: users.name,
      at: statusHistory.changedAt,
    })
      .from(statusHistory)
      .leftJoin(users, eq(statusHistory.changedBy, users.id))
      .where(and(eq(statusHistory.entityType, "it_ticket"), eq(statusHistory.entityId, ticketId))),
    db.select({
      id: auditLog.id,
      newState: auditLog.newState,
      reason: auditLog.reason,
      authorName: users.name,
      at: auditLog.createdAt,
    })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(and(
        eq(auditLog.entityType, "it_ticket"),
        eq(auditLog.entityId, ticketId),
        eq(auditLog.action, "update"),
      )),
  ])

  const parsed = assignments.flatMap((row) => {
    try {
      const state = JSON.parse(row.newState ?? "{}") as { evento?: string; assigneeUserId?: string | null }
      return state.evento === "asignacion"
        ? [{ ...row, assigneeUserId: state.assigneeUserId ?? null }]
        : []
    } catch { return [] }
  })
  const assigneeIds = [...new Set(parsed.map((row) => row.assigneeUserId).filter((id): id is string => Boolean(id)))]
  const assigneeNames = new Map<string, string | null>()
  if (assigneeIds.length > 0) {
    const named = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, assigneeIds))
    for (const row of named) assigneeNames.set(row.id, row.name)
  }
  const nameOf = (id: string | null) => (id ? assigneeNames.get(id) ?? null : null)

  const items: TicketTimelineItem[] = [
    ...comments.map((c) => ({ kind: "comment" as const, id: c.id, at: c.at, authorName: c.authorName, body: c.body, isInternal: c.isInternal })),
    ...statuses.map((s) => ({
      kind: "status" as const, id: s.id, at: s.at, authorName: s.authorName,
      from: s.from, to: s.to, reason: s.reason,
    })),
  ]
  for (const row of parsed) {
    const sameInstant = items.find((item) => item.kind === "status" && item.at === row.at && !item.assignment)
    if (sameInstant && sameInstant.kind === "status") {
      sameInstant.assignment = { assigneeName: nameOf(row.assigneeUserId) }
      continue
    }
    items.push({
      kind: "assignment", id: row.id, at: row.at, authorName: row.authorName,
      assigneeName: nameOf(row.assigneeUserId), reason: row.reason,
    })
  }
  return items.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}

export function isTicketOpen(status: string): boolean {
  return OPEN_STATUSES.includes(status)
}
