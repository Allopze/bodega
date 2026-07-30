/**
 * Cola operacional transversal.
 *
 * Este servicio es la única proyección común de trabajo para dashboard,
 * /pendientes y badges. Cada adaptador filtra por permiso y faena antes de
 * serializar una fila; no hay una lista completa enviada al navegador.
 */
import type { Session } from "next-auth"
import { and, count, eq, inArray, isNotNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  pdtpActionPlan,
  pdtpExecutions,
  pdtpObligations,
  ppaSubmissions,
  preventionCapaActions,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  products,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  suppliers,
  sstDocuments,
  sstEvaluations,
  sstScheduledFollowups,
  users,
  workItemAssignments,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { approvalQueueFilter, TERMINAL_REQUEST_STATUSES } from "@/lib/approvals-queue"
import { resolveWorksiteScope, type WorksiteScope } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"
import { sentry } from "@/lib/sentry"
import {
  DELIVERY_ITEM_STATUSES,
  DIRECT_FAENA_RECEIVABLE_STATUSES,
  FAENA_RECEIVABLE_STATUSES,
  OFFICE_RECEIVABLE_STATUSES,
  requestStatusLabel,
  type WorkPriority,
} from "@/lib/work-queue"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

export type OperationalModule =
  | "solicitudes"
  | "aprobaciones"
  | "compras"
  | "recepciones"
  | "entregas"
  | "pdtp"
  | "capa"
  | "inspecciones"
  | "documentacion"
  | "ppa"
  | "sst"

export type OperationalQuickFilter = "all" | "critical" | "overdue" | "today" | "blocked" | "unassigned" | "mine"
export type OperationalSort = "priority" | "due" | "oldest" | "newest"

export interface OperationalAssignee {
  userId: string
  name: string
  source: "assignment" | "native"
}

export interface OperationalWorkItem {
  /** Estable para cursores y React; no depende de agrupaciones por faena. */
  id: string
  sourceType: string
  sourceId: string
  actionKey: string
  module: OperationalModule
  code?: string
  title: string
  subtitle: string
  worksiteId: string
  worksiteName: string
  status: string
  statusLabel: string
  priority: WorkPriority
  blocked: boolean
  createdAt: string
  sourceDueAt: string | null
  committedDueAt: string | null
  effectiveDueAt: string | null
  dueSource: "origin" | "commitment" | null
  assignee: OperationalAssignee | null
  href: string
  ctaLabel: string
  /** La asignación complementaria está disponible sólo para etapas compatibles. */
  assignable: boolean
}

/** Estado mínimo de una asignación complementaria para una etapa estable. */
export interface OperationalWorkItemAssignment {
  assigneeUserId: string | null
  assigneeName: string | null
  committedDueAt: string | null
}

export type OperationalWorkItemBase = Omit<
  OperationalWorkItem,
  "id" | "committedDueAt" | "effectiveDueAt" | "dueSource" | "assignee"
>

export interface OperationalQueueFilters {
  q?: string
  module?: OperationalModule | "all"
  worksiteId?: string | "all"
  status?: string | "all"
  priority?: WorkPriority | "all"
  responsible?: string | "all"
  quick?: OperationalQuickFilter
  sort?: OperationalSort
  cursor?: string
  limit?: number
}

export interface OperationalQueueResult {
  items: OperationalWorkItem[]
  total: number
  /**
   * Conteos por filtro rápido, calculados ignorando el chip activo para que cada
   * chip anuncie lo que entregaría al pulsarlo.
   */
  summary: {
    all: number
    critical: number
    overdue: number
    today: number
    blocked: number
    unassigned: number
    mine: number
    moduleCounts: Partial<Record<OperationalModule, number>>
  }
  filterOptions: {
    modules: OperationalModule[]
    worksites: Array<{ id: string; name: string }>
    statuses: Array<{ value: string; label: string }>
    responsible: Array<{ id: string; name: string }>
  }
  nextCursor: string | null
  sourceErrors: Array<{ module: OperationalModule | "operaciones"; message: string }>
  refreshedAt: string
}

/** Fuentes de abastecimiento que tienen una vista de detalle propia. */
export type OperationalDetailSource =
  | { sourceType: "purchase_request"; sourceId: string }
  | { sourceType: "purchase_order"; sourceId: string }

function emptySummary(): OperationalQueueResult["summary"] {
  return { all: 0, critical: 0, overdue: 0, today: 0, blocked: 0, unassigned: 0, mine: 0, moduleCounts: {} }
}

function emptyFilterOptions(): OperationalQueueResult["filterOptions"] {
  return { modules: [], worksites: [], statuses: [], responsible: [] }
}

function hasPermission(session: Session, permission: string) {
  return session.user.permissions.includes(permission)
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

function normalizePriority(value: string | null | undefined): WorkPriority {
  if (value === "critical" || value === "alta") return "critical"
  if (value === "high") return "high"
  if (value === "medium" || value === "media") return "normal"
  if (value === "low" || value === "baja") return "low"
  return "normal"
}

function startOfChileDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now)
}

function effectiveDue(sourceDueAt: string | null, committedDueAt: string | null): { effectiveDueAt: string | null; dueSource: "origin" | "commitment" | null } {
  if (!sourceDueAt && !committedDueAt) return { effectiveDueAt: null, dueSource: null }
  if (!sourceDueAt) return { effectiveDueAt: committedDueAt, dueSource: "commitment" as const }
  if (!committedDueAt) return { effectiveDueAt: sourceDueAt, dueSource: "origin" as const }
  return sourceDueAt <= committedDueAt
    ? { effectiveDueAt: sourceDueAt, dueSource: "origin" as const }
    : { effectiveDueAt: committedDueAt, dueSource: "commitment" as const }
}

export function operationalAssignmentKey(sourceType: string, sourceId: string, actionKey: string) {
  return `${sourceType}:${sourceId}:${actionKey}`
}

function itemId(sourceType: string, sourceId: string, actionKey: string) {
  return operationalAssignmentKey(sourceType, sourceId, actionKey)
}

/** Construye la misma proyección que usa la cola para mostrar una etapa en su origen. */
export function buildOperationalWorkItem(
  base: OperationalWorkItemBase,
  assignment?: OperationalWorkItemAssignment | null,
): OperationalWorkItem {
  const dates = effectiveDue(base.sourceDueAt, assignment?.committedDueAt ?? null)
  return {
    ...base,
    id: itemId(base.sourceType, base.sourceId, base.actionKey),
    committedDueAt: assignment?.committedDueAt ?? null,
    ...dates,
    assignee: assignment?.assigneeUserId && assignment.assigneeName
      ? { userId: assignment.assigneeUserId, name: assignment.assigneeName, source: "assignment" }
      : null,
  }
}

/**
 * Lee una única etapa desde su entidad origen. Evita reconstruir la cola
 * transversal cuando un detalle sólo necesita mostrar su asignación vigente.
 */
export async function getOperationalDetailWorkItem(
  session: Session,
  source: OperationalDetailSource,
): Promise<OperationalWorkItem | null> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return null

  if (source.sourceType === "purchase_request") {
    const canViewOwn = hasPermission(session, "requests:view_own")
    const canViewAll = hasPermission(session, "requests:view_all")
    if (!canViewOwn && !canViewAll) return null

    const [request] = await db
      .select({
        id: purchaseRequests.id,
        code: purchaseRequests.code,
        requesterId: purchaseRequests.requesterId,
        worksiteId: purchaseRequests.worksiteId,
        worksiteName: worksites.name,
        status: purchaseRequests.status,
        urgency: purchaseRequests.urgency,
        requiredDate: purchaseRequests.requiredDate,
        createdAt: purchaseRequests.createdAt,
        submittedAt: purchaseRequests.submittedAt,
      })
      .from(purchaseRequests)
      .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
      .where(and(
        eq(purchaseRequests.id, source.sourceId),
        scopeCondition(scope, purchaseRequests.worksiteId),
        inArray(purchaseRequests.status, ["draft", "submitted", "in_review", "partially_approved", "approved", "returned", "in_purchasing"]),
      ))
      .limit(1)

    if (!request || (!canViewAll && request.requesterId !== session.user.id)) return null
    const actionKey = request.status === "draft" || request.status === "returned" ? "complete" : "follow_up"
    const assignment = await getAssignmentForSource({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      actionKey,
      worksiteId: request.worksiteId,
    })
    return buildOperationalWorkItem({
      sourceType: "purchase_request",
      sourceId: request.id,
      actionKey,
      module: "solicitudes",
      code: request.code,
      title: request.code,
      subtitle: request.worksiteName,
      worksiteId: request.worksiteId,
      worksiteName: request.worksiteName,
      status: request.status,
      statusLabel: requestStatusLabel(request.status),
      priority: normalizePriority(request.urgency),
      blocked: request.status === "returned",
      createdAt: request.submittedAt ?? request.createdAt,
      sourceDueAt: request.requiredDate ?? null,
      href: `/solicitudes/${request.id}`,
      ctaLabel: actionKey === "complete" ? "Completar solicitud" : "Revisar solicitud",
      assignable: true,
    }, assignment)
  }

  const [order] = await db
    .select({
      id: purchaseOrders.id,
      code: purchaseOrders.code,
      worksiteId: purchaseOrders.worksiteId,
      worksiteName: worksites.name,
      status: purchaseOrders.status,
      deliveryMode: purchaseOrders.deliveryMode,
      estimatedDelivery: purchaseOrders.estimatedDelivery,
      createdAt: purchaseOrders.createdAt,
      issuedAt: purchaseOrders.issuedAt,
      sentAt: purchaseOrders.sentAt,
    })
    .from(purchaseOrders)
    .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
    .where(and(
      eq(purchaseOrders.id, source.sourceId),
      scopeCondition(scope, purchaseOrders.worksiteId),
    ))
    .limit(1)

  if (!order) return null
  const stage = order.status === "draft" && hasPermission(session, "purchasing:create_order")
    ? { actionKey: "issue" as const, module: "compras" as const, statusLabel: "OC en borrador", title: `Emitir ${order.code}`, ctaLabel: "Emitir orden de compra", createdAt: order.createdAt }
    : order.status === "issued" && hasPermission(session, "purchasing:send_order")
      ? { actionKey: "send" as const, module: "compras" as const, statusLabel: "OC emitida", title: `Enviar ${order.code}`, ctaLabel: "Enviar al proveedor", createdAt: order.issuedAt ?? order.createdAt }
      : OFFICE_RECEIVABLE_STATUSES.has(order.status) && order.deliveryMode !== "directo_faena" && hasPermission(session, "receiving:register_office")
        ? { actionKey: "receive_office" as const, module: "recepciones" as const, statusLabel: "Recepción en oficina", title: `Registrar llegada de ${order.code}`, ctaLabel: "Registrar llegada", createdAt: order.sentAt ?? order.createdAt }
        : ((order.deliveryMode === "directo_faena" ? DIRECT_FAENA_RECEIVABLE_STATUSES.has(order.status) : FAENA_RECEIVABLE_STATUSES.has(order.status)) && hasPermission(session, "receiving:register_faena"))
          ? { actionKey: "receive_worksite" as const, module: "recepciones" as const, statusLabel: "Pendiente de faena", title: `Recibir ${order.code} en faena`, ctaLabel: "Registrar recepción", createdAt: order.sentAt ?? order.createdAt }
          : null

  if (!stage) return null
  const assignment = await getAssignmentForSource({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    actionKey: stage.actionKey,
    worksiteId: order.worksiteId,
  })
  return buildOperationalWorkItem({
    sourceType: "purchase_order",
    sourceId: order.id,
    actionKey: stage.actionKey,
    module: stage.module,
    code: order.code,
    title: stage.title,
    subtitle: order.worksiteName,
    worksiteId: order.worksiteId,
    worksiteName: order.worksiteName,
    status: order.status,
    statusLabel: stage.statusLabel,
    priority: "normal",
    blocked: false,
    createdAt: stage.createdAt,
    sourceDueAt: order.estimatedDelivery ?? null,
    href: `/compras/${order.id}`,
    ctaLabel: stage.ctaLabel,
    assignable: true,
  }, assignment)
}

async function getAssignmentForSource(reference: OperationalDetailSource & { actionKey: string; worksiteId: string }): Promise<OperationalWorkItemAssignment | null> {
  const [row] = await db
    .select({
      assigneeUserId: workItemAssignments.assigneeUserId,
      assigneeName: users.name,
      committedDueAt: workItemAssignments.committedDueAt,
    })
    .from(workItemAssignments)
    .leftJoin(users, eq(workItemAssignments.assigneeUserId, users.id))
    .where(and(
      eq(workItemAssignments.sourceType, reference.sourceType),
      eq(workItemAssignments.sourceId, reference.sourceId),
      eq(workItemAssignments.actionKey, reference.actionKey),
      eq(workItemAssignments.worksiteId, reference.worksiteId),
    ))
    .limit(1)
  return row ?? null
}

const PRIORITY_RANK: Record<WorkPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 }

function compareItems(left: OperationalWorkItem, right: OperationalWorkItem, sort: OperationalSort) {
  if (sort === "priority") {
    const rank = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
    if (rank !== 0) return rank
    const leftDue = left.effectiveDueAt ?? "9999-12-31"
    const rightDue = right.effectiveDueAt ?? "9999-12-31"
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue)
  }
  if (sort === "due") {
    const leftDue = left.effectiveDueAt ?? "9999-12-31"
    const rightDue = right.effectiveDueAt ?? "9999-12-31"
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue)
  }
  const compareCreated = left.createdAt.localeCompare(right.createdAt)
  if (sort === "newest") return -compareCreated || left.id.localeCompare(right.id)
  return compareCreated || left.id.localeCompare(right.id)
}

function sortItems(items: OperationalWorkItem[], sort: OperationalSort) {
  return [...items].sort((left, right) => compareItems(left, right, sort))
}

type QueueCursor = Pick<OperationalWorkItem, "id" | "priority" | "effectiveDueAt" | "createdAt"> & {
  version: 1
  sort: OperationalSort
}

function decodeCursor(cursor: string | undefined): QueueCursor | null {
  if (!cursor) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (!parsed || typeof parsed !== "object") return null
    const value = parsed as Partial<QueueCursor>
    if (
      value.version !== 1
      || !value.id
      || !value.priority
      || !value.createdAt
      || !value.sort
      || !["priority", "due", "oldest", "newest"].includes(value.sort)
    ) return null
    return {
      version: 1,
      id: value.id,
      priority: value.priority,
      effectiveDueAt: value.effectiveDueAt ?? null,
      createdAt: value.createdAt,
      sort: value.sort,
    } as QueueCursor
  } catch { return null }
}

function encodeCursor(item: OperationalWorkItem, sort: OperationalSort) {
  const value: QueueCursor = {
    version: 1,
    sort,
    id: item.id,
    priority: item.priority,
    effectiveDueAt: item.effectiveDueAt,
    createdAt: item.createdAt,
  }
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function compareItemToCursor(item: OperationalWorkItem, cursor: QueueCursor, sort: OperationalSort) {
  // Reconstituimos sólo las claves que participan en el orden, conservando el
  // resto del ítem como soporte de tipo. No dependemos de que el registro de la
  // página previa siga presente en una nueva consulta.
  const cursorItem: OperationalWorkItem = {
    ...item,
    id: cursor.id,
    priority: cursor.priority,
    effectiveDueAt: cursor.effectiveDueAt,
    createdAt: cursor.createdAt,
  }
  return compareItems(item, cursorItem, sort)
}

/** Página estable para una lista ya autorizada y ordenada en servidor. */
export function paginateOperationalWorkItems(
  items: OperationalWorkItem[],
  input: Pick<OperationalQueueFilters, "cursor" | "limit" | "sort">,
) {
  const sort = input.sort ?? "priority"
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const sorted = sortItems(items, sort)
  const cursor = decodeCursor(input.cursor)
  // El cursor conserva las claves de orden, por lo que sigue funcionando si
  // la tarea de la página anterior se resuelve entre dos navegaciones.
  const afterCursor = cursor?.sort === sort
    ? sorted.filter((item) => compareItemToCursor(item, cursor, sort) > 0)
    : sorted
  const page = afterCursor.slice(0, limit)
  return {
    items: page,
    nextCursor: page.length < afterCursor.length ? encodeCursor(page.at(-1)!, sort) : null,
  }
}

/**
 * Proyección SQL única de las etapas operacionales. El `UNION ALL` mantiene la
 * autorización y la faena dentro de cada fuente, para que filtros, conteos y
 * cursor se ejecuten antes de transferir filas al proceso de Next.
 */
export type OperationalSourceBranch = {
  module: OperationalModule
  query: SQL
}

/**
 * Cada fuente conserva su identidad para poder diagnosticar una caída aislada.
 * En la ruta normal se vuelven a unir en una única consulta global; las probes
 * individuales sólo se ejecutan si esa consulta falla.
 */
function operationalSourceBranches(session: Session, scope: WorksiteScope): OperationalSourceBranch[] {
  const inScope = (column: AnyPgColumn) => scopeCondition(scope, column) ?? sql`true`
  const branches: OperationalSourceBranch[] = []
  const add = (module: OperationalModule, query: SQL) => branches.push({ module, query })
  const emptyAssignee = sql`NULL::text`

  const canViewRequests = hasPermission(session, "requests:view_own") || hasPermission(session, "requests:view_all")
  if (canViewRequests) {
    const requesterCondition = hasPermission(session, "requests:view_all")
      ? sql`true`
      : sql`${purchaseRequests.requesterId} = ${session.user.id}`
    // Un solo fragmento reutilizado: el subtítulo necesita el conteo para el
    // número y otra vez para concordar el plural ("1 ítem" / "2 ítems").
    const itemCount = sql`(SELECT COUNT(*) FROM ${purchaseRequestItems} WHERE ${purchaseRequestItems.requestId} = ${purchaseRequests.id})`
    add("solicitudes", sql`
      SELECT 'purchase_request'::text AS source_type, ${purchaseRequests.id} AS source_id,
        CASE WHEN ${purchaseRequests.status} IN ('draft', 'returned') THEN 'complete' ELSE 'follow_up' END AS action_key,
        'solicitudes'::text AS module, ${purchaseRequests.code} AS code, ${purchaseRequests.code} AS title,
        CONCAT(${worksites.name}, ' · ', ${itemCount}, ' ítem', CASE WHEN ${itemCount} = 1 THEN '' ELSE 's' END) AS subtitle,
        ${purchaseRequests.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name,
        ${purchaseRequests.status} AS status,
        CASE ${purchaseRequests.status}
          WHEN 'draft' THEN 'Borrador' WHEN 'submitted' THEN 'Enviada' WHEN 'in_review' THEN 'En revisión'
          WHEN 'partially_approved' THEN 'Parcialmente aprobada' WHEN 'approved' THEN 'Aprobada'
          WHEN 'returned' THEN 'Devuelta' WHEN 'in_purchasing' THEN 'En compra' ELSE ${purchaseRequests.status} END AS status_label,
        CASE ${purchaseRequests.urgency} WHEN 'critical' THEN 'critical' WHEN 'high' THEN 'high' ELSE 'normal' END AS priority,
        (${purchaseRequests.status} = 'returned') AS blocked,
        COALESCE(${purchaseRequests.submittedAt}, ${purchaseRequests.createdAt}::text) AS created_at,
        LEFT(${purchaseRequests.requiredDate}::text, 10) AS source_due_at,
        ${emptyAssignee} AS native_assignee_user_id, ${emptyAssignee} AS native_assignee_name,
        CONCAT('/solicitudes/', ${purchaseRequests.id}) AS href,
        CASE WHEN ${purchaseRequests.status} IN ('draft', 'returned') THEN 'Completar solicitud' ELSE 'Revisar solicitud' END AS cta_label,
        true AS assignable
      FROM ${purchaseRequests}
      INNER JOIN ${worksites} ON ${worksites.id} = ${purchaseRequests.worksiteId}
      WHERE ${inScope(purchaseRequests.worksiteId)}
        AND ${requesterCondition}
        AND ${purchaseRequests.status} IN ('draft', 'submitted', 'in_review', 'partially_approved', 'approved', 'returned', 'in_purchasing')
    `)
  }

  const itemTitle = sql`COALESCE(${products.name}, ${purchaseRequestItems.productNameFree}, 'Ítem solicitado')`
  const itemPriority = sql`CASE COALESCE(${purchaseRequestItems.urgency}, ${purchaseRequests.urgency}) WHEN 'critical' THEN 'critical' WHEN 'high' THEN 'high' ELSE 'normal' END`
  const itemDue = sql`COALESCE(${purchaseRequestItems.requiredDate}, ${purchaseRequests.requiredDate})`
  // Una solicitud terminal (rechazada, cerrada o anulada) no genera trabajo
  // pendiente, por más que a alguno de sus ítems le haya quedado un estado
  // intermedio. Sin esta guarda la cola pedía "Entregar …" sobre una solicitud
  // ya cerrada (auditoría UI/UX 2026-07-29, A-13). Va en la base compartida
  // para que valga por igual en aprobaciones, compras y entregas.
  const itemBase = sql`
    FROM ${purchaseRequestItems}
    INNER JOIN ${purchaseRequests} ON ${purchaseRequests.id} = ${purchaseRequestItems.requestId}
    INNER JOIN ${worksites} ON ${worksites.id} = ${purchaseRequests.worksiteId}
    LEFT JOIN ${products} ON ${products.id} = ${purchaseRequestItems.productId}
    WHERE ${inScope(purchaseRequests.worksiteId)}
      AND ${notInArray(purchaseRequests.status, [...TERMINAL_REQUEST_STATUSES])}
  `

  // El predicado canónico de la cola de aprobaciones, el mismo que usan el badge
  // del rail y la página `/aprobaciones`. Sin él esta fuente ofrecía tareas que
  // la página descarta —repuestos y servicios se aprueban por cotizaciones, y la
  // solicitud debe estar enviada— y el CTA aterrizaba en una pantalla vacía
  // (auditoría UI/UX 2026-07-29, A-03). La faena la resuelve `inScope`, así que
  // el scope va neutro.
  const approvalScope = { isGlobal: true, worksiteIds: [] as string[] }

  if (hasPermission(session, "approvals:approve")) add("aprobaciones", sql`
    SELECT 'purchase_request_item'::text AS source_type, ${purchaseRequestItems.id} AS source_id, 'approve'::text AS action_key,
      'aprobaciones'::text AS module, ${purchaseRequests.code} AS code, CONCAT('Aprobar ', ${itemTitle}) AS title,
      CONCAT(${purchaseRequests.code}, ' · ', ${worksites.name}) AS subtitle, ${purchaseRequests.worksiteId} AS worksite_id,
      ${worksites.name} AS worksite_name, ${purchaseRequestItems.status} AS status, 'Necesita aprobación'::text AS status_label,
      ${itemPriority} AS priority, false AS blocked, ${purchaseRequestItems.createdAt}::text AS created_at, LEFT((${itemDue})::text, 10) AS source_due_at,
      ${emptyAssignee} AS native_assignee_user_id, ${emptyAssignee} AS native_assignee_name,
      CONCAT('/aprobaciones?solicitud=', ${purchaseRequests.id}) AS href, 'Aprobar o devolver'::text AS cta_label, true AS assignable
    ${itemBase} AND ${purchaseRequestItems.status} = 'requested'
      AND ${approvalQueueFilter(approvalScope)}
  `)

  if (hasPermission(session, "purchasing:create_order")) add("compras", sql`
    SELECT 'purchase_request_item'::text AS source_type, ${purchaseRequestItems.id} AS source_id, 'create_order'::text AS action_key,
      'compras'::text AS module, ${purchaseRequests.code} AS code, CONCAT('Comprar ', ${itemTitle}) AS title,
      CONCAT(${purchaseRequests.code}, ' · ', ${worksites.name}) AS subtitle, ${purchaseRequests.worksiteId} AS worksite_id,
      ${worksites.name} AS worksite_name, ${purchaseRequestItems.status} AS status, 'Listo para comprar'::text AS status_label,
      ${itemPriority} AS priority, false AS blocked, ${purchaseRequestItems.createdAt}::text AS created_at, LEFT((${itemDue})::text, 10) AS source_due_at,
      ${emptyAssignee} AS native_assignee_user_id, ${emptyAssignee} AS native_assignee_name,
      CONCAT('/compras/nueva?faena=', ${purchaseRequests.worksiteId}, '&item=', ${purchaseRequestItems.id}) AS href, 'Crear orden de compra'::text AS cta_label, true AS assignable
    ${itemBase} AND ${purchaseRequestItems.status} IN ('approved', 'pending_purchase')
  `)

  if (hasPermission(session, "deliveries:create")) add("entregas", sql`
    SELECT 'purchase_request_item'::text AS source_type, ${purchaseRequestItems.id} AS source_id, 'deliver'::text AS action_key,
      'entregas'::text AS module, ${purchaseRequests.code} AS code, CONCAT('Entregar ', ${itemTitle}) AS title,
      CONCAT(${purchaseRequests.code}, ' · ', ${worksites.name}) AS subtitle, ${purchaseRequests.worksiteId} AS worksite_id,
      ${worksites.name} AS worksite_name, ${purchaseRequestItems.status} AS status,
      CASE ${purchaseRequestItems.status}
        WHEN 'partially_received' THEN 'Recibido parcial'
        WHEN 'received' THEN 'Recibido, por entregar'
        WHEN 'partially_delivered' THEN 'Entrega parcial'
        ELSE ${purchaseRequestItems.status} END AS status_label, ${itemPriority} AS priority, false AS blocked,
      ${purchaseRequestItems.createdAt}::text AS created_at, LEFT((${itemDue})::text, 10) AS source_due_at,
      ${emptyAssignee} AS native_assignee_user_id, ${emptyAssignee} AS native_assignee_name,
      CONCAT('/entregas?faena=', ${purchaseRequests.worksiteId}, '&item=', ${purchaseRequestItems.id}) AS href,
      'Registrar entrega'::text AS cta_label, true AS assignable
    ${itemBase} AND ${purchaseRequestItems.status} IN ('partially_received', 'received', 'partially_delivered')
      AND EXISTS (
        SELECT 1 FROM ${worksiteStock}
        WHERE ${worksiteStock.productId} = ${purchaseRequestItems.productId}
          AND ${worksiteStock.worksiteId} = ${purchaseRequests.worksiteId}
          AND ${worksiteStock.quantity} > 0
      )
  `)

  const orderBase = sql`
    FROM ${purchaseOrders}
    INNER JOIN ${worksites} ON ${worksites.id} = ${purchaseOrders.worksiteId}
    INNER JOIN ${suppliers} ON ${suppliers.id} = ${purchaseOrders.supplierId}
    WHERE ${inScope(purchaseOrders.worksiteId)}
  `
  const orderFields = (actionKey: string, module: OperationalModule, title: SQL, statusLabel: string, href: SQL, ctaLabel: string, createdAt: SQL): SQL => sql`
    'purchase_order'::text AS source_type, ${purchaseOrders.id} AS source_id, ${actionKey}::text AS action_key,
    ${module}::text AS module, ${purchaseOrders.code} AS code, ${title} AS title,
    CONCAT(${worksites.name}, ' · ', ${suppliers.name}) AS subtitle, ${purchaseOrders.worksiteId} AS worksite_id,
    ${worksites.name} AS worksite_name, ${purchaseOrders.status} AS status, ${statusLabel}::text AS status_label,
    'normal'::text AS priority, false AS blocked, ${createdAt} AS created_at, LEFT(${purchaseOrders.estimatedDelivery}::text, 10) AS source_due_at,
    ${emptyAssignee} AS native_assignee_user_id, ${emptyAssignee} AS native_assignee_name,
    ${href} AS href, ${ctaLabel}::text AS cta_label, true AS assignable
  `
  if (hasPermission(session, "purchasing:create_order")) add("compras", sql`
    SELECT ${orderFields('issue', 'compras', sql`CONCAT('Emitir ', ${purchaseOrders.code})`, 'OC en borrador', sql`CONCAT('/compras/', ${purchaseOrders.id})`, 'Emitir orden de compra', sql`${purchaseOrders.createdAt}::text`)}
    ${orderBase} AND ${purchaseOrders.status} = 'draft'
  `)
  if (hasPermission(session, "purchasing:send_order")) add("compras", sql`
    SELECT ${orderFields('send', 'compras', sql`CONCAT('Enviar ', ${purchaseOrders.code})`, 'OC emitida', sql`CONCAT('/compras/', ${purchaseOrders.id})`, 'Enviar al proveedor', sql`COALESCE(${purchaseOrders.issuedAt}, ${purchaseOrders.createdAt}::text)`)}
    ${orderBase} AND ${purchaseOrders.status} = 'issued'
  `)
  if (hasPermission(session, "receiving:register_office")) add("recepciones", sql`
    SELECT ${orderFields('receive_office', 'recepciones', sql`CONCAT('Registrar llegada de ', ${purchaseOrders.code})`, 'Recepción en oficina', sql`CONCAT('/recepcion/nueva?oc=', ${purchaseOrders.id})`, 'Registrar llegada', sql`COALESCE(${purchaseOrders.sentAt}, ${purchaseOrders.createdAt}::text)`)}
    ${orderBase} AND ${purchaseOrders.deliveryMode} <> 'directo_faena'
      AND ${purchaseOrders.status} IN ('sent', 'partially_office_received')
  `)
  if (hasPermission(session, "receiving:register_faena")) add("recepciones", sql`
    SELECT ${orderFields('receive_worksite', 'recepciones', sql`CONCAT('Recibir ', ${purchaseOrders.code}, ' en faena')`, 'Pendiente de faena', sql`CONCAT('/recepcion/nueva?oc=', ${purchaseOrders.id})`, 'Registrar recepción', sql`COALESCE(${purchaseOrders.sentAt}, ${purchaseOrders.createdAt}::text)`)}
    ${orderBase} AND (
      (${purchaseOrders.deliveryMode} = 'directo_faena' AND ${purchaseOrders.status} IN ('sent', 'partially_received'))
      OR (${purchaseOrders.deliveryMode} <> 'directo_faena' AND ${purchaseOrders.status} IN ('partially_office_received', 'office_received', 'partially_received'))
    )
  `)

  if (hasPermission(session, "prevention:pdtp:view")) {
    add("pdtp", sql`
      SELECT 'pdtp_obligation'::text AS source_type, ${pdtpObligations.id} AS source_id, 'execute'::text AS action_key,
        'pdtp'::text AS module, NULL::text AS code, 'Cumplir obligación PDTP'::text AS title, ${worksites.name} AS subtitle,
        ${pdtpObligations.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name, ${pdtpObligations.status} AS status,
        CASE WHEN ${pdtpObligations.status} = 'overdue' THEN 'Vencida' ELSE 'Pendiente' END AS status_label,
        CASE WHEN ${pdtpObligations.status} = 'overdue' THEN 'high' ELSE 'normal' END AS priority, false AS blocked,
        ${pdtpObligations.createdAt}::text AS created_at, LEFT(${pdtpObligations.dueAt}::text, 10) AS source_due_at,
        ${emptyAssignee} AS native_assignee_user_id, ${emptyAssignee} AS native_assignee_name,
        '/prevencion/pdtp/obligaciones'::text AS href, 'Registrar cumplimiento'::text AS cta_label, false AS assignable
      FROM ${pdtpObligations}
      INNER JOIN ${worksites} ON ${worksites.id} = ${pdtpObligations.worksiteId}
      WHERE ${inScope(pdtpObligations.worksiteId)} AND ${pdtpObligations.status} IN ('pending', 'overdue', 'reported')
    `)
    add("pdtp", sql`
      SELECT 'pdtp_action'::text AS source_type, ${pdtpActionPlan.id} AS source_id, 'advance'::text AS action_key,
        'pdtp'::text AS module, NULL::text AS code, 'Acción correctiva PDTP'::text AS title, ${worksites.name} AS subtitle,
        ${pdtpExecutions.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name, ${pdtpActionPlan.estado} AS status,
        REPLACE(${pdtpActionPlan.estado}, '_', ' ') AS status_label,
        CASE ${pdtpActionPlan.prioridad} WHEN 'alta' THEN 'critical' WHEN 'high' THEN 'high' WHEN 'baja' THEN 'low' ELSE 'normal' END AS priority,
        (${pdtpActionPlan.estado} = 'reabierto') AS blocked, ${pdtpActionPlan.createdAt}::text AS created_at, LEFT(${pdtpActionPlan.plazo}::text, 10) AS source_due_at,
        ${pdtpActionPlan.responsableUserId} AS native_assignee_user_id,
        (SELECT ${users.name} FROM ${users} WHERE ${users.id} = ${pdtpActionPlan.responsableUserId} LIMIT 1) AS native_assignee_name,
        '/prevencion/pdtp/acciones'::text AS href, 'Abrir acción'::text AS cta_label, false AS assignable
      FROM ${pdtpActionPlan}
      INNER JOIN ${pdtpExecutions} ON ${pdtpExecutions.id} = ${pdtpActionPlan.executionId}
      INNER JOIN ${worksites} ON ${worksites.id} = ${pdtpExecutions.worksiteId}
      WHERE ${inScope(pdtpExecutions.worksiteId)} AND ${pdtpActionPlan.estado} IN ('pendiente', 'en_proceso', 'reabierto')
    `)
  }

  if (hasPermission(session, "prevention:capa:view")) add("capa", sql`
    SELECT 'capa'::text AS source_type, ${preventionCapaActions.id} AS source_id, 'advance'::text AS action_key,
      'capa'::text AS module, ${preventionCapaActions.code} AS code, CONCAT('Gestionar ', ${preventionCapaActions.code}) AS title,
      ${worksites.name} AS subtitle, ${preventionCapaActions.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name,
      ${preventionCapaActions.status} AS status, REPLACE(${preventionCapaActions.status}, '_', ' ') AS status_label,
      CASE ${preventionCapaActions.priority} WHEN 'critical' THEN 'critical' WHEN 'high' THEN 'high' WHEN 'alta' THEN 'critical' WHEN 'low' THEN 'low' WHEN 'baja' THEN 'low' ELSE 'normal' END AS priority,
      (${preventionCapaActions.reconciliationStatus} <> 'reconciled') AS blocked, ${preventionCapaActions.createdAt}::text AS created_at,
      LEFT(${preventionCapaActions.targetDate}::text, 10) AS source_due_at, ${preventionCapaActions.responsibleUserId} AS native_assignee_user_id,
      (SELECT ${users.name} FROM ${users} WHERE ${users.id} = ${preventionCapaActions.responsibleUserId} LIMIT 1) AS native_assignee_name,
      CONCAT('/prevencion/capa/', ${preventionCapaActions.id}) AS href, 'Abrir CAPA'::text AS cta_label, false AS assignable
    FROM ${preventionCapaActions}
    INNER JOIN ${worksites} ON ${worksites.id} = ${preventionCapaActions.worksiteId}
    WHERE ${inScope(preventionCapaActions.worksiteId)} AND ${preventionCapaActions.status} IN ('pending', 'in_progress', 'pending_verification', 'reopened')
  `)

  if (hasPermission(session, "prevention:inspections:view")) add("inspecciones", sql`
    SELECT 'inspection'::text AS source_type, ${preventionInspectionRuns.id} AS source_id,
      CASE WHEN ${preventionInspectionRuns.status} = 'completed' THEN 'review' ELSE 'execute' END AS action_key,
      'inspecciones'::text AS module, ${preventionInspectionRuns.code} AS code,
      CASE WHEN ${preventionInspectionRuns.status} = 'completed' THEN CONCAT('Revisar ', ${preventionInspectionTemplates.name}) ELSE CONCAT('Ejecutar ', ${preventionInspectionTemplates.name}) END AS title,
      ${worksites.name} AS subtitle, ${preventionInspectionRuns.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name,
      ${preventionInspectionRuns.status} AS status,
      CASE ${preventionInspectionRuns.status} WHEN 'planned' THEN 'Planificada' WHEN 'completed' THEN 'Pendiente de revisión' ELSE 'En proceso' END AS status_label,
      'normal'::text AS priority, false AS blocked, ${preventionInspectionRuns.createdAt}::text AS created_at,
      LEFT(${preventionInspectionRuns.scheduledFor}::text, 10) AS source_due_at, ${preventionInspectionRuns.assignedToUserId} AS native_assignee_user_id,
      (SELECT ${users.name} FROM ${users} WHERE ${users.id} = ${preventionInspectionRuns.assignedToUserId} LIMIT 1) AS native_assignee_name,
      CONCAT('/prevencion/inspecciones/', ${preventionInspectionRuns.id}) AS href,
      CASE WHEN ${preventionInspectionRuns.status} = 'completed' THEN 'Revisar inspección' ELSE 'Abrir inspección' END AS cta_label, false AS assignable
    FROM ${preventionInspectionRuns}
    INNER JOIN ${worksites} ON ${worksites.id} = ${preventionInspectionRuns.worksiteId}
    INNER JOIN ${preventionInspectionTemplates} ON ${preventionInspectionTemplates.id} = ${preventionInspectionRuns.templateId}
    WHERE ${inScope(preventionInspectionRuns.worksiteId)} AND ${preventionInspectionRuns.status} IN ('planned', 'in_progress', 'completed')
  `)

  if (hasPermission(session, "prevention:docs:view")) add("documentacion", sql`
    SELECT 'sst_document'::text AS source_type, ${sstDocuments.id} AS source_id,
      CASE WHEN ${sstDocuments.status} = 'en_revision' THEN 'review' ELSE 'renew' END AS action_key,
      'documentacion'::text AS module, ${sstDocuments.internalCode} AS code, ${sstDocuments.title} AS title,
      ${worksites.name} AS subtitle, ${sstDocuments.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name,
      ${sstDocuments.status} AS status,
      CASE WHEN ${sstDocuments.status} = 'vencido' THEN 'Documento vencido' ELSE REPLACE(${sstDocuments.status}, '_', ' ') END AS status_label,
      CASE WHEN ${sstDocuments.status} = 'vencido' THEN 'high' ELSE 'normal' END AS priority,
      (${sstDocuments.status} = 'observado') AS blocked, ${sstDocuments.createdAt}::text AS created_at, LEFT(${sstDocuments.expiresAt}::text, 10) AS source_due_at,
      ${sstDocuments.responsibleUserId} AS native_assignee_user_id,
      (SELECT ${users.name} FROM ${users} WHERE ${users.id} = ${sstDocuments.responsibleUserId} LIMIT 1) AS native_assignee_name,
      CONCAT('/prevencion/documentacion/', ${sstDocuments.id}) AS href,
      CASE WHEN ${sstDocuments.status} = 'en_revision' THEN 'Revisar documento' ELSE 'Abrir documento' END AS cta_label, false AS assignable
    FROM ${sstDocuments}
    INNER JOIN ${worksites} ON ${worksites.id} = ${sstDocuments.worksiteId}
    WHERE ${inScope(sstDocuments.worksiteId)} AND ${sstDocuments.confidentiality} = 'publico_interno' AND ${sstDocuments.dataClass} = 'operational'
      AND (${sstDocuments.status} IN ('en_revision', 'observado', 'vencido') OR (${sstDocuments.expiresAt} IS NOT NULL AND ${sstDocuments.expiresAt} <= ${startOfChileDay()}))
  `)

  if (hasPermission(session, "ppa:view")) add("ppa", sql`
    SELECT 'ppa'::text AS source_type, ${ppaSubmissions.id} AS source_id, 'review'::text AS action_key,
      'ppa'::text AS module, NULL::text AS code, 'Caso PPA requiere revisión'::text AS title, ${worksites.name} AS subtitle,
      ${ppaSubmissions.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name, ${ppaSubmissions.estado} AS status,
      CASE WHEN ${ppaSubmissions.estado} = 'detenido' THEN 'Trabajo detenido' ELSE REPLACE(${ppaSubmissions.estado}, '_', ' ') END AS status_label,
      CASE WHEN ${ppaSubmissions.esCritica} THEN 'critical' ELSE 'high' END AS priority,
      (${ppaSubmissions.estado} = 'detenido') AS blocked, ${ppaSubmissions.createdAt}::text AS created_at, NULL::text AS source_due_at,
      ${emptyAssignee} AS native_assignee_user_id, ${emptyAssignee} AS native_assignee_name,
      CONCAT('/prevencion/ppa/', ${ppaSubmissions.id}) AS href, 'Revisar caso PPA'::text AS cta_label, false AS assignable
    FROM ${ppaSubmissions}
    INNER JOIN ${worksites} ON ${worksites.id} = ${ppaSubmissions.worksiteId}
    WHERE ${inScope(ppaSubmissions.worksiteId)} AND ${ppaSubmissions.estado} IN ('detenido', 'en_correccion', 'pendiente_verificacion')
  `)

  if (hasPermission(session, "sst:view")) add("sst", sql`
    SELECT 'sst_followup'::text AS source_type, ${sstScheduledFollowups.id} AS source_id, 'complete'::text AS action_key,
      'sst'::text AS module, NULL::text AS code, 'Seguimiento SST pendiente'::text AS title, ${worksites.name} AS subtitle,
      ${sstEvaluations.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name, 'pending'::text AS status,
      CONCAT('Pendiente · ', REPLACE(${sstScheduledFollowups.instancia}, '_', ' ')) AS status_label,
      'normal'::text AS priority, false AS blocked, ${sstEvaluations.createdAt}::text AS created_at, LEFT(${sstScheduledFollowups.fechaProgramada}::text, 10) AS source_due_at,
      ${emptyAssignee} AS native_assignee_user_id, ${emptyAssignee} AS native_assignee_name,
      '/prevencion/evaluaciones'::text AS href, 'Registrar seguimiento'::text AS cta_label, false AS assignable
    FROM ${sstScheduledFollowups}
    INNER JOIN ${sstEvaluations} ON ${sstEvaluations.id} = ${sstScheduledFollowups.evaluationId}
    INNER JOIN ${worksites} ON ${worksites.id} = ${sstEvaluations.worksiteId}
    WHERE ${inScope(sstEvaluations.worksiteId)} AND ${sstScheduledFollowups.realizado} = false
      AND ${sstScheduledFollowups.fechaProgramada} <= ${startOfChileDay()}
  `)

  return branches
}

function unionOperationalSourceBranches(branches: OperationalSourceBranch[]): SQL {
  return branches.length > 0 ? sql.join(branches.map((branch) => branch.query), sql` UNION ALL `) : sql`
    SELECT NULL::text AS source_type, NULL::text AS source_id, NULL::text AS action_key, NULL::text AS module,
      NULL::text AS code, NULL::text AS title, NULL::text AS subtitle, NULL::text AS worksite_id, NULL::text AS worksite_name,
      NULL::text AS status, NULL::text AS status_label, NULL::text AS priority, false AS blocked, NULL::text AS created_at,
      NULL::text AS source_due_at, NULL::text AS native_assignee_user_id, NULL::text AS native_assignee_name,
      NULL::text AS href, NULL::text AS cta_label, false AS assignable WHERE false
  `
}

export async function probeOperationalSourceBranches(
  branches: OperationalSourceBranch[],
  execute: (query: SQL) => Promise<unknown> = (query) => db.execute(query),
) {
  const probes = await Promise.all(branches.map(async (branch) => {
    try {
      await execute(sql`SELECT 1 FROM (${branch.query}) AS operational_source_probe LIMIT 1`)
      return { branch, error: null as unknown }
    } catch (error) {
      return { branch, error }
    }
  }))
  const failingModules = [...new Set(probes.filter((probe) => probe.error).map((probe) => probe.branch.module))]
  return {
    healthy: probes.filter((probe) => !probe.error).map((probe) => probe.branch),
    sourceErrors: failingModules.map((module) => ({
      module,
      message: `No fue posible cargar las tareas de ${module}. El resto de la cola permanece disponible.`,
    })),
  }
}

function priorityRank(priority: WorkPriority) {
  return PRIORITY_RANK[priority]
}

function queueOrderSql(sort: OperationalSort): SQL {
  if (sort === "due") return sql`due_sort ASC, created_at ASC, id ASC`
  if (sort === "newest") return sql`created_at DESC, id ASC`
  if (sort === "oldest") return sql`created_at ASC, id ASC`
  return sql`priority_rank ASC, due_sort ASC, created_at ASC, id ASC`
}

function queueCursorSql(cursor: QueueCursor | null, sort: OperationalSort): SQL {
  if (!cursor || cursor.sort !== sort) return sql`true`
  const due = cursor.effectiveDueAt ?? "9999-12-31"
  if (sort === "due") return sql`
    (due_sort > ${due} OR (due_sort = ${due} AND (created_at > ${cursor.createdAt} OR (created_at = ${cursor.createdAt} AND id > ${cursor.id}))))
  `
  if (sort === "newest") return sql`(created_at < ${cursor.createdAt} OR (created_at = ${cursor.createdAt} AND id > ${cursor.id}))`
  if (sort === "oldest") return sql`(created_at > ${cursor.createdAt} OR (created_at = ${cursor.createdAt} AND id > ${cursor.id}))`
  const rank = priorityRank(cursor.priority)
  return sql`
    (priority_rank > ${rank}
      OR (priority_rank = ${rank} AND (due_sort > ${due}
        OR (due_sort = ${due} AND (created_at > ${cursor.createdAt}
          OR (created_at = ${cursor.createdAt} AND id > ${cursor.id}))))))
  `
}

/**
 * Predicado de un filtro rápido. Vive aparte de `queueFilterSql` porque los
 * contadores de los chips se calculan sobre el conjunto que ignora el chip
 * activo: si se contaran sobre el resultado final, "Vencidas" mostraría su
 * propio total al estar activo y un subconjunto al estar activo otro chip
 * (auditoría UI/UX 2026-07-29, A-05).
 */
function quickFilterSql(quick: OperationalQuickFilter, session: Session): SQL | null {
  switch (quick) {
    case "mine":       return sql`assignee_user_id = ${session.user.id}`
    case "unassigned": return sql`assignee_user_id IS NULL`
    case "critical":   return sql`priority = 'critical'`
    case "blocked":    return sql`blocked = true`
    case "overdue":    return sql`effective_due_at IS NOT NULL AND effective_due_at < ${startOfChileDay()}`
    case "today":      return sql`effective_due_at = ${startOfChileDay()}`
    default:           return null
  }
}

/** Filtros explícitos, sin el chip rápido: la base de los contadores. */
function queueScopeFilterSql(filters: OperationalQueueFilters): SQL {
  const clauses: SQL[] = [sql`true`]
  if (filters.module && filters.module !== "all") clauses.push(sql`module = ${filters.module}`)
  if (filters.worksiteId && filters.worksiteId !== "all") clauses.push(sql`worksite_id = ${filters.worksiteId}`)
  if (filters.status && filters.status !== "all") clauses.push(sql`status = ${filters.status}`)
  if (filters.priority && filters.priority !== "all") clauses.push(sql`priority = ${filters.priority}`)
  if (filters.responsible && filters.responsible !== "all") clauses.push(sql`assignee_user_id = ${filters.responsible}`)
  const term = filters.q?.trim()
  if (term) clauses.push(sql`CONCAT_WS(' ', code, title, subtitle, worksite_name, status_label, module, assignee_name) ILIKE ${`%${term}%`}`)
  return sql.join(clauses, sql` AND `)
}

function queueFilterSql(filters: OperationalQueueFilters, session: Session): SQL {
  const quick = filters.quick ? quickFilterSql(filters.quick, session) : null
  return quick
    ? sql.join([queueScopeFilterSql(filters), quick], sql` AND `)
    : queueScopeFilterSql(filters)
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === "string") {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  return value as T
}

type OperationalQueueSqlRow = {
  total: number | string
  all_count: number | string
  critical: number | string
  overdue: number | string
  today: number | string
  blocked: number | string
  unassigned: number | string
  mine: number | string
  module_counts: unknown
  modules: unknown
  worksites: unknown
  statuses: unknown
  responsible: unknown
  items: unknown
}

/** Consulta global keyset: entrega como máximo `limit + 1` filas al servidor. */
async function getOperationalWorkQueuePage(
  session: Session,
  scope: WorksiteScope,
  filters: Required<Pick<OperationalQueueFilters, "quick" | "sort" | "limit">> & OperationalQueueFilters,
  sourceBranches = operationalSourceBranches(session, scope),
): Promise<Omit<OperationalQueueResult, "sourceErrors" | "refreshedAt">> {
  const sources = unionOperationalSourceBranches(sourceBranches)
  const filter = queueFilterSql(filters, session)
  // Los contadores de los chips se cuentan sobre `scoped` (todo menos el chip),
  // así cada chip anuncia lo que entregaría si se lo pulsara.
  const scopeFilter = queueScopeFilterSql(filters)
  const quickCount = (quick: OperationalQuickFilter) => {
    const predicate = quickFilterSql(quick, session)
    return predicate
      ? sql`(SELECT COUNT(*) FILTER (WHERE ${predicate})::int FROM scoped)`
      : sql`(SELECT COUNT(*)::int FROM scoped)`
  }
  const cursor = queueCursorSql(decodeCursor(filters.cursor), filters.sort)
  const order = queueOrderSql(filters.sort)
  const result = await db.execute(sql`
    WITH source_items AS (
      ${sources}
    ), enriched AS (
      SELECT
        source.source_type || ':' || source.source_id || ':' || source.action_key AS id,
        source.source_type, source.source_id, source.action_key, source.module, source.code, source.title, source.subtitle, source.worksite_id, source.worksite_name,
        source.status, source.status_label, source.priority, source.blocked, source.created_at, source.source_due_at, source.href, source.cta_label, source.assignable,
        LEFT(${workItemAssignments.committedDueAt}::text, 10) AS committed_due_at,
        CASE
          WHEN source.source_due_at IS NULL THEN LEFT(${workItemAssignments.committedDueAt}::text, 10)
          WHEN ${workItemAssignments.committedDueAt} IS NULL THEN source.source_due_at
          WHEN source.source_due_at <= LEFT(${workItemAssignments.committedDueAt}::text, 10) THEN source.source_due_at
          ELSE LEFT(${workItemAssignments.committedDueAt}::text, 10)
        END AS effective_due_at,
        CASE
          WHEN source.source_due_at IS NULL AND ${workItemAssignments.committedDueAt} IS NOT NULL THEN 'commitment'
          WHEN source.source_due_at IS NOT NULL AND (${workItemAssignments.committedDueAt} IS NULL OR source.source_due_at <= LEFT(${workItemAssignments.committedDueAt}::text, 10)) THEN 'origin'
          WHEN ${workItemAssignments.committedDueAt} IS NOT NULL THEN 'commitment'
          ELSE NULL
        END AS due_source,
        COALESCE(${workItemAssignments.assigneeUserId}, source.native_assignee_user_id) AS assignee_user_id,
        COALESCE(assigned_user.name, source.native_assignee_name) AS assignee_name,
        CASE WHEN ${workItemAssignments.assigneeUserId} IS NOT NULL THEN 'assignment' WHEN source.native_assignee_user_id IS NOT NULL THEN 'native' ELSE NULL END AS assignee_source,
        CASE source.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END AS priority_rank,
        COALESCE(
          CASE
            WHEN source.source_due_at IS NULL THEN LEFT(${workItemAssignments.committedDueAt}::text, 10)
            WHEN ${workItemAssignments.committedDueAt} IS NULL THEN source.source_due_at
            WHEN source.source_due_at <= LEFT(${workItemAssignments.committedDueAt}::text, 10) THEN source.source_due_at
            ELSE LEFT(${workItemAssignments.committedDueAt}::text, 10)
          END,
          '9999-12-31'
        ) AS due_sort
      FROM source_items AS source
      LEFT JOIN ${workItemAssignments}
        ON ${workItemAssignments.sourceType} = source.source_type
        AND ${workItemAssignments.sourceId} = source.source_id
        AND ${workItemAssignments.actionKey} = source.action_key
        AND ${workItemAssignments.worksiteId} = source.worksite_id
      LEFT JOIN ${users} AS assigned_user ON assigned_user.id = ${workItemAssignments.assigneeUserId}
    ), scoped AS (
      SELECT * FROM enriched WHERE ${scopeFilter}
    ), filtered AS (
      SELECT * FROM enriched WHERE ${filter}
    ), paginated AS (
      SELECT * FROM filtered WHERE ${cursor} ORDER BY ${order} LIMIT ${filters.limit + 1}
    )
    SELECT
      (SELECT COUNT(*)::int FROM filtered) AS total,
      ${quickCount("all")} AS all_count,
      ${quickCount("critical")} AS critical,
      ${quickCount("overdue")} AS overdue,
      ${quickCount("today")} AS today,
      ${quickCount("blocked")} AS blocked,
      ${quickCount("unassigned")} AS unassigned,
      ${quickCount("mine")} AS mine,
      COALESCE((SELECT jsonb_object_agg(module, module_count) FROM (SELECT module, COUNT(*)::int AS module_count FROM filtered GROUP BY module) module_summary), '{}'::jsonb) AS module_counts,
      COALESCE((SELECT jsonb_agg(module ORDER BY module) FROM (SELECT DISTINCT module FROM enriched) module_options), '[]'::jsonb) AS modules,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', worksite_id, 'name', worksite_name) ORDER BY worksite_name) FROM (SELECT DISTINCT worksite_id, worksite_name FROM enriched) worksite_options), '[]'::jsonb) AS worksites,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('value', status, 'label', status_label) ORDER BY status_label) FROM (SELECT DISTINCT status, status_label FROM enriched) status_options), '[]'::jsonb) AS statuses,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', assignee_user_id, 'name', assignee_name) ORDER BY assignee_name) FROM (SELECT DISTINCT assignee_user_id, assignee_name FROM enriched WHERE assignee_user_id IS NOT NULL AND assignee_name IS NOT NULL) responsible_options), '[]'::jsonb) AS responsible,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'sourceType', source_type, 'sourceId', source_id, 'actionKey', action_key, 'module', module,
        'code', code, 'title', title, 'subtitle', subtitle, 'worksiteId', worksite_id, 'worksiteName', worksite_name,
        'status', status, 'statusLabel', status_label, 'priority', priority, 'blocked', blocked, 'createdAt', created_at,
        'sourceDueAt', source_due_at, 'committedDueAt', committed_due_at, 'effectiveDueAt', effective_due_at, 'dueSource', due_source,
        'assignee', CASE WHEN assignee_user_id IS NULL OR assignee_name IS NULL THEN NULL ELSE jsonb_build_object('userId', assignee_user_id, 'name', assignee_name, 'source', assignee_source) END,
        'href', href, 'ctaLabel', cta_label, 'assignable', assignable
      ) ORDER BY ${order}) FROM paginated), '[]'::jsonb) AS items
  `)

  // postgres-js expone el resultado como arreglo; PGlite (usado por la suite
  // de integración) lo envuelve además en `rows`.
  const row = ((result as unknown as { rows?: unknown[] }).rows?.[0] ?? result[0]) as OperationalQueueSqlRow | undefined
  if (!row) return { items: [], total: 0, summary: emptySummary(), filterOptions: emptyFilterOptions(), nextCursor: null }
  const candidates = parseJsonColumn<OperationalWorkItem[]>(row.items, [])
  const items = candidates.slice(0, filters.limit)
  return {
    items,
    total: Number(row.total ?? 0),
    summary: {
      all: Number(row.all_count ?? 0),
      critical: Number(row.critical ?? 0),
      overdue: Number(row.overdue ?? 0),
      today: Number(row.today ?? 0),
      blocked: Number(row.blocked ?? 0),
      unassigned: Number(row.unassigned ?? 0),
      mine: Number(row.mine ?? 0),
      moduleCounts: parseJsonColumn<OperationalQueueResult["summary"]["moduleCounts"]>(row.module_counts, {}),
    },
    filterOptions: {
      modules: parseJsonColumn<OperationalModule[]>(row.modules, []),
      worksites: parseJsonColumn<OperationalQueueResult["filterOptions"]["worksites"]>(row.worksites, []),
      statuses: parseJsonColumn<OperationalQueueResult["filterOptions"]["statuses"]>(row.statuses, []),
      responsible: parseJsonColumn<OperationalQueueResult["filterOptions"]["responsible"]>(row.responsible, []),
    },
    nextCursor: candidates.length > filters.limit && items.length > 0 ? encodeCursor(items.at(-1)!, filters.sort) : null,
  }
}

/** Obtiene una página de trabajo ya autorizada desde la proyección SQL común. */
export async function getOperationalWorkQueue(session: Session, rawFilters: OperationalQueueFilters = {}): Promise<OperationalQueueResult> {
  const scope = resolveWorksiteScope(session)
  const filters: Required<Pick<OperationalQueueFilters, "quick" | "sort" | "limit">> & OperationalQueueFilters = {
    ...rawFilters,
    quick: rawFilters.quick ?? "all",
    sort: rawFilters.sort ?? "priority",
    limit: Math.max(1, Math.min(rawFilters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)),
  }
  if (scope.mode === "none") return { items: [], total: 0, summary: emptySummary(), filterOptions: emptyFilterOptions(), nextCursor: null, sourceErrors: [], refreshedAt: new Date().toISOString() }
  const sourceBranches = operationalSourceBranches(session, scope)
  try {
    const result = await getOperationalWorkQueuePage(session, scope, filters, sourceBranches)
    return { ...result, sourceErrors: [], refreshedAt: new Date().toISOString() }
  } catch (error) {
    logger.warn("Operational queue unified query failed; probing source branches", {
      event: "operational_queue_unified_query_failed",
      sourceCount: sourceBranches.length,
      error: error instanceof Error ? error.message : String(error),
    })
    const recovery = await probeOperationalSourceBranches(sourceBranches)
    if (recovery.sourceErrors.length > 0 && recovery.healthy.length > 0) {
      const failedModules = recovery.sourceErrors.map((entry) => entry.module).join(",")
      logger.warn("Operational queue degraded by source", {
        event: "operational_queue_source_degraded",
        failedModules,
        healthySourceCount: recovery.healthy.length,
      })
      sentry.captureMessage(`Operational queue source degraded: ${failedModules}`, "warning")
      try {
        const result = await getOperationalWorkQueuePage(session, scope, filters, recovery.healthy)
        return { ...result, sourceErrors: recovery.sourceErrors, refreshedAt: new Date().toISOString() }
      } catch (recoveryError) {
        logger.error("Operational queue recovery query failed", {
          event: "operational_queue_recovery_failed",
          healthySourceCount: recovery.healthy.length,
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        })
      }
    }
    return {
      items: [], total: 0, summary: emptySummary(), filterOptions: emptyFilterOptions(), nextCursor: null,
      sourceErrors: [{ module: "operaciones", message: "No fue posible cargar la cola operacional. Intenta actualizar la página." }],
      refreshedAt: new Date().toISOString(),
    }
  }
}

/**
 * Conteo para navegación: mantiene la semántica de las etapas de la cola sin
 * construirlas ni cargar asignaciones. Cada consulta queda limitada a su
 * agregado y una fuente fallida no bloquea el shell completo.
 */
export async function getOperationalWorkCount(session: Session) {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return 0

  const today = startOfChileDay()
  const requestScope = scopeCondition(scope, purchaseRequests.worksiteId)
  const orderScope = scopeCondition(scope, purchaseOrders.worksiteId)
  const pdtpScope = scopeCondition(scope, pdtpObligations.worksiteId)
  const capaScope = scopeCondition(scope, preventionCapaActions.worksiteId)
  const inspectionScope = scopeCondition(scope, preventionInspectionRuns.worksiteId)
  const documentScope = scopeCondition(scope, sstDocuments.worksiteId)
  const ppaScope = scopeCondition(scope, ppaSubmissions.worksiteId)
  const countRows = (query: Promise<Array<{ total: number }>>) => query.then(([row]) => Number(row?.total ?? 0))
  const counts: Array<Promise<number>> = []

  const canViewRequests = hasPermission(session, "requests:view_own") || hasPermission(session, "requests:view_all")
  if (canViewRequests) {
    counts.push(countRows(
      db.select({ total: count() }).from(purchaseRequests).where(and(
        requestScope,
        inArray(purchaseRequests.status, ["draft", "submitted", "in_review", "partially_approved", "approved", "returned", "in_purchasing"]),
        hasPermission(session, "requests:view_all") ? undefined : eq(purchaseRequests.requesterId, session.user.id),
      )),
    ))
  }

  // Mismos criterios que las fuentes de la cola: el badge contaba ítems de
  // solicitudes terminales y de tipos que `/aprobaciones` descarta, así que el
  // rail decía 12 donde la página mostraba 9 (auditoría UI/UX 2026-07-29, A-03).
  const liveRequest = notInArray(purchaseRequests.status, [...TERMINAL_REQUEST_STATUSES])

  if (hasPermission(session, "approvals:approve")) {
    counts.push(countRows(
      db.select({ total: count() })
        .from(purchaseRequestItems)
        .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
        .where(and(
          requestScope,
          liveRequest,
          eq(purchaseRequestItems.status, "requested"),
          approvalQueueFilter({ isGlobal: true, worksiteIds: [] }),
        )),
    ))
  }
  if (hasPermission(session, "purchasing:create_order")) {
    counts.push(countRows(
      db.select({ total: count() })
        .from(purchaseRequestItems)
        .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
        .where(and(requestScope, liveRequest, inArray(purchaseRequestItems.status, ["approved", "pending_purchase"]))),
    ))
    counts.push(countRows(
      db.select({ total: count() }).from(purchaseOrders).where(and(orderScope, eq(purchaseOrders.status, "draft"))),
    ))
  }
  if (hasPermission(session, "deliveries:create")) {
    counts.push(countRows(
      db.select({ total: count() })
        .from(purchaseRequestItems)
        .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
        .where(and(
          requestScope,
          liveRequest,
          inArray(purchaseRequestItems.status, [...DELIVERY_ITEM_STATUSES]),
          isNotNull(purchaseRequestItems.productId),
          sql`EXISTS (
            SELECT 1 FROM ${worksiteStock}
            WHERE ${worksiteStock.worksiteId} = ${purchaseRequests.worksiteId}
              AND ${worksiteStock.productId} = ${purchaseRequestItems.productId}
              AND ${worksiteStock.quantity} > 0
          )`,
        )),
    ))
  }
  if (hasPermission(session, "purchasing:send_order")) {
    counts.push(countRows(
      db.select({ total: count() }).from(purchaseOrders).where(and(orderScope, eq(purchaseOrders.status, "issued"))),
    ))
  }
  if (hasPermission(session, "receiving:register_office")) {
    counts.push(countRows(
      db.select({ total: count() }).from(purchaseOrders).where(and(
        orderScope,
        inArray(purchaseOrders.status, [...OFFICE_RECEIVABLE_STATUSES]),
        sql`${purchaseOrders.deliveryMode} <> 'directo_faena'`,
      )),
    ))
  }
  if (hasPermission(session, "receiving:register_faena")) {
    counts.push(countRows(
      db.select({ total: count() }).from(purchaseOrders).where(and(
        orderScope,
        or(
          and(eq(purchaseOrders.deliveryMode, "directo_faena"), inArray(purchaseOrders.status, [...DIRECT_FAENA_RECEIVABLE_STATUSES])),
          and(sql`${purchaseOrders.deliveryMode} <> 'directo_faena'`, inArray(purchaseOrders.status, [...FAENA_RECEIVABLE_STATUSES])),
        ),
      )),
    ))
  }

  if (hasPermission(session, "prevention:pdtp:view")) {
    counts.push(countRows(
      db.select({ total: count() }).from(pdtpObligations).where(and(
        pdtpScope,
        inArray(pdtpObligations.status, ["pending", "overdue", "reported"]),
      )),
    ))
    counts.push(countRows(
      db.select({ total: count() })
        .from(pdtpActionPlan)
        .innerJoin(pdtpExecutions, eq(pdtpActionPlan.executionId, pdtpExecutions.id))
        .where(and(
          scopeCondition(scope, pdtpExecutions.worksiteId),
          inArray(pdtpActionPlan.estado, ["pendiente", "en_proceso", "reabierto"]),
        )),
    ))
  }
  if (hasPermission(session, "prevention:capa:view")) {
    counts.push(countRows(
      db.select({ total: count() }).from(preventionCapaActions).where(and(
        capaScope,
        inArray(preventionCapaActions.status, ["pending", "in_progress", "pending_verification", "reopened"]),
      )),
    ))
  }
  if (hasPermission(session, "prevention:inspections:view")) {
    counts.push(countRows(
      db.select({ total: count() }).from(preventionInspectionRuns).where(and(
        inspectionScope,
        inArray(preventionInspectionRuns.status, ["planned", "in_progress", "completed"]),
      )),
    ))
  }
  if (hasPermission(session, "prevention:docs:view")) {
    counts.push(countRows(
      db.select({ total: count() }).from(sstDocuments).where(and(
        documentScope,
        eq(sstDocuments.confidentiality, "publico_interno"),
        eq(sstDocuments.dataClass, "operational"),
        or(
          eq(sstDocuments.status, "en_revision"),
          eq(sstDocuments.status, "observado"),
          eq(sstDocuments.status, "vencido"),
          and(isNotNull(sstDocuments.expiresAt), lte(sstDocuments.expiresAt, today)),
        ),
      )),
    ))
  }
  if (hasPermission(session, "ppa:view")) {
    counts.push(countRows(
      db.select({ total: count() }).from(ppaSubmissions).where(and(
        ppaScope,
        inArray(ppaSubmissions.estado, ["detenido", "en_correccion", "pendiente_verificacion"]),
      )),
    ))
  }
  if (hasPermission(session, "sst:view")) {
    counts.push(countRows(
      db.select({ total: count() })
        .from(sstScheduledFollowups)
        .innerJoin(sstEvaluations, eq(sstScheduledFollowups.evaluationId, sstEvaluations.id))
        .where(and(
          scopeCondition(scope, sstEvaluations.worksiteId),
          eq(sstScheduledFollowups.realizado, false),
          lte(sstScheduledFollowups.fechaProgramada, today),
        )),
    ))
  }

  const results = await Promise.allSettled(counts)
  return results.reduce((total, result) => total + (result.status === "fulfilled" ? result.value : 0), 0)
}

export function parseOperationalQueueFilters(input: Record<string, string | string[] | undefined>): OperationalQueueFilters {
  const take = (key: string) => {
    const value = input[key]
    return Array.isArray(value) ? value[0] : value
  }
  const allowedModules: OperationalModule[] = ["solicitudes", "aprobaciones", "compras", "recepciones", "entregas", "pdtp", "capa", "inspecciones", "documentacion", "ppa", "sst"]
  const allowedPriorities: WorkPriority[] = ["critical", "high", "normal", "low"]
  const allowedQuick: OperationalQuickFilter[] = ["all", "critical", "overdue", "today", "blocked", "unassigned", "mine"]
  const allowedSort: OperationalSort[] = ["priority", "due", "oldest", "newest"]
  const moduleParam = take("module")
  const priority = take("priority")
  const quick = take("quick")
  const sort = take("sort")
  return {
    q: take("q")?.slice(0, 160),
    module: moduleParam && allowedModules.includes(moduleParam as OperationalModule) ? moduleParam as OperationalModule : "all",
    worksiteId: take("faena") ?? "all",
    status: take("estado") ?? "all",
    priority: priority && allowedPriorities.includes(priority as WorkPriority) ? priority as WorkPriority : "all",
    responsible: take("responsable") ?? "all",
    quick: quick && allowedQuick.includes(quick as OperationalQuickFilter) ? quick as OperationalQuickFilter : "all",
    sort: sort && allowedSort.includes(sort as OperationalSort) ? sort as OperationalSort : "priority",
    cursor: take("cursor"),
  }
}
