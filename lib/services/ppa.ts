/**
 * lib/services/ppa.ts
 * PPA Digital — lógica de negocio respaldada por DB.
 * Sin Server Actions ni imports de UI.
 */

import { eq, and, or, inArray, desc, ilike, gte, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import { ppaSubmissions, type PpaSubmission } from "@/db/schema/ppa"
import { workers, worksites } from "@/db/schema/worksites"
import { nanoid } from "@/lib/id"
import { ppaSubmitSchema, ppaReviewSchema, type PpaSubmitInput, type PpaReviewInput } from "@/lib/validation/ppa"
import { evaluatePpa } from "@/lib/ppa/evaluation"
import { cleanRut } from "@/lib/rut"
import {
  isTareaCritica,
  tipoTrabajoLabel,
  PPA_STOP_REASON_LABELS,
  type PpaAnswers,
  type EstadoPpa,
  type PpaStopReason,
} from "@/lib/ppa/types"
import { estadoPpaLabel, decisionPpaLabel } from "@/lib/ppa/badges"
import type { ReportData } from "@/lib/reports/export"
import {
  getUserIdsWithPermission,
  notifyManyUser,
  notifyAfterCommit,
} from "@/lib/services/notifications"
import { logger } from "@/lib/logger"

export type PpaRow = PpaSubmission & { worksiteName: string | null }

/* ── createPpaSubmission (flujo público del trabajador) ──────────────────────── */

export async function createPpaSubmission(
  input: PpaSubmitInput,
): Promise<{ submission: PpaSubmission; token: string }> {
  const data = ppaSubmitSchema.parse(input)

  // La faena debe existir.
  const worksite = await db.query.worksites.findFirst({
    where: eq(worksites.id, data.worksiteId),
    columns: { id: true, name: true },
  })
  if (!worksite) throw new Error("La faena indicada no existe.")

  // Identificación: si viene workerId, debe pertenecer a la faena.
  let manualIdentificacion = true
  let workerId: string | null = null
  if (data.workerId) {
    const worker = await db.query.workers.findFirst({
      where: eq(workers.id, data.workerId),
      columns: { id: true, worksiteId: true, firstName: true, lastName: true },
    })
    if (worker && worker.worksiteId === data.worksiteId) {
      workerId = worker.id
      manualIdentificacion = false
    }
  }

  const answers: PpaAnswers = {
    tipoTrabajo:         data.tipoTrabajo,
    cambioPlanificado:   data.cambioPlanificado,
    cambioDescripcion:   data.cambioDescripcion || undefined,
    peligroNoControlado: data.peligroNoControlado,
    peligroDescripcion:  data.peligroDescripcion || undefined,
    controles:           data.controles,
    seguroComenzar:      data.seguroComenzar,
    complementarias:     data.complementarias,
  }

  const evaluation = evaluatePpa(answers)
  const estado: EstadoPpa = evaluation.stop ? "detenido" : "aprobado_auto"

  const id = nanoid()
  const token = nanoid(32)
  const now = new Date().toISOString()

  const row: typeof ppaSubmissions.$inferInsert = {
    id,
    worksiteId:           data.worksiteId,
    workerId,
    workerName:           data.workerName,
    workerRut:            data.workerRut || null,
    workerCompany:        data.workerCompany || null,
    manualIdentificacion,
    tipoTrabajo:          data.tipoTrabajo,
    esCritica:            isTareaCritica(data.tipoTrabajo),
    answersJson:          answers,
    resultado:            evaluation.resultado,
    triggeredReasons:     evaluation.reasons,
    estado,
    publicToken:          token,
    publicTokenRevokedAt: null,
    reviewedBy:           null,
    fuiAlLugar:           null,
    accionCorrectiva:     null,
    decision:             null,
    reviewNota:           null,
    reviewedAt:           null,
    createdAt:            now,
    updatedAt:            now,
  }

  await db.insert(ppaSubmissions).values(row)

  // Alertar al responsable de revisión SOLO cuando el trabajo se detiene.
  if (evaluation.stop) {
    notifyAfterCommit(async () => {
      try {
        const reviewerIds = await getUserIdsWithPermission("ppa:review")
        if (reviewerIds.length > 0) {
          await notifyManyUser(reviewerIds, {
            type:       "ppa_stopped",
            title:      "PPA detenido — requiere revisión",
            body:       `${data.workerName} detuvo un trabajo en ${worksite.name}. Revisa y registra la acción correctiva.`,
            entityType: "ppa",
            entityId:   id,
            entityHref: `/prevencion/ppa/${id}`,
          })
        }
      } catch (err) {
        logger.error("[ppa] failed to notify reviewers", err)
      }
    })
  }

  const submission = await db.query.ppaSubmissions.findFirst({ where: eq(ppaSubmissions.id, id) })
  return { submission: submission!, token }
}

/* ── getPpaByToken (consulta pública del resultado) ──────────────────────────── */

export type PpaTokenResult = PpaRow & {
  /** Responsable del trabajador (texto en la lista controlada), si está enlazado. */
  supervisor: string | null
  prevencionista: string | null
}

export async function getPpaByToken(token: string): Promise<PpaTokenResult | null> {
  if (!token) return null
  const rows = await db
    .select({
      submission: ppaSubmissions,
      worksiteName: worksites.name,
      supervisor: workers.supervisor,
      prevencionista: workers.prevencionista,
    })
    .from(ppaSubmissions)
    .leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
    .leftJoin(workers, eq(ppaSubmissions.workerId, workers.id))
    .where(eq(ppaSubmissions.publicToken, token))
    .limit(1)

  if (rows.length === 0) return null
  const r = rows[0]!
  if (r.submission.publicTokenRevokedAt) return null
  return {
    ...r.submission,
    worksiteName: r.worksiteName,
    supervisor: r.supervisor,
    prevencionista: r.prevencionista,
  }
}

/* ── listPpa (panel del responsable / historial) ─────────────────────────────── */

export interface PpaListFilters {
  worksiteIds: string[] | "all"
  estado?: string
  tipoTrabajo?: string
  workerId?: string
  worksiteId?: string
  /** Búsqueda libre por nombre de trabajador o de faena. */
  search?: string
  /** Rango de fechas (ISO) sobre createdAt. */
  dateFrom?: string
  dateTo?: string
}

/** Construye las condiciones WHERE compartidas por listPpa y countPpa.
 *  Devuelve `null` cuando el alcance no incluye ninguna faena (resultado vacío). */
function buildPpaConditions(filters: PpaListFilters) {
  if (filters.worksiteIds !== "all" && filters.worksiteIds.length === 0) return null

  const conditions = []
  if (filters.worksiteIds !== "all") conditions.push(inArray(ppaSubmissions.worksiteId, filters.worksiteIds))
  if (filters.estado === "pendientes") {
    // Pseudo-filtro: todo lo que requiere acción del responsable.
    conditions.push(inArray(ppaSubmissions.estado, ["detenido", "en_correccion"]))
  } else if (filters.estado === "autorizado") {
    // "Autorizados" agrupa aprobación automática y autorización manual por revisor,
    // igual que la métrica de la barra superior (aprobadosAuto + autorizados).
    conditions.push(inArray(ppaSubmissions.estado, ["autorizado", "aprobado_auto"]))
  } else if (filters.estado) {
    conditions.push(eq(ppaSubmissions.estado, filters.estado))
  }
  if (filters.tipoTrabajo) conditions.push(eq(ppaSubmissions.tipoTrabajo, filters.tipoTrabajo))
  if (filters.workerId)    conditions.push(eq(ppaSubmissions.workerId, filters.workerId))
  if (filters.worksiteId)  conditions.push(eq(ppaSubmissions.worksiteId, filters.worksiteId))
  if (filters.dateFrom)    conditions.push(gte(ppaSubmissions.createdAt, filters.dateFrom))
  if (filters.dateTo)      conditions.push(lte(ppaSubmissions.createdAt, filters.dateTo))
  if (filters.search) {
    const like = `%${filters.search.trim()}%`
    const term = or(ilike(ppaSubmissions.workerName, like), ilike(worksites.name, like))
    if (term) conditions.push(term)
  }
  return conditions
}

export async function listPpa(
  filters: PpaListFilters,
  limit = 50,
  offset = 0,
): Promise<PpaRow[]> {
  const conditions = buildPpaConditions(filters)
  if (conditions === null) return []

  // El JOIN con worksites solo es necesario cuando se filtra por búsqueda libre
  // (ilike sobre worksites.name). Sin search, se omite el JOIN y se resuelven
  // los nombres de faena en una segunda consulta batch.
  if (filters.search) {
    const rows = await db
      .select({ submission: ppaSubmissions, worksiteName: worksites.name })
      .from(ppaSubmissions)
      .leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ppaSubmissions.createdAt))
      .limit(limit)
      .offset(offset)
    return rows.map((r) => ({ ...r.submission, worksiteName: r.worksiteName }))
  }

  // Sin search: query directo sobre ppa_submissions (sin JOIN).
  const submissions = await db
    .select()
    .from(ppaSubmissions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ppaSubmissions.createdAt))
    .limit(limit)
    .offset(offset)

  if (submissions.length === 0) return []

  // Batch-fetch los nombres de faena (≤limit ids, una sola consulta).
  const ids = [...new Set(submissions.map((s) => s.worksiteId))]
  const wsRows = ids.length > 0
    ? await db.select({ id: worksites.id, name: worksites.name })
        .from(worksites)
        .where(inArray(worksites.id, ids))
    : []
  const wsMap = new Map(wsRows.map((w) => [w.id, w.name]))

  return submissions.map((s) => ({ ...s, worksiteName: wsMap.get(s.worksiteId) ?? null }))
}

/** Total de PPA que coinciden con el filtro (para paginación). */
export async function countPpa(filters: PpaListFilters): Promise<number> {
  const conditions = buildPpaConditions(filters)
  if (conditions === null) return 0

  // El JOIN con worksites solo es necesario cuando se filtra por búsqueda libre
  // (ilike sobre worksites.name). Para conteos sin filtro search se omite.
  const base = db.select({ count: sql<number>`count(*)::int` }).from(ppaSubmissions)
  const q = filters.search
    ? base.leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
    : base

  const rows = await q.where(conditions.length > 0 ? and(...conditions) : undefined)
  return rows[0]?.count ?? 0
}

/* ── getPpa (detalle, con scope) ─────────────────────────────────────────────── */

export async function getPpa(id: string, worksiteIds: string[] | "all"): Promise<PpaRow | null> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return null

  const rows = await db
    .select({ submission: ppaSubmissions, worksiteName: worksites.name })
    .from(ppaSubmissions)
    .leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
    .where(eq(ppaSubmissions.id, id))
    .limit(1)

  if (rows.length === 0) return null
  const { submission, worksiteName } = rows[0]!
  if (worksiteIds !== "all" && !worksiteIds.includes(submission.worksiteId)) return null
  return { ...submission, worksiteName }
}

/* ── reviewPpa (intervención del responsable) ────────────────────────────────── */

export async function reviewPpa(
  input: PpaReviewInput,
  userId: string,
  worksiteIds: string[] | "all",
): Promise<PpaSubmission> {
  const data = ppaReviewSchema.parse(input)

  const current = await getPpa(data.ppaId, worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado === "aprobado_auto") {
    throw new Error("Este PPA fue aprobado automáticamente y no requiere revisión.")
  }
  if (current.estado === "autorizado" || current.estado === "rechazado" || current.estado === "cerrado") {
    throw new Error("Este PPA ya fue resuelto y no puede modificarse.")
  }

  const estado: EstadoPpa =
    data.decision === "autorizado" ? "autorizado" :
    data.decision === "rechazado"  ? "rechazado"  :
    "en_correccion"

  const now = new Date().toISOString()

  const result = await db.update(ppaSubmissions)
    .set({
      reviewedBy:       userId,
      fuiAlLugar:       data.fuiAlLugar,
      accionCorrectiva: data.accionCorrectiva || null,
      reviewNota:       data.reviewNota || null,
      decision:         data.decision,
      estado,
      reviewedAt:       now,
      updatedAt:        now,
    })
    // Optimistic concurrency: solo actualiza si el estado no cambió desde la lectura.
    .where(and(
      eq(ppaSubmissions.id, data.ppaId),
      inArray(ppaSubmissions.estado, ["detenido", "en_correccion"]),
    ))
    .returning()

  if (!result[0]) {
    throw new Error("Este PPA ya fue procesado por otro responsable. Recarga la página.")
  }

  return result[0]
}

/* ── closePpa (cierre del caso) ──────────────────────────────────────────────── */

/**
 * Cierra un caso ya resuelto (autorizado o rechazado) → estado "cerrado".
 * No requiere migración: reutiliza `updatedAt` como marca temporal del cierre.
 */
export async function closePpa(
  id: string,
  worksiteIds: string[] | "all",
): Promise<PpaSubmission> {
  const current = await getPpa(id, worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado !== "autorizado" && current.estado !== "rechazado") {
    throw new Error("Solo se pueden cerrar casos autorizados o rechazados.")
  }

  const now = new Date().toISOString()
  const result = await db.update(ppaSubmissions)
    .set({ estado: "cerrado", updatedAt: now })
    // Optimistic concurrency: solo cierra si el estado no cambió desde la lectura.
    .where(and(
      eq(ppaSubmissions.id, id),
      inArray(ppaSubmissions.estado, ["autorizado", "rechazado"]),
    ))
    .returning()

  if (!result[0]) {
    throw new Error("Este caso ya fue cerrado por otro responsable. Recarga la página.")
  }

  return result[0]
}

/* ── getPpaStats (panel de análisis) ─────────────────────────────────────────── */

export interface PpaStats {
  total: number
  detenidos: number
  aprobadosAuto: number
  autorizados: number
  rechazados: number
  pendientes: number
  porcentajeDesviaciones: number
  /** Promedio de minutos entre el envío y la revisión del responsable. null si no hay revisiones. */
  avgResponseMinutes: number | null
  topReasons: { reason: string; count: number }[]
  topTareas: { tipoTrabajo: string; count: number }[]
  topFaenas: { worksiteName: string; count: number }[]
}

export async function getPpaStats(worksiteIds: string[] | "all"): Promise<PpaStats> {
  const empty: PpaStats = {
    total: 0, detenidos: 0, aprobadosAuto: 0, autorizados: 0, rechazados: 0,
    pendientes: 0, porcentajeDesviaciones: 0, avgResponseMinutes: null,
    topReasons: [], topTareas: [], topFaenas: [],
  }
  if (worksiteIds !== "all" && worksiteIds.length === 0) return empty

  const scopeCond = worksiteIds !== "all"
    ? inArray(ppaSubmissions.worksiteId, worksiteIds)
    : undefined

  // ── Counts + avg response (single aggregate row) ────────────────────────
  const [totals] = await db
    .select({
      total:              sql<number>`count(*)::int`,
      detenidos:          sql<number>`count(*) filter (where ${ppaSubmissions.resultado} = 'detenido')::int`,
      aprobadosAuto:      sql<number>`count(*) filter (where ${ppaSubmissions.estado} = 'aprobado_auto')::int`,
      autorizados:        sql<number>`count(*) filter (where ${ppaSubmissions.estado} = 'autorizado')::int`,
      rechazados:         sql<number>`count(*) filter (where ${ppaSubmissions.estado} = 'rechazado')::int`,
      pendientes:         sql<number>`count(*) filter (where ${ppaSubmissions.estado} in ('detenido', 'en_correccion'))::int`,
      avgResponseMinutes: sql<number | null>`round(avg(extract(epoch from (${ppaSubmissions.reviewedAt} - ${ppaSubmissions.createdAt})) / 60) filter (where ${ppaSubmissions.reviewedAt} >= ${ppaSubmissions.createdAt}))`,
    })
    .from(ppaSubmissions)
    .where(scopeCond)

  // ── Top-N queries run in parallel (each returns ≤5 rows) ────────────────
  const [topReasonsResult, topTareasRows, topFaenasRows] = await Promise.all([
    // Top reasons (JSONB unnest — requires raw SQL)
    db.execute(sql`
      SELECT value AS reason, count(*)::int AS count
      FROM ppa_submissions,
           jsonb_array_elements_text(ppa_submissions.triggered_reasons) AS value
      ${scopeCond ? sql`WHERE ${scopeCond}` : sql``}
      GROUP BY value
      ORDER BY count DESC
      LIMIT 5
    `),

    // Top tareas (GROUP BY tipo_trabajo)
    db.select({
      tipoTrabajo: ppaSubmissions.tipoTrabajo,
      count:       sql<number>`count(*)::int`,
    }).from(ppaSubmissions)
      .where(scopeCond)
      .groupBy(ppaSubmissions.tipoTrabajo)
      .orderBy(sql`count(*) desc`)
      .limit(5),

    // Top faenas con más desviaciones (JOIN + filter detenidos + GROUP BY)
    db.select({
      worksiteName: worksites.name,
      count:        sql<number>`count(*)::int`,
    }).from(ppaSubmissions)
      .leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
      .where(and(scopeCond, eq(ppaSubmissions.resultado, "detenido")))
      .groupBy(worksites.name)
      .orderBy(sql`count(*) desc`)
      .limit(5),
  ])

  const total     = totals?.total ?? 0
  const detenidos = totals?.detenidos ?? 0

  return {
    total,
    detenidos,
    aprobadosAuto:          totals?.aprobadosAuto ?? 0,
    autorizados:            totals?.autorizados ?? 0,
    rechazados:             totals?.rechazados ?? 0,
    pendientes:             totals?.pendientes ?? 0,
    porcentajeDesviaciones: total > 0 ? Math.round((detenidos / total) * 100) : 0,
    avgResponseMinutes:     totals?.avgResponseMinutes ?? null,
    topReasons:             (topReasonsResult as Record<string, unknown>[]).map((r) => ({ reason: String(r.reason), count: Number(r.count) })),
    topTareas:              topTareasRows.map((r) => ({ tipoTrabajo: r.tipoTrabajo, count: r.count })),
    topFaenas:              topFaenasRows.map((r) => ({ worksiteName: r.worksiteName ?? "—", count: r.count })),
  }
}

/* ── Export XLSX ─────────────────────────────────────────────────────────────── */

export interface PpaExportFilters {
  estado?: string
  worksiteId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

export async function buildPpaExport(
  worksiteIds: string[] | "all",
  filters: PpaExportFilters = {},
): Promise<ReportData> {
  const rows = await listPpa({ worksiteIds, ...filters }, 10_000, 0)
  return {
    filenameBase: `ppa_digital_${new Date().toISOString().slice(0, 10)}`,
    worksheetName: "PPA Digital",
    headers: [
      "Fecha", "Trabajador", "RUT", "Identificación manual", "Faena", "Tarea",
      "Crítica", "Resultado", "Estado", "Motivos detención", "Decisión",
      "Acción correctiva", "Revisado",
    ],
    rows: rows.map((r) => [
      new Date(r.createdAt).toLocaleString("es-CL"),
      r.workerName,
      r.workerRut ?? "",
      r.manualIdentificacion ? "Sí" : "No",
      r.worksiteName ?? "",
      tipoTrabajoLabel(r.tipoTrabajo),
      r.esCritica ? "Sí" : "No",
      r.resultado === "detenido" ? "Detenido" : "Autorizado auto.",
      estadoPpaLabel(r.estado),
      ((r.triggeredReasons as PpaStopReason[] | null) ?? [])
        .map((x) => PPA_STOP_REASON_LABELS[x] ?? x).join(" | "),
      decisionPpaLabel(r.decision),
      r.accionCorrectiva ?? "",
      r.reviewedAt ? new Date(r.reviewedAt).toLocaleString("es-CL") : "",
    ]),
  }
}

/* ── Helpers públicos para el formulario del trabajador ──────────────────────── */

export async function listWorksitesForPublicForm(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(worksites.name)
}

/** Faenas activas dentro del alcance del usuario (filtros internos + acceso QR). */
export async function listScopedWorksites(
  worksiteIds: string[] | "all",
): Promise<{ id: string; name: string }[]> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return []
  const cond = worksiteIds !== "all"
    ? and(eq(worksites.isActive, true), inArray(worksites.id, worksiteIds))
    : eq(worksites.isActive, true)
  return db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(cond)
    .orderBy(worksites.name)
}

/**
 * Identifica al trabajador SOLO por RUT (único en la lista controlada) y deriva
 * su faena. El trabajador no elige faena: se obtiene de su registro.
 */
export async function findWorkerByRut(
  rut: string,
): Promise<{
  id: string
  firstName: string
  lastName: string
  rut: string | null
  position: string | null
  worksiteId: string
  worksiteName: string | null
} | null> {
  if (!rut) return null
  const cleaned = cleanRut(rut)
  const results = await db
    .select({
      id: workers.id,
      firstName: workers.firstName,
      lastName: workers.lastName,
      rut: workers.rut,
      position: workers.position,
      worksiteId: workers.worksiteId,
      worksiteName: worksites.name,
    })
    .from(workers)
    .leftJoin(worksites, eq(workers.worksiteId, worksites.id))
    .where(and(eq(workers.rut, cleaned), eq(workers.isActive, true)))
    .limit(1)

  return results[0] ?? null
}
