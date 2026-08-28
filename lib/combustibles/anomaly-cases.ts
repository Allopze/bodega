/**
 * Servicio de casos de anomalía (sección 11).
 *
 * Cada caso se crea desde una regla de detección (fuel_anomaly_rules) y referencia
 * opcionalmente un registro fuente (fuel_consumption_records, fuel_tae_submissions,
 * fuel_operation_records, etc.). Los comentarios y cambios de estado se registran
 * con actor y timestamp para trazabilidad completa.
 */

import type { Session } from "next-auth"
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { fuelAnomalyCases, fuelAnomalyComments, fuelAnomalyRules, fuelVehicles, worksites, users } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { AnomalyCaseStatus, AnomalySeverity } from "./anomaly-labels"
import { METER_RESOLUTION_KINDS, requiresMeterResolutionKind, type MeterResolutionKind } from "./anomaly-labels"
import { ANOMALY_RULE_CATALOG } from "./anomaly-rule-catalog"

// Compatibilidad para consumidores server-side que todavía importan el
// vocabulario desde el servicio. Los componentes client-side usan
// `anomaly-labels.ts` directamente para no arrastrar Drizzle/DB al bundle.
export { ANOMALY_SEVERITY_LABELS, ANOMALY_STATUS_COLORS, ANOMALY_STATUS_LABELS, anomalySeverityVariant,
  METER_RESET_RULE_CODES, METER_RESOLUTION_KIND_LABELS, METER_RESOLUTION_KINDS, requiresMeterResolutionKind } from "./anomaly-labels"
export type { MeterResolutionKind } from "./anomaly-labels"
export type { AnomalyCaseStatus, AnomalySeverity } from "./anomaly-labels"

const ANOMALY_CASE_TRANSITIONS: Record<AnomalyCaseStatus, readonly AnomalyCaseStatus[]> = {
  open: ["in_review", "dismissed"],
  in_review: ["resolved", "dismissed"],
  resolved: ["reopened"],
  dismissed: ["reopened"],
  reopened: ["in_review", "dismissed"],
}

export function canTransitionAnomalyCase(from: AnomalyCaseStatus, to: AnomalyCaseStatus) {
  return ANOMALY_CASE_TRANSITIONS[from].includes(to)
}

export interface AnomalyCaseRow {
  id: string
  ruleId: string
  ruleCode: string
  ruleName: string | null
  severity: AnomalySeverity
  worksiteId: string | null
  worksiteName: string | null
  vehicleId: string | null
  vehiclePlate: string | null
  referenceEntityType: string | null
  referenceEntityId: string | null
  description: string
  observedValue: string | null
  expectedValue: string | null
  status: AnomalyCaseStatus
  assigneeId: string | null
  assigneeName: string | null
  resolution: string | null
  resolutionKind: MeterResolutionKind | null
  resolvedById: string | null
  resolvedByName: string | null
  resolvedAt: string | null
  detectedAt: string
  createdAt: string
  updatedAt: string
  comments: AnomalyCommentRow[]
}

export interface AnomalyCommentRow {
  id: string
  userId: string
  userName: string | null
  body: string
  createdAt: string
}

export interface CreateAnomalyCaseInput {
  ruleId: string
  ruleCode: string
  severity?: AnomalySeverity
  worksiteId?: string
  vehicleId?: string
  referenceEntityType?: string
  referenceEntityId?: string
  description: string
  observedValue?: string
  expectedValue?: string
}

export interface AnomalyCasesFilters {
  worksiteId?: string
  status?: AnomalyCaseStatus | AnomalyCaseStatus[]
  severity?: AnomalySeverity
  ruleCode?: string
  assigneeId?: string
  /** Filtrar por el registro fuente exacto (referenceEntityType + referenceEntityId), p. ej. desde "Abrir el caso relacionado" en la bitácora. */
  referenceEntityType?: string
  referenceEntityId?: string
  limit?: number
  offset?: number
}

/**
 * Crear un caso de anomalía. Si ya existe UNO PARA LA MISMA regla+entidad
 * — en cualquier estado, no sólo abierto — no duplica y devuelve el existente
 * con `wasCreated: false`: los detectores contaban como "creado" también el caso
 * deduplicado, así que la bitácora de cada corrida inflaba sus cifras.
 *
 * Deliberado: casi todas las reglas (litros_supera_capacidad, evidencia_*,
 * variacion_brusca_consumo, sello_*, etc.) referencian un registro histórico
 * inmutable (una carga, una evidencia, un período ya cerrado) — su condición
 * nunca vuelve a evaluarse distinto, así que un caso descartado no debe
 * reaparecer en la próxima corrida del cron sólo porque el dato que lo generó
 * sigue ahí. Las reglas que vigilan una condición vigente y pueden repetirse
 * legítimamente (p. ej. `consumo_durante_inactividad`) evitan este problema
 * incluyendo la fecha en `referenceEntityId`, no reabriendo la deduplicación.
 */
export async function createAnomalyCase(input: CreateAnomalyCaseInput): Promise<AnomalyCaseRow & { wasCreated: boolean }> {
  // Verificar duplicado
  if (input.referenceEntityType && input.referenceEntityId) {
    const existing = await db.query.fuelAnomalyCases.findFirst({
      where: and(
        eq(fuelAnomalyCases.ruleCode, input.ruleCode),
        eq(fuelAnomalyCases.referenceEntityType, input.referenceEntityType),
        eq(fuelAnomalyCases.referenceEntityId, input.referenceEntityId),
      ),
    })
    if (existing) return { ...(await enrichAnomalyCase(existing)), wasCreated: false }
  }

  const id = nanoid()
  const now = new Date().toISOString()
  const [record] = await db.insert(fuelAnomalyCases).values({
    id,
    ruleId: input.ruleId,
    ruleCode: input.ruleCode,
    severity: input.severity ?? "medium",
    worksiteId: input.worksiteId ?? null,
    vehicleId: input.vehicleId ?? null,
    referenceEntityType: input.referenceEntityType ?? null,
    referenceEntityId: input.referenceEntityId ?? null,
    description: input.description,
    observedValue: input.observedValue ?? null,
    expectedValue: input.expectedValue ?? null,
    status: "open",
    detectedAt: now,
  }).returning()
  return { ...(await enrichAnomalyCase(record!)), wasCreated: true }
}

/**
 * Obtener casos con filtros, paginados.
 *
 * `session` es obligatorio (aunque sea `null` en pruebas) a propósito: el
 * `worksiteId` del filtro viene de la URL y sólo acota; el techo de permisos lo
 * pone el alcance del rol. Sin este predicado la pantalla listaba los casos de
 * todas las faenas a cualquier usuario con `combustibles:view`.
 */
export async function getAnomalyCases(filters: AnomalyCasesFilters, session: Session | null): Promise<{ cases: AnomalyCaseRow[]; total: number }> {
  const where: SQL[] = []
  const scope = worksiteScopeSql(session, fuelAnomalyCases.worksiteId, filters.worksiteId)
  if (scope) where.push(scope)
  if (filters.status) {
    if (Array.isArray(filters.status)) where.push(inArray(fuelAnomalyCases.status, filters.status))
    else where.push(eq(fuelAnomalyCases.status, filters.status))
  }
  if (filters.severity) where.push(eq(fuelAnomalyCases.severity, filters.severity))
  if (filters.ruleCode) where.push(eq(fuelAnomalyCases.ruleCode, filters.ruleCode))
  if (filters.assigneeId) where.push(eq(fuelAnomalyCases.assigneeId, filters.assigneeId))
  if (filters.referenceEntityType) where.push(eq(fuelAnomalyCases.referenceEntityType, filters.referenceEntityType))
  if (filters.referenceEntityId) where.push(eq(fuelAnomalyCases.referenceEntityId, filters.referenceEntityId))
  const condition = where.length > 0 ? and(...where) : undefined

  const [rows, totalResult] = await Promise.all([
    db.query.fuelAnomalyCases.findMany({
      where: condition,
      orderBy: [desc(fuelAnomalyCases.detectedAt)],
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    }),
    condition
      ? db.select({ count: sql<number>`count(*)::int` }).from(fuelAnomalyCases).where(condition)
      : db.select({ count: sql<number>`count(*)::int` }).from(fuelAnomalyCases),
  ])

  const cases = await enrichAnomalyCases(rows)
  return { cases, total: totalResult[0]?.count ?? 0 }
}

/** Cambiar estado de un caso, con actor y motivo.
 *  Resolver o descartar es una corrección sensible (cierra la investigación de una
 *  posible pérdida de combustible): exige motivo, a diferencia de iniciar revisión o reabrir. */
export async function updateAnomalyCaseStatus(
  session: Session,
  caseId: string,
  expectedStatus: AnomalyCaseStatus,
  status: AnomalyCaseStatus,
  resolution?: string,
  /** Obligatorio al cerrar una regla de medidor; ignorado en el resto. */
  resolutionKind?: MeterResolutionKind,
): Promise<AnomalyCaseRow> {
  const updated = await db.transaction(async (tx) => {
    const scope = worksiteScopeSql(session, fuelAnomalyCases.worksiteId)
    const [current] = await tx.select().from(fuelAnomalyCases)
      .where(and(eq(fuelAnomalyCases.id, caseId), scope))
      .for("update")
      .limit(1)
    if (!current) throw new Error("Caso de anomalía no encontrado")
    if (current.status !== expectedStatus) {
      throw new Error("El caso cambió de estado; actualiza la página antes de continuar")
    }
    if (current.status === status) return current
    if (!canTransitionAnomalyCase(current.status as AnomalyCaseStatus, status)) {
      throw new Error(`No se puede cambiar el caso de ${current.status} a ${status}`)
    }

    const isResolved = status === "resolved" || status === "dismissed"
    if (isResolved && !(resolution ?? "").trim()) {
      throw new Error("Debes indicar el motivo para resolver o descartar un caso")
    }
    // Cerrar un caso de medidor decide si la serie del equipo se corta acá:
    // Flota y Mantenciones tratan como reinicio SÓLO `reset_medidor`. Sin la
    // elección explícita, un error de tipeo corregido cortaría la serie igual.
    const needsKind = isResolved && requiresMeterResolutionKind(current.ruleCode)
    if (needsKind && !METER_RESOLUTION_KINDS.includes(resolutionKind as MeterResolutionKind)) {
      throw new Error("Indica si la lectura se corrigió o si el medidor fue reemplazado")
    }
    const now = new Date().toISOString()
    const resolutionFields = isResolved
      ? { resolution: resolution!.trim(), resolutionKind: needsKind ? resolutionKind! : null, resolvedById: session.user.id, resolvedAt: now }
      : status === "reopened"
        ? { resolution: null, resolutionKind: null, resolvedById: null, resolvedAt: null }
        : {}
    const [next] = await tx.update(fuelAnomalyCases).set({ status, updatedAt: now, ...resolutionFields })
      .where(and(eq(fuelAnomalyCases.id, caseId), eq(fuelAnomalyCases.status, expectedStatus)))
      .returning()
    if (!next) throw new Error("El caso cambió de estado; actualiza la página antes de continuar")

    await recordStatusChange({
      entityType: "fuel_anomaly_case",
      entityId: caseId,
      fromStatus: current.status,
      toStatus: status,
      changedBy: session.user.id,
      reason: resolution?.trim() || undefined,
    }, tx)
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "status_change",
      entityType: "fuel_anomaly_case",
      entityId: caseId,
      oldState: { status: current.status, resolution: current.resolution, resolutionKind: current.resolutionKind },
      newState: { status, resolution: next.resolution, resolutionKind: next.resolutionKind },
      reason: resolution?.trim() || undefined,
    }, tx)
    return next
  })
  return await enrichAnomalyCase(updated)
}

/** Asignar responsable. */
export async function assignAnomalyCase(
  session: Session,
  caseId: string,
  expectedAssigneeId: string | null,
  assigneeId: string | null,
): Promise<AnomalyCaseRow> {
  const updated = await db.transaction(async (tx) => {
    const scope = worksiteScopeSql(session, fuelAnomalyCases.worksiteId)
    const [current] = await tx.select().from(fuelAnomalyCases)
      .where(and(eq(fuelAnomalyCases.id, caseId), scope))
      .for("update")
      .limit(1)
    if (!current) throw new Error("Caso de anomalía no encontrado")
    if (current.assigneeId !== expectedAssigneeId) {
      throw new Error("La asignación cambió; actualiza la página antes de continuar")
    }
    if (current.assigneeId === assigneeId) return current
    const [next] = await tx.update(fuelAnomalyCases)
      .set({ assigneeId, updatedAt: new Date().toISOString() })
      .where(and(
        eq(fuelAnomalyCases.id, caseId),
        expectedAssigneeId === null
          ? sql`${fuelAnomalyCases.assigneeId} IS NULL`
          : eq(fuelAnomalyCases.assigneeId, expectedAssigneeId),
      ))
      .returning()
    if (!next) throw new Error("La asignación cambió; actualiza la página antes de continuar")
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "update",
      entityType: "fuel_anomaly_case",
      entityId: caseId,
      oldState: { assigneeId: current.assigneeId },
      newState: { assigneeId },
      reason: "Asignación de responsable",
    }, tx)
    return next
  })
  return await enrichAnomalyCase(updated)
}

/** Inserción interna para flujos que ya bloquearon y autorizaron el caso. */
export async function addAnomalyCommentWithClient(client: DB | Tx, caseId: string, userId: string, body: string): Promise<AnomalyCommentRow> {
  const normalizedBody = body.trim()
  if (!normalizedBody) throw new Error("El comentario no puede estar vacío")
  if (normalizedBody.length > 2_000) throw new Error("El comentario no puede superar 2000 caracteres")
  const [comment] = await client.insert(fuelAnomalyComments).values({
    id: nanoid(), caseId, userId, body: normalizedBody,
  }).returning()
  const [user] = await client.select({ name: users.name }).from(users).where(eq(users.id, userId))
  return { id: comment!.id, userId, userName: user?.name ?? null, body: comment!.body, createdAt: comment!.createdAt }
}

/** Añadir comentario a un caso visible para la sesión. */
export async function addAnomalyComment(session: Session, caseId: string, body: string): Promise<AnomalyCommentRow> {
  return db.transaction(async (tx) => {
    const scope = worksiteScopeSql(session, fuelAnomalyCases.worksiteId)
    const [current] = await tx.select({ id: fuelAnomalyCases.id }).from(fuelAnomalyCases)
      .where(and(eq(fuelAnomalyCases.id, caseId), scope))
      .for("update")
      .limit(1)
    if (!current) throw new Error("Caso de anomalía no encontrado")
    const comment = await addAnomalyCommentWithClient(tx, caseId, session.user.id, body)
    await recordAudit({
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
      action: "create",
      entityType: "fuel_anomaly_comment",
      entityId: comment.id,
      newState: { caseId, body: comment.body },
    }, tx)
    return comment
  })
}

/** Agregar casos por estado, severidad y código de regla para el gráfico de distribución (sección 5). */
export async function getAnomalyDistribution(filters: Pick<AnomalyCasesFilters, 'worksiteId' | 'status'>, session: Session | null): Promise<{
  byStatus: Array<{ status: string; count: number }>
  bySeverity: Array<{ severity: string; count: number }>
  byRuleCode: Array<{ ruleCode: string; ruleName: string | null; count: number }>
  total: number
}> {
  const where: SQL[] = []
  const scope = worksiteScopeSql(session, fuelAnomalyCases.worksiteId, filters.worksiteId)
  if (scope) where.push(scope)
  if (filters.status) {
    if (Array.isArray(filters.status)) where.push(inArray(fuelAnomalyCases.status, filters.status))
    else where.push(eq(fuelAnomalyCases.status, filters.status))
  }
  const condition = where.length > 0 ? and(...where) : undefined

  const [statusRows, severityRows, ruleRows, totalResult] = await Promise.all([
    db.select({
      status: fuelAnomalyCases.status,
      count: sql<number>`count(*)::int`,
    }).from(fuelAnomalyCases).where(condition).groupBy(fuelAnomalyCases.status)
      .then(rows => rows.map(r => ({ status: r.status!, count: r.count! }))),

    db.select({
      severity: fuelAnomalyCases.severity,
      count: sql<number>`count(*)::int`,
    }).from(fuelAnomalyCases).where(condition).groupBy(fuelAnomalyCases.severity)
      .then(rows => rows.map(r => ({ severity: r.severity!, count: r.count! }))),

    db.select({
      ruleCode: fuelAnomalyCases.ruleCode,
      count: sql<number>`count(*)::int`,
      // Sin ORDER BY, el LIMIT 10 recortaba un subconjunto arbitrario y el
      // gráfico se titulaba "Top reglas" mostrando cualquier decena.
    }).from(fuelAnomalyCases).where(condition).groupBy(fuelAnomalyCases.ruleCode).orderBy(desc(sql`count(*)`)).limit(10)
      .then(async (rows) => {
        // Enriquecer con nombres de regla
        const codes = [...new Set(rows.map(r => r.ruleCode))]
        const rules = codes.length > 0
          ? await db.query.fuelAnomalyRules.findMany({ where: inArray(fuelAnomalyRules.code, codes), columns: { code: true, name: true } })
          : []
        const nameByCode = new Map(rules.map(r => [r.code, r.name]))
        return rows.map(r => ({
          ruleCode: r.ruleCode!,
          ruleName: nameByCode.get(r.ruleCode!) ?? null,
          count: r.count!,
        }))
      }),

    condition
      ? db.select({ count: sql<number>`count(*)::int` }).from(fuelAnomalyCases).where(condition)
      : db.select({ count: sql<number>`count(*)::int` }).from(fuelAnomalyCases),
  ])

  return {
    byStatus: statusRows,
    bySeverity: severityRows,
    byRuleCode: ruleRows,
    total: totalResult[0]?.count ?? 0,
  }
}

/**
 * Deja el catálogo de reglas al día: inserta las que falten y no toca las que ya
 * están.
 *
 * Antes salía temprano si la tabla tenía cualquier fila ("seed si está vacía"),
 * y eso significaba que una regla NUEVA no llegaba jamás a una instalación ya
 * sembrada: el detector quedaba registrado en el código, sin fila que lo
 * dispare, sin error y sin señal. El cron la llama en cada corrida.
 *
 * Nunca pisa severidad, config ni activación: son decisiones del operador. La
 * pantalla de reglas no permite borrar —sólo desactivar— así que reponer las
 * que faltan no puede resucitar algo que alguien quitó a propósito.
 */
export async function syncAnomalyRuleCatalog(): Promise<{ created: number }> {
  const existing = await db.select({ code: fuelAnomalyRules.code }).from(fuelAnomalyRules)
  const known = new Set(existing.map((row) => row.code))
  let created = 0

  for (const rule of ANOMALY_RULE_CATALOG) {
    if (known.has(rule.code)) continue
    const [inserted] = await db.insert(fuelAnomalyRules).values({
      id: nanoid(), code: rule.code, name: rule.name, description: rule.description,
      severity: rule.severity, config: JSON.stringify(rule.config), isActive: true,
    }).onConflictDoNothing().returning({ id: fuelAnomalyRules.id })
    if (inserted) created++
  }
  return { created }
}

/** Enriquecer un caso con nombres legibles y comentarios. */
async function enrichAnomalyCase(row: typeof fuelAnomalyCases.$inferSelect): Promise<AnomalyCaseRow> {
  const [enriched] = await enrichAnomalyCases([row])
  return enriched!
}

/**
 * Enriquecer varios casos a la vez con 5 consultas en total en vez de hasta
 * 6 por caso (antes: `Promise.all(rows.map(enrichAnomalyCase))` — con el
 * límite por defecto de 50 casos eso son hasta 300 consultas por carga de
 * `/combustibles/anomalias`). Junta los IDs únicos de regla/equipo/faena/
 * usuario de todas las filas, hace una sola consulta por tipo, y arma cada
 * caso desde mapas en memoria.
 */
async function enrichAnomalyCases(rows: (typeof fuelAnomalyCases.$inferSelect)[]): Promise<AnomalyCaseRow[]> {
  if (rows.length === 0) return []

  const ruleIds = [...new Set(rows.map((r) => r.ruleId).filter((v): v is string => !!v))]
  const vehicleIds = [...new Set(rows.map((r) => r.vehicleId).filter((v): v is string => !!v))]
  const worksiteIds = [...new Set(rows.map((r) => r.worksiteId).filter((v): v is string => !!v))]
  const userIds = [...new Set([...rows.map((r) => r.assigneeId), ...rows.map((r) => r.resolvedById)].filter((v): v is string => !!v))]
  const caseIds = rows.map((r) => r.id)

  const [rules, vehicles, worksitesRows, usersRows, comments] = await Promise.all([
    ruleIds.length ? db.query.fuelAnomalyRules.findMany({ where: inArray(fuelAnomalyRules.id, ruleIds) }) : [],
    vehicleIds.length ? db.query.fuelVehicles.findMany({ where: inArray(fuelVehicles.id, vehicleIds) }) : [],
    worksiteIds.length ? db.query.worksites.findMany({ where: inArray(worksites.id, worksiteIds) }) : [],
    userIds.length ? db.query.users.findMany({ where: inArray(users.id, userIds) }) : [],
    db.query.fuelAnomalyComments.findMany({ where: inArray(fuelAnomalyComments.caseId, caseIds), orderBy: [fuelAnomalyComments.createdAt], with: { user: { columns: { name: true } } } }),
  ])

  const ruleById = new Map(rules.map((r) => [r.id, r]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))
  const worksiteById = new Map(worksitesRows.map((w) => [w.id, w]))
  const userById = new Map(usersRows.map((u) => [u.id, u]))
  const commentsByCase = new Map<string, typeof comments>()
  for (const c of comments) commentsByCase.set(c.caseId, [...(commentsByCase.get(c.caseId) ?? []), c])

  return rows.map((row) => ({
    id: row.id,
    ruleId: row.ruleId,
    ruleCode: row.ruleCode,
    ruleName: (row.ruleId ? ruleById.get(row.ruleId)?.name : null) ?? null,
    severity: row.severity as AnomalySeverity,
    worksiteId: row.worksiteId,
    worksiteName: (row.worksiteId ? worksiteById.get(row.worksiteId)?.name : null) ?? null,
    vehicleId: row.vehicleId,
    vehiclePlate: (row.vehicleId ? vehicleById.get(row.vehicleId)?.plate : null) ?? null,
    referenceEntityType: row.referenceEntityType,
    referenceEntityId: row.referenceEntityId,
    description: row.description,
    observedValue: row.observedValue,
    expectedValue: row.expectedValue,
    status: row.status as AnomalyCaseStatus,
    assigneeId: row.assigneeId,
    assigneeName: (row.assigneeId ? userById.get(row.assigneeId)?.name : null) ?? null,
    resolution: row.resolution,
    resolutionKind: (row.resolutionKind as MeterResolutionKind | null) ?? null,
    resolvedById: row.resolvedById,
    resolvedByName: (row.resolvedById ? userById.get(row.resolvedById)?.name : null) ?? null,
    resolvedAt: row.resolvedAt,
    detectedAt: row.detectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    comments: (commentsByCase.get(row.id) ?? []).map((c) => ({
      id: c.id, userId: c.userId, userName: c.user?.name ?? null, body: c.body, createdAt: c.createdAt,
    })),
  }))
}
