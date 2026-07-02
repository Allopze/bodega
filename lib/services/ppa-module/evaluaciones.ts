import { eq, and } from "drizzle-orm"
import { db } from "@/db"
import { ppaSubmissions, type PpaSubmission } from "@/db/schema/ppa"
import { workers, worksites } from "@/db/schema/worksites"
import { nanoid } from "@/lib/id"
import { ppaSubmitSchema, type PpaSubmitInput } from "@/lib/validation/ppa"
import { evaluatePpa } from "@/lib/ppa/evaluation"
import { cleanRut } from "@/lib/rut"
import {
  isTareaCritica,
  type PpaAnswers,
  type EstadoPpa,
} from "@/lib/ppa/types"
import {
  getUserIdsWithPermissionForWorksite,
  notifyManyUser,
  notifyAfterCommit,
} from "@/lib/services/notifications"
import { logger } from "@/lib/logger"

export type PpaRow = PpaSubmission & { worksiteName: string | null }

export type PpaTokenResult = PpaRow & {
  supervisor: string | null
  prevencionista: string | null
}

export async function createPpaSubmission(
  input: PpaSubmitInput,
): Promise<{ submission: PpaSubmission; token: string }> {
  const data = ppaSubmitSchema.parse(input)

  const worksite = await db.query.worksites.findFirst({
    where: eq(worksites.id, data.worksiteId),
    columns: { id: true, name: true },
  })
  if (!worksite) throw new Error("La faena indicada no existe.")

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

  if (evaluation.stop) {
    notifyAfterCommit(async () => {
      try {
        const reviewerIds = await getUserIdsWithPermissionForWorksite("ppa:review", data.worksiteId)
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

export async function revokePpaToken(
  id: string,
  userId: string,
  worksiteIds: string[] | "all",
): Promise<void> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) throw new Error("Sin acceso")
  if (worksiteIds !== "all") {
    const ppa = await db.query.ppaSubmissions.findFirst({ where: eq(ppaSubmissions.id, id) })
    if (!ppa) throw new Error("PPA no encontrado")
    if (!worksiteIds.includes(ppa.worksiteId)) throw new Error("Sin acceso a la faena de este PPA")
  }
  const existing = await db.query.ppaSubmissions.findFirst({ where: eq(ppaSubmissions.id, id) })
  if (!existing) throw new Error("PPA no encontrado")
  if (existing.publicTokenRevokedAt) throw new Error("El acceso público ya está revocado")

  await db.update(ppaSubmissions).set({
    publicTokenRevokedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).where(eq(ppaSubmissions.id, id))
}

export async function listWorksitesForPublicForm(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(eq(worksites.isActive, true))
    .orderBy(worksites.name)
}

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
