/**
 * lib/services/ppa.ts
 * PPA Digital — lógica de negocio respaldada por DB.
 * Sin Server Actions ni imports de UI.
 */

import { eq, and, inArray, desc } from "drizzle-orm"
import { db } from "@/db"
import { ppaSubmissions, type PpaSubmission } from "@/db/schema/ppa"
import { workers, worksites } from "@/db/schema/worksites"
import { nanoid } from "@/lib/id"
import { ppaSubmitSchema, ppaReviewSchema, type PpaSubmitInput, type PpaReviewInput } from "@/lib/validation/ppa"
import { evaluatePpa } from "@/lib/ppa/evaluation"
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

export async function getPpaByToken(token: string): Promise<PpaRow | null> {
  if (!token) return null
  const rows = await db
    .select({
      submission: ppaSubmissions,
      worksiteName: worksites.name,
    })
    .from(ppaSubmissions)
    .leftJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
    .where(eq(ppaSubmissions.publicToken, token))
    .limit(1)

  if (rows.length === 0) return null
  return { ...rows[0]!.submission, worksiteName: rows[0]!.worksiteName }
}

/* ── listPpa (panel del responsable / historial) ─────────────────────────────── */

export async function listPpa(
  filters: {
    worksiteIds: string[] | "all"
    estado?: string
    tipoTrabajo?: string
    workerId?: string
  },
  limit = 50,
  offset = 0,
): Promise<PpaRow[]> {
  if (filters.worksiteIds !== "all" && filters.worksiteIds.length === 0) return []

  const conditions = []
  if (filters.worksiteIds !== "all") conditions.push(inArray(ppaSubmissions.worksiteId, filters.worksiteIds))
  if (filters.estado)      conditions.push(eq(ppaSubmissions.estado, filters.estado))
  if (filters.tipoTrabajo) conditions.push(eq(ppaSubmissions.tipoTrabajo, filters.tipoTrabajo))
  if (filters.workerId)    conditions.push(eq(ppaSubmissions.workerId, filters.workerId))

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

  await db.update(ppaSubmissions)
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
    .where(eq(ppaSubmissions.id, data.ppaId))

  const updated = await db.query.ppaSubmissions.findFirst({ where: eq(ppaSubmissions.id, data.ppaId) })
  return updated!
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
  topReasons: { reason: string; count: number }[]
  topTareas: { tipoTrabajo: string; count: number }[]
}

export async function getPpaStats(worksiteIds: string[] | "all"): Promise<PpaStats> {
  const empty: PpaStats = {
    total: 0, detenidos: 0, aprobadosAuto: 0, autorizados: 0, rechazados: 0,
    pendientes: 0, porcentajeDesviaciones: 0, topReasons: [], topTareas: [],
  }
  if (worksiteIds !== "all" && worksiteIds.length === 0) return empty

  const scopeCond = worksiteIds !== "all"
    ? inArray(ppaSubmissions.worksiteId, worksiteIds)
    : undefined

  const rows = await db
    .select({
      estado:           ppaSubmissions.estado,
      resultado:        ppaSubmissions.resultado,
      tipoTrabajo:      ppaSubmissions.tipoTrabajo,
      triggeredReasons: ppaSubmissions.triggeredReasons,
    })
    .from(ppaSubmissions)
    .where(scopeCond)

  const stats = { ...empty }
  stats.total = rows.length
  const reasonCounts = new Map<string, number>()
  const tareaCounts = new Map<string, number>()

  for (const r of rows) {
    if (r.estado === "aprobado_auto") stats.aprobadosAuto++
    if (r.estado === "autorizado")    stats.autorizados++
    if (r.estado === "rechazado")     stats.rechazados++
    if (r.estado === "detenido" || r.estado === "en_correccion") stats.pendientes++
    if (r.resultado === "detenido")   stats.detenidos++

    tareaCounts.set(r.tipoTrabajo, (tareaCounts.get(r.tipoTrabajo) ?? 0) + 1)
    for (const reason of (r.triggeredReasons as string[] | null) ?? []) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
    }
  }

  stats.porcentajeDesviaciones = stats.total > 0
    ? Math.round((stats.detenidos / stats.total) * 100)
    : 0

  stats.topReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  stats.topTareas = [...tareaCounts.entries()]
    .map(([tipoTrabajo, count]) => ({ tipoTrabajo, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return stats
}

/* ── Export XLSX ─────────────────────────────────────────────────────────────── */

export async function buildPpaExport(worksiteIds: string[] | "all"): Promise<ReportData> {
  const rows = await listPpa({ worksiteIds }, 10_000, 0)
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

export async function listWorkersForWorksite(
  worksiteId: string,
): Promise<{ id: string; firstName: string; lastName: string; rut: string | null; position: string | null }[]> {
  if (!worksiteId) return []
  return db
    .select({
      id: workers.id,
      firstName: workers.firstName,
      lastName: workers.lastName,
      rut: workers.rut,
      position: workers.position,
    })
    .from(workers)
    .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))
    .orderBy(workers.firstName)
}
