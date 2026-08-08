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
import { db } from "@/db"
import { fuelAnomalyCases, fuelAnomalyComments, fuelAnomalyRules, fuelVehicles, worksites, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { worksiteScopeSql } from "@/lib/auth/scope"

export type AnomalyCaseStatus = "open" | "in_review" | "resolved" | "dismissed" | "reopened"
export type AnomalySeverity = "low" | "medium" | "high" | "critical"

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
 * — en cualquier estado, no sólo abierto — no duplica.
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
export async function createAnomalyCase(input: CreateAnomalyCaseInput): Promise<AnomalyCaseRow> {
  // Verificar duplicado
  if (input.referenceEntityType && input.referenceEntityId) {
    const existing = await db.query.fuelAnomalyCases.findFirst({
      where: and(
        eq(fuelAnomalyCases.ruleCode, input.ruleCode),
        eq(fuelAnomalyCases.referenceEntityType, input.referenceEntityType),
        eq(fuelAnomalyCases.referenceEntityId, input.referenceEntityId),
      ),
    })
    if (existing) return await enrichAnomalyCase(existing)
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
  return await enrichAnomalyCase(record!)
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
  caseId: string,
  status: AnomalyCaseStatus,
  userId: string,
  resolution?: string,
): Promise<AnomalyCaseRow> {
  const now = new Date().toISOString()
  const isResolved = status === "resolved" || status === "dismissed"
  if (isResolved && !(resolution ?? "").trim()) {
    throw new Error("Debes indicar el motivo para resolver o descartar un caso")
  }
  // Antes CUALQUIER estado no resolutivo (incluido "in_review", que no es una
  // decisión deliberada de reabrir) borraba resolution/resolvedById/resolvedAt
  // incondicionalmente — mover un caso YA resuelto a "in_review" destruía el
  // motivo y el responsable de la resolución sin dejar rastro (no hay
  // recordAudit en esta función ni en su único llamador). Ahora sólo se
  // escriben esos campos cuando SE resuelve (con el motivo nuevo) o cuando SE
  // reabre explícitamente (`reopened` — la única transición cuyo nombre dice
  // "empezar de nuevo"); cualquier otra transición conserva lo que ya había.
  const resolutionFields = isResolved
    ? { resolution: resolution ?? null, resolvedById: userId, resolvedAt: now }
    : status === "reopened"
      ? { resolution: null, resolvedById: null, resolvedAt: null }
      : {}
  const [updated] = await db.update(fuelAnomalyCases).set({
    status,
    updatedAt: now,
    ...resolutionFields,
  }).where(eq(fuelAnomalyCases.id, caseId)).returning()
  if (!updated) throw new Error("Caso de anomalía no encontrado")
  return await enrichAnomalyCase(updated)
}

/** Asignar responsable. */
export async function assignAnomalyCase(caseId: string, assigneeId: string | null): Promise<AnomalyCaseRow> {
  const [updated] = await db.update(fuelAnomalyCases).set({ assigneeId, updatedAt: new Date().toISOString() })
    .where(eq(fuelAnomalyCases.id, caseId)).returning()
  if (!updated) throw new Error("Caso de anomalía no encontrado")
  return await enrichAnomalyCase(updated)
}

/** Añadir comentario a un caso. */
export async function addAnomalyComment(caseId: string, userId: string, body: string): Promise<AnomalyCommentRow> {
  const [comment] = await db.insert(fuelAnomalyComments).values({
    id: nanoid(), caseId, userId, body,
  }).returning()
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId))
  return { id: comment!.id, userId, userName: user?.name ?? null, body, createdAt: comment!.createdAt }
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

/** Seed de reglas canónicas si no existen. */
export async function seedAnomalyRulesIfEmpty() {
  const existing = await db.select({ count: sql<number>`count(*)::int` }).from(fuelAnomalyRules)
  if (existing[0]?.count && existing[0]!.count > 0) return

  const rules = [
    { code: "rendimiento_fuera_historico", name: "Rendimiento fuera del historial del equipo", severity: "high" as const, config: { thresholdStdDevs: 2 } },
    { code: "rendimiento_fuera_grupo", name: "Rendimiento fuera del grupo comparable", severity: "medium" as const, config: { thresholdStdDevs: 2 } },
    { code: "litros_supera_capacidad", name: "Litros superiores a capacidad del estanque", severity: "critical" as const, config: { margin: 0.05 } },
    { code: "carga_duplicada", name: "Carga duplicada", severity: "high" as const, config: { windowHours: 2 } },
    { code: "sello_repetido", name: "Sello repetido", severity: "high" as const, config: {} },
    { code: "sello_no_correlativo", name: "Sello no correlativo", severity: "medium" as const, config: {} },
    { code: "evidencia_faltante", name: "Evidencia faltante en carga TAE", severity: "medium" as const, config: { requiredKinds: ["odometer", "liter_meter", "removed_seal", "installed_seal"] } },
    { code: "evidencia_duplicada", name: "Evidencia duplicada por hash", severity: "low" as const, config: {} },
    { code: "evidencia_ilegible", name: "Evidencia ilegible o corrupta", severity: "medium" as const, config: {} },
    { code: "kilometraje_regresivo", name: "Kilometraje inferior al anterior", severity: "high" as const, config: {} },
    { code: "horometro_regresivo", name: "Horómetro inferior al anterior", severity: "high" as const, config: {} },
    { code: "kilometraje_sin_variacion", name: "Kilometraje sin variación respecto a la carga anterior", severity: "medium" as const, config: {} },
    { code: "horometro_sin_variacion", name: "Horómetro sin variación respecto a la carga anterior", severity: "medium" as const, config: {} },
    { code: "sello_inicial_faltante", name: "Falta sello inicial (retirado)", severity: "medium" as const, config: {} },
    { code: "sello_final_faltante", name: "Falta sello final (instalado)", severity: "medium" as const, config: {} },
    { code: "identidad_incompleta", name: "Conductor o supervisor no verificado en catálogo", severity: "low" as const, config: {} },
    { code: "consumo_durante_inactividad", name: "Consumo durante inactividad del equipo", severity: "high" as const, config: {} },
    { code: "carga_fuera_horario", name: "Carga fuera de horario operativo", severity: "low" as const, config: {} },
    { code: "carga_faena_distinta", name: "Carga en faena distinta de la asignada al equipo", severity: "medium" as const, config: {} },
    { code: "exceso_cargas_ventana", name: "Exceso de cargas dentro de una ventana temporal", severity: "medium" as const, config: { windowHours: 2, maxLoads: 3 } },
    { code: "proveedor_no_habitual", name: "Carga facturada con proveedor no habitual", severity: "low" as const, config: {} },
    { code: "variacion_brusca_consumo", name: "Variación brusca de consumo", severity: "medium" as const, config: { thresholdPct: 50 } },
  ]

  for (const rule of rules) {
    await db.insert(fuelAnomalyRules).values({
      id: nanoid(), code: rule.code, name: rule.name,
      severity: rule.severity, config: JSON.stringify(rule.config), isActive: true,
    }).onConflictDoNothing()
  }
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
