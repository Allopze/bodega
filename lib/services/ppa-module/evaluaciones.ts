import { eq, and, or } from "drizzle-orm"
import { db } from "@/db"
import { ppaStatusHistory, ppaSubmissions, type PpaSubmission } from "@/db/schema/ppa"
import { preventionWorkPermits } from "@/db/schema/prevention/permits"
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
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { hashPpaPublicToken } from "./public-token"

export type PpaRow = Omit<PpaSubmission, "publicToken"> & {
  worksiteName: string | null
  /** Título del cargo admin_contrato en el contrato de la faena; null = por defecto. */
  adminContratoLabel?: string | null
}

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

  // El enganche es opcional y sólo a un permiso vigente de la misma faena: el
  // PPA es la verificación breve DENTRO del permiso, no un vínculo a un
  // trámite ya cerrado o de otro lugar. `workPermitId` llega del selector
  // público, que sólo lista permisos activos — se revalida igual acá porque
  // el cliente no es de confianza.
  let workPermitId: string | null = null
  if (data.workPermitId) {
    const permit = await db.query.preventionWorkPermits.findFirst({
      where: eq(preventionWorkPermits.id, data.workPermitId),
      columns: { id: true, worksiteId: true, status: true },
    })
    if (!permit || permit.worksiteId !== data.worksiteId || permit.status !== "active") {
      throw new Error("El permiso de trabajo indicado no está vigente en esta faena.")
    }
    workPermitId = permit.id
  }

  let manualIdentificacion = true
  let workerId: string | null = null
  // `data.workerName` es el nombre enmascarado devuelto por la búsqueda pública
  // por RUT (minimización de PII en la respuesta de red — ver findWorkerByRutAction),
  // no el nombre real del trabajador. Cuando hay workerId válido, el registro
  // permanente debe usar el nombre real ya verificado en el catálogo, no el
  // que mandó el cliente — si no, el PPA queda archivado como "Trabajador E."
  // en vez de "Trabajador E2E".
  let workerName = data.workerName
  if (data.workerId) {
    const worker = await db.query.workers.findFirst({
      where: eq(workers.id, data.workerId),
      columns: { id: true, worksiteId: true, firstName: true, lastName: true },
    })
    if (worker && worker.worksiteId === data.worksiteId) {
      workerId = worker.id
      manualIdentificacion = false
      workerName = `${worker.firstName} ${worker.lastName}`.trim()
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
    workerName,
    workerRut:            data.workerRut || null,
    workerCompany:        data.workerCompany || null,
    manualIdentificacion,
    tipoTrabajo:          data.tipoTrabajo,
    esCritica:            isTareaCritica(data.tipoTrabajo),
    answersJson:          answers,
    resultado:            evaluation.resultado,
    triggeredReasons:     evaluation.reasons,
    estado,
    publicToken:          hashPpaPublicToken(token),
    publicTokenRevokedAt: null,
    reviewedBy:           null,
    fuiAlLugar:           null,
    accionCorrectiva:     null,
    decision:             null,
    reviewNota:           null,
    reviewedAt:           null,
    workPermitId,
    createdAt:            now,
    updatedAt:            now,
  }

  await db.transaction(async (tx) => {
    await tx.insert(ppaSubmissions).values(row)
    await tx.insert(ppaStatusHistory).values({
      id: `ppah-${nanoid()}`,
      ppaId: id,
      capaActionId: null,
      fromStatus: null,
      toStatus: estado,
      reason: evaluation.stop
        ? "Evaluación automática: trabajo detenido por controles insuficientes"
        : "Evaluación automática: controles declarados suficientes",
      actorType: "system",
      actorUserId: null,
      createdAt: now,
    })
    // Hecho transversal seguro: no incluye trabajador, RUT, respuestas ni
    // motivos de detención. El detalle continúa protegido en el módulo PPA.
    await recordOperationalActivity({
      eventType: "ppa.evaluated",
      module: "ppa",
      entityType: "ppa",
      entityId: id,
      worksiteId: data.worksiteId,
      actorSnapshot: null,
      payload: { status: estado, critical: isTareaCritica(data.tipoTrabajo) },
    }, tx)
  })

  if (evaluation.stop) {
    notifyAfterCommit(async () => {
      try {
        const reviewerIds = await getUserIdsWithPermissionForWorksite("ppa:review", data.worksiteId)
        if (reviewerIds.length > 0) {
          await notifyManyUser(reviewerIds, {
            type:       "ppa_stopped",
            title:      "PPA detenido: requiere revisión",
            body:       `${workerName} detuvo un trabajo en ${worksite.name}. Revisa y registra la acción correctiva.`,
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
  const tokenHash = hashPpaPublicToken(token)
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
    // El segundo término mantiene válidos enlaces emitidos antes de la
    // migración. Al primer uso se convierten a hash en la misma aplicación.
    .where(or(eq(ppaSubmissions.publicToken, tokenHash), eq(ppaSubmissions.publicToken, token)))
    .limit(1)

  if (rows.length === 0) return null
  const r = rows[0]!
  if (r.submission.publicTokenRevokedAt) return null
  if (r.submission.publicToken === token) {
    await db.update(ppaSubmissions)
      .set({ publicToken: tokenHash, updatedAt: new Date().toISOString() })
      .where(and(eq(ppaSubmissions.id, r.submission.id), eq(ppaSubmissions.publicToken, token)))
  }
  const { publicToken: _publicToken, ...submission } = r.submission
  return {
    ...submission,
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
  const existing = await db.query.ppaSubmissions.findFirst({ where: eq(ppaSubmissions.id, id) })
  if (!existing) throw new Error("PPA no encontrado")
  if (worksiteIds !== "all" && !worksiteIds.includes(existing.worksiteId)) {
    throw new Error("Sin acceso a la faena de este PPA")
  }
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

/**
 * Permisos vigentes para el selector opcional del formulario público.
 *
 * Se cargan todos y el cliente filtra por faena, igual que `worksites` arriba
 * — no hay una acción pública nueva por faena. Sólo expone lo mínimo (código
 * y tarea): nada de supervisor, cuadrilla ni AST, que sí son sensibles.
 */
export async function listActiveWorkPermitsForPublicForm(): Promise<
  { id: string; code: string; taskDescription: string; worksiteId: string }[]
> {
  return db
    .select({
      id: preventionWorkPermits.id,
      code: preventionWorkPermits.code,
      taskDescription: preventionWorkPermits.taskDescription,
      worksiteId: preventionWorkPermits.worksiteId,
    })
    .from(preventionWorkPermits)
    .where(eq(preventionWorkPermits.status, "active"))
    .orderBy(preventionWorkPermits.code)
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
