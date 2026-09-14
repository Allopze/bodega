import { eq, and, isNull } from "drizzle-orm"
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
import { derivePpaPublicToken, hashPpaPublicToken, resolvePpaPublicToken } from "./public-token"
import { verifyPpaWorksiteAccessToken } from "./worksite-access-token"

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

  /*
   * PPA-001 (auditoría 2026-09-14): la faena del envío tiene que estar
   * ACREDITADA por algo que verifique el servidor, no declarada por el cliente.
   * Antes bastaba con que el id existiera —el parámetro `?faena=` del enlace
   * repartido— y cualquiera con la URL base podía escribir en el registro de
   * cualquier faena. Hay exactamente dos acreditaciones, y se resuelven abajo:
   *
   *  1. el token del enlace/QR que reparte el panel interno, y
   *  2. el propio trabajador identificado por RUT, cuya faena sale del catálogo
   *     (`workers.worksiteId`) y no del formulario.
   *
   * La comprobación va después de resolver al trabajador porque la (2) depende
   * de esa resolución.
   */
  const acreditadaPorEnlace = verifyPpaWorksiteAccessToken(data.worksiteId, data.accessToken)

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

  /*
   * PPA-001: sin enlace acreditado y sin trabajador del catálogo en esa faena,
   * nadie respalda que este PPA pertenezca a esta faena. Se rechaza con el
   * remedio en el mensaje, que es lo que la persona en terreno puede hacer:
   * escanear el QR de su faena o identificarse con su RUT.
   *
   * QUEDA POR DECIDIR (producto, no código): si la identificación manual
   * —trabajador que no está en el catálogo, típicamente contratista— debe
   * poder enviar SIN enlace acreditado. Hoy no puede, porque no queda nada que
   * ate el envío a la faena; permitirlo exige declarar qué la acreditaría.
   * El enlace "General (sin faena)" que el panel repartía queda, por lo mismo,
   * como acceso de sólo lectura del formulario: sirve para identificarse por
   * RUT, no para elegir faena a mano.
   */
  if (!acreditadaPorEnlace && !workerId) {
    throw new Error(
      "Este enlace no acredita la faena. Escanea el QR o abre el enlace de tu faena, "
      + "o identifícate con tu RUT para que el sistema la reconozca.",
    )
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
  // Sin clave del cliente (cliente antiguo servido desde el caché del Service
  // Worker) se genera una del servidor: ese envío no es idempotente, pero el
  // token se deriva por el mismo camino y la columna queda poblada.
  const clientSubmissionId = data.clientSubmissionId || `srv-${nanoid()}`
  const token = derivePpaPublicToken(clientSubmissionId)
  const now = new Date().toISOString()

  const row: typeof ppaSubmissions.$inferInsert = {
    id,
    clientSubmissionId,
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
    // Fecha de terreno cuando el cliente la manda (envío encolado offline);
    // en línea coincide con `createdAt` y se deja nula para no duplicar el dato.
    filledAt:             data.filledAt ?? null,
    createdAt:            now,
    updatedAt:            now,
  }

  const { submission, replayed, linkToken } = await db.transaction(async (tx) => {
    const [created] = await tx.insert(ppaSubmissions).values(row)
      .onConflictDoNothing({ target: ppaSubmissions.clientSubmissionId })
      .returning()

    // Reenvío de la cola offline: el primer intento sí llegó a commitear y se
    // perdió la confirmación al cliente. Devolvemos la fila original —y, por
    // derivación, el mismo token— sin duplicar historial ni volver a notificar.
    if (!created) {
      const [existing] = await tx.select().from(ppaSubmissions)
        .where(eq(ppaSubmissions.clientSubmissionId, clientSubmissionId)).limit(1)
      if (!existing) throw new Error("No se pudo recuperar el PPA ya registrado con esta clave de envío.")
      // Si `AUTH_SECRET` rotó entre el primer intento y el reenvío, `token` ya
      // no es el que abre esta fila: se recupera el que sí, probando los
      // secretos anteriores contra el hash guardado. Sin esto el reenvío
      // devolvía la fila correcta con un enlace muerto (404).
      const recovered = resolvePpaPublicToken(clientSubmissionId, existing.publicToken)
      if (!recovered) {
        // Rotación fuera de ventana: el secreto que emitió este enlace ya no
        // está ni en `AUTH_SECRET` ni en `AUTH_SECRET_PREVIOUS`, y el valor en
        // claro no se persiste, así que desde acá es irrecuperable. El enlace
        // que tiene el trabajador SIGUE VIVO (la base guarda su hash, que no
        // cambia al rotar): lo único perdido es poder re-entregarlo. Se
        // devuelve el derivado con el secreto vigente —que dará 404— en vez de
        // fallar el reenvío, porque fallar dejaría a la cola offline
        // reintentando para siempre un envío que ya está registrado.
        logger.warn("[ppa] reenvío sin enlace recuperable: ningún secreto vigente abre el hash guardado", { ppaId: existing.id })
      }
      return { submission: existing, replayed: true, linkToken: recovered ?? token }
    }

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
    return { submission: created, replayed: false, linkToken: token }
  })

  if (!replayed && evaluation.stop) {
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

  return { submission, token: linkToken }
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
    // SÓLO por hash. Comparar además contra el valor almacenado en claro
    // convertía la propia fila en credencial: quien viera `public_token` en la
    // base entraba al PPA, y al entrar destruía el enlace legítimo del
    // trabajador (lo reescribía con su hash). Los seeds guardan el hash igual
    // que `createPpaSubmission`, así que no queda nada en claro que rescatar.
    .where(eq(ppaSubmissions.publicToken, hashPpaPublicToken(token)))
    .limit(1)

  if (rows.length === 0) return null
  const r = rows[0]!
  if (r.submission.publicTokenRevokedAt) return null
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

  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    // El WHERE con `IS NULL` deja la revocación idempotente frente a dos
    // responsables simultáneos: sólo una gana y sólo una deja traza.
    const [updated] = await tx.update(ppaSubmissions).set({
      publicTokenRevokedAt: now,
      updatedAt: now,
    }).where(and(
      eq(ppaSubmissions.id, id),
      isNull(ppaSubmissions.publicTokenRevokedAt),
    )).returning()
    if (!updated) throw new Error("El acceso público ya está revocado")

    // Cortar el enlace del trabajador es una decisión de un responsable, no un
    // efecto del sistema: sin actor no se sabe quién la tomó. Va al historial
    // del PPA (visible en la ficha) y no sólo al log. El estado no cambia —
    // cambia el acceso—, por eso `from` y `to` son el mismo.
    await tx.insert(ppaStatusHistory).values({
      id: `ppah-${nanoid()}`,
      ppaId: id,
      capaActionId: null,
      fromStatus: updated.estado,
      toStatus: updated.estado,
      reason: "Acceso público revocado",
      actorType: "user",
      actorUserId: userId,
      createdAt: now,
    })
  })
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
