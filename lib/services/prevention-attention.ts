import { and, asc, eq, inArray, lt, lte, max, ne, or, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  ppaSubmissions,
  preventionCapaActions,
  preventionCommitteeMeetings,
  preventionCommittees,
  preventionEmergencyResources,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  preventionProtocolApplicabilities,
  preventionRiskControls,
  preventionRiskEntries,
  preventionRiskMatrices,
  preventionRiskProgramActions,
  preventionRiskProgramOccurrences,
  preventionRiskPrograms,
  sstEvaluations,
  worksites,
} from "@/db/schema"
import { adminContratoLabel } from "@/lib/prevention/admin-contrato-label"
import { assessMeetingCadence, isMandateExpired } from "@/lib/prevention/cphs"
import { MINSAL_PROTOCOL_LABELS } from "@/lib/prevention/minsal-protocols"
import { capaPrioridad } from "@/lib/services/pdtp/capa-view"
import { todayInChile } from "@/lib/utils"

export type PreventionAttentionItem = {
  id: string
  kind: "action" | "evaluation" | "ppa" | "inspection" | "cphs" | "protocol" | "emergency_resource" | "miper"
  title: string
  detail: string
  worksiteName: string
  dueDate: string | null
  href: string
  tone: "danger" | "warning" | "neutral"
}

/** Sin esto `warning` y `neutral` empataban y el orden dependía del azar. */
const TONE_RANK: Record<PreventionAttentionItem["tone"], number> = { danger: 0, warning: 1, neutral: 2 }

function byUrgency(a: PreventionAttentionItem, b: PreventionAttentionItem) {
  return TONE_RANK[a.tone] - TONE_RANK[b.tone] || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
}

/**
 * I-11 (auditoría UI/UX 2026-08-25): el orden por urgencia ya era correcto —
 * el defecto real era cortar en `limit` sobre el ranking GLOBAL sin repartir
 * por tipo. Con 12 acciones PDTP vencidas (algo normal), los 12 cupos se los
 * llevaba una sola fuente y las inspecciones pendientes de revisión no
 * aparecían nunca, aunque hubiera diez esperando. Se reparte round-robin por
 * `kind` —el más urgente de cada uno primero, luego el segundo— y lo elegido
 * se reordena por urgencia al final, para que dentro de lo visible siga
 * mandando lo más urgente.
 *
 * 2026-10-01 (MIPER, §9.1): sumar un `kind` **reduce los cupos de los demás**.
 * El reparto es un cupo por fuente por vuelta, así que cada tipo nuevo se lleva
 * una fila de cada ronda antes de que cualquier otro repita. Es el
 * comportamiento buscado —una fuente que no aparece nunca es el defecto que
 * este reparto vino a corregir—, pero conviene saberlo antes de agregar el
 * siguiente: con nueve tipos y `limit` 12, ninguna fuente pone más de dos filas.
 */
export function pickAttention(items: PreventionAttentionItem[], limit: number): PreventionAttentionItem[] {
  const queues = new Map<PreventionAttentionItem["kind"], PreventionAttentionItem[]>()
  for (const item of [...items].sort(byUrgency)) {
    const queue = queues.get(item.kind) ?? []
    queue.push(item)
    queues.set(item.kind, queue)
  }
  const picked: PreventionAttentionItem[] = []
  while (picked.length < limit && [...queues.values()].some((queue) => queue.length > 0)) {
    for (const queue of queues.values()) {
      const next = queue.shift()
      if (next) picked.push(next)
      if (picked.length === limit) break
    }
  }
  return picked.sort(byUrgency)
}

export async function getPreventionAttention(args: {
  worksiteIds: string[] | "all"
  includeActions: boolean
  includeEvaluations: boolean
  includePpa: boolean
  /** Estados sobre los que el rol puede actuar; usa la misma proyección que Mi trabajo. */
  inspectionStatuses?: string[]
  includeCphs?: boolean
  /**
   * EMERGENCIAS-08: eran un solo `includeCompliance`, así que
   * `prevention:hygiene:view` a secas abría también los equipos de emergencia y
   * `prevention:emergency:view` a secas abría los protocolos MINSAL. Cada
   * fuente lleva su propio permiso; el llamador decide cuál enciende.
   */
  /** Reevaluación de protocolos MINSAL — `prevention:hygiene:view`. */
  includeProtocols?: boolean
  /** Vencimiento e inspección de equipos de emergencia — `prevention:emergency:view`. */
  includeEmergencyResources?: boolean
  /**
   * MIPER (§9.1): matrices esperando la firma de la Jefatura del Depto. de
   * Prevención o de Legal y RRHH, ocurrencias del Programa de Trabajo vencidas y
   * bandas Intolerables o Importantes sin ninguna medida con responsable y
   * plazo. Mismo interruptor que las demás fuentes: lo enciende quien tiene
   * `prevention:risk:view` y el módulo está habilitado.
   */
  includeMiper?: boolean
  limit?: number
}): Promise<PreventionAttentionItem[]> {
  if (args.worksiteIds !== "all" && args.worksiteIds.length === 0) return []
  const scope = (column: typeof worksites.id) => args.worksiteIds === "all" ? undefined : inArray(column, args.worksiteIds)
  const limit = args.limit ?? 12
  // Día civil chileno, no UTC: `today` decide el tono `danger` de cada aviso y
  // el corte de la ventana de 30 días. Con `toISOString()` un extintor que vence
  // hoy aparecía vencido desde las 20:00 de la víspera.
  const today = todayInChile()

  const [actionRows = [], evalRows = [], ppaRows = [], inspectionRows = []] = await Promise.all([
    args.includeActions
      // D11: la acción del PDTP se lee de su CAPA, que es donde vive el estado.
      // La faena es columna directa, así que la ejecución ya no hace falta.
      ? db.select({
          id: preventionCapaActions.id, accion: preventionCapaActions.actionDescription,
          responsable: preventionCapaActions.responsibleSnapshot,
          plazo: preventionCapaActions.targetDate, prioridad: preventionCapaActions.priority,
          worksiteId: preventionCapaActions.worksiteId, worksiteName: worksites.name,
        }).from(preventionCapaActions)
          .innerJoin(worksites, eq(preventionCapaActions.worksiteId, worksites.id))
          .where(and(
            scope(worksites.id),
            eq(preventionCapaActions.sourceType, "pdtp"),
            inArray(preventionCapaActions.status, ["pending", "in_progress", "reopened"]),
          ))
          .orderBy(asc(preventionCapaActions.targetDate)).limit(limit)
      : Promise.resolve([]),
    args.includeEvaluations
      ? db.select({ id: sstEvaluations.id, fecha: sstEvaluations.fechaEvaluacion, role: sstEvaluations.evaluatorRole, worksiteName: worksites.name, adminContratoLabel: worksites.adminContratoLabel })
          .from(sstEvaluations).innerJoin(worksites, eq(sstEvaluations.worksiteId, worksites.id))
          .where(and(scope(worksites.id), eq(sstEvaluations.estado, "borrador"))).orderBy(asc(sstEvaluations.fechaEvaluacion)).limit(limit)
      : Promise.resolve([]),
    args.includePpa
      ? db.select({ id: ppaSubmissions.id, workerName: ppaSubmissions.workerName, estado: ppaSubmissions.estado, createdAt: ppaSubmissions.createdAt, worksiteName: worksites.name })
          .from(ppaSubmissions).innerJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
          .where(and(scope(worksites.id), or(eq(ppaSubmissions.estado, "detenido"), eq(ppaSubmissions.estado, "en_correccion"))))
          .orderBy(asc(ppaSubmissions.createdAt)).limit(limit)
      : Promise.resolve([]),
    (args.inspectionStatuses?.length ?? 0) > 0
      ? db.select({
          id: preventionInspectionRuns.id,
          code: preventionInspectionRuns.code,
          status: preventionInspectionRuns.status,
          scheduledFor: preventionInspectionRuns.scheduledFor,
          templateName: preventionInspectionTemplates.name,
          worksiteName: worksites.name,
        })
          .from(preventionInspectionRuns)
          .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
          .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
          .where(and(scope(worksites.id), inArray(preventionInspectionRuns.status, args.inspectionStatuses!)))
          .orderBy(asc(preventionInspectionRuns.scheduledFor), asc(preventionInspectionRuns.createdAt))
          .limit(limit)
      : Promise.resolve([]),
  ])

  const items: PreventionAttentionItem[] = []

  items.push(...actionRows.map((row) => ({
    id: `action:${row.id}`, kind: "action" as const, title: row.accion,
    // La prioridad llega en vocabulario CAPA y esto se imprime tal cual: sin
    // traducir mostraría "Acción high" en una pantalla en español.
    detail: `Acción ${capaPrioridad(row.prioridad)} · ${row.responsable ?? "sin responsable"}`,
    worksiteName: row.worksiteName, dueDate: row.plazo,
    href: `/prevencion/pdtp/acciones?faena=${row.worksiteId}`,
    tone: row.plazo <= today ? "danger" as const : "warning" as const,
  })))

  items.push(...evalRows.map((row) => ({
    id: `evaluation:${row.id}`, kind: "evaluation" as const, title: "Evaluación SST pendiente",
    detail: row.role === "admin_contrato" ? adminContratoLabel(row.adminContratoLabel) : row.role === "conductor_lider" ? "Conductor líder" : "Prevencionista de faena",
    worksiteName: row.worksiteName, dueDate: row.fecha, href: `/prevencion/${row.id}`, tone: "warning" as const,
  })))

  items.push(...ppaRows.map((row) => ({
    id: `ppa:${row.id}`, kind: "ppa" as const, title: `PPA ${row.estado === "detenido" ? "detenido" : "en corrección"}`,
    detail: row.workerName, worksiteName: row.worksiteName, dueDate: row.createdAt.slice(0, 10),
    href: `/prevencion/ppa/${row.id}`, tone: row.estado === "detenido" ? "danger" as const : "warning" as const,
  })))

  items.push(...inspectionRows.map((row) => {
    const needsReview = row.status === "completed"
    const overdue = !needsReview && Boolean(row.scheduledFor && row.scheduledFor < today)
    return {
      id: `inspection:${row.id}`,
      kind: "inspection" as const,
      title: `${needsReview ? "Revisar" : "Ejecutar"} ${row.code}`,
      detail: `${row.templateName} · ${needsReview ? "pendiente de revisión" : row.status === "in_progress" ? "en ejecución" : "planificada"}`,
      worksiteName: row.worksiteName,
      dueDate: row.scheduledFor,
      href: `/prevencion/inspecciones/${row.id}`,
      tone: overdue ? "danger" as const : "warning" as const,
    }
  }))

  if (args.includeCphs) items.push(...await cphsAttentionItems(scope, today, limit))
  if (args.includeMiper) items.push(...await miperAttentionItems(scope, today, limit))
  items.push(...await complianceAttentionItems(scope, today, limit, {
    protocols: args.includeProtocols ?? false,
    emergencyResources: args.includeEmergencyResources ?? false,
  }))

  return pickAttention(items, limit)
}

/**
 * Dos deberes del comité que sólo se notaban leyendo su ficha: el mandato por
 * vencer y la cadencia mensual. La cadencia se calcula con la misma función
 * pura que usa la pantalla del comité, no con una regla paralela en SQL.
 */
async function cphsAttentionItems(
  scope: (column: typeof worksites.id) => ReturnType<typeof inArray> | undefined,
  today: string,
  limit: number,
): Promise<PreventionAttentionItem[]> {
  const committees = await db.select({
    id: preventionCommittees.id,
    name: preventionCommittees.name,
    mandateEndsOn: preventionCommittees.mandateEndsOn,
    createdAt: preventionCommittees.createdAt,
    worksiteName: worksites.name,
  })
    .from(preventionCommittees)
    .innerJoin(worksites, eq(preventionCommittees.worksiteId, worksites.id))
    .where(and(scope(worksites.id), eq(preventionCommittees.status, "active")))
    .limit(limit)
  if (committees.length === 0) return []

  // `heldAt` y no `closedAt`: la cadencia legal cuenta desde que el comité
  // SESIONÓ, no desde que se firmó el acta. El cron y la ficha del comité ya
  // usaban `heldAt`; esta cola quedó atrás y contradecía a las otras dos sobre
  // el mismo comité (un acta de enero firmada en marzo la dejaba "al día").
  const lastMeetings = await db.select({
    committeeId: preventionCommitteeMeetings.committeeId,
    lastClosedAt: max(preventionCommitteeMeetings.heldAt),
  })
    .from(preventionCommitteeMeetings)
    .where(and(
      inArray(preventionCommitteeMeetings.committeeId, committees.map((row) => row.id)),
      eq(preventionCommitteeMeetings.status, "closed"),
    ))
    .groupBy(preventionCommitteeMeetings.committeeId)
  const lastBy = new Map(lastMeetings.map((row) => [row.committeeId, row.lastClosedAt]))

  const now = new Date().toISOString()
  const items: PreventionAttentionItem[] = []

  for (const committee of committees) {
    const href = `/prevencion/cphs/${committee.id}`
    const expired = isMandateExpired(committee.mandateEndsOn, today)
    if (expired || committee.mandateEndsOn <= addDaysIso(today, 60)) {
      items.push({
        id: `cphs:${committee.id}:mandate`, kind: "cphs",
        title: expired ? "Mandato del comité vencido" : "Mandato del comité por vencer",
        detail: committee.name, worksiteName: committee.worksiteName,
        dueDate: committee.mandateEndsOn, href, tone: expired ? "danger" : "warning",
      })
    }

    // Un comité con el mandato vencido ya está reportado arriba; insistir con
    // su cadencia sería contar el mismo problema dos veces.
    if (!expired && assessMeetingCadence(lastBy.get(committee.id) ?? null, now).overdue) {
      items.push({
        id: `cphs:${committee.id}:cadence`, kind: "cphs",
        title: "El comité lleva dos meses o más sin sesionar",
        detail: committee.name, worksiteName: committee.worksiteName,
        dueDate: null, href, tone: "warning",
      })
    }
  }

  return items
}

/**
 * El tipo MIPER (§9.1): lo que espera firma y lo que ya venció.
 *
 * Tres hechos que hasta ahora no aparecían en ninguna bandeja:
 *
 *  · Una MIPER en `in_review` o `pending_approval` está esperando la firma de
 *    una persona concreta: la revisión técnica de la Jefatura del Depto. de
 *    Prevención o la aprobación de Legal y RRHH. Se emiten las dos etapas; cuál
 *    le toca a quien mira lo resuelve el permiso con el que el llamador enciende
 *    la fuente.
 *  · Una ocurrencia `pending` con vencimiento pasado es trabajo que ya debía
 *    estar hecho. El avance del programa se **deriva** de estas filas y nunca se
 *    guarda (`programProgress`, lib/prevention/miper/progress.ts), así que la
 *    única forma de detectarlo es leer `due_on` contra el día civil chileno.
 *  · Una fila Intolerable o Importante sin ninguna medida con responsable y
 *    plazo es exactamente el defecto que deja la matriz sin programa.
 *
 * Ninguna de las tres es una notificación: el aviso a la persona concreta vive
 * en el barrido diario. Acá se emite el pendiente para la portada.
 */
async function miperAttentionItems(
  scope: (column: typeof worksites.id) => ReturnType<typeof inArray> | undefined,
  today: string,
  limit: number,
): Promise<PreventionAttentionItem[]> {
  const [matrices, occurrences, entries] = await Promise.all([
    db.select({
      id: preventionRiskMatrices.id,
      title: preventionRiskMatrices.title,
      period: preventionRiskMatrices.period,
      reviewState: preventionRiskMatrices.reviewState,
      worksiteName: worksites.name,
    })
      .from(preventionRiskMatrices)
      .innerJoin(worksites, eq(preventionRiskMatrices.worksiteId, worksites.id))
      .where(and(
        scope(worksites.id),
        inArray(preventionRiskMatrices.reviewState, ["in_review", "pending_approval"]),
      ))
      .orderBy(asc(preventionRiskMatrices.updatedAt)).limit(limit),
    db.select({
      id: preventionRiskProgramOccurrences.id,
      dueOn: preventionRiskProgramOccurrences.dueOn,
      actionNumber: preventionRiskProgramActions.actionNumber,
      description: preventionRiskProgramActions.description,
      matrixId: preventionRiskPrograms.matrixId,
      worksiteName: worksites.name,
    })
      .from(preventionRiskProgramOccurrences)
      .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
      .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
      .innerJoin(worksites, eq(preventionRiskPrograms.worksiteId, worksites.id))
      .where(and(
        scope(worksites.id),
        eq(preventionRiskProgramActions.status, "active"),
        eq(preventionRiskProgramOccurrences.outcome, "pending"),
        // Vencida es `due_on` anterior al día civil chileno: la misma regla que
        // `programProgress` (una pendiente que vence hoy todavía no lo está).
        lt(preventionRiskProgramOccurrences.dueOn, today),
      ))
      .orderBy(asc(preventionRiskProgramOccurrences.dueOn)).limit(limit),
    db.select({
      id: preventionRiskEntries.id,
      matrixId: preventionRiskEntries.matrixId,
      classification: preventionRiskEntries.classification,
      hazardCode: preventionRiskEntries.hazardCode,
      hazard: preventionRiskEntries.hazard,
      risk: preventionRiskEntries.risk,
      worksiteName: worksites.name,
    })
      .from(preventionRiskEntries)
      .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
      .innerJoin(worksites, eq(preventionRiskMatrices.worksiteId, worksites.id))
      .where(and(
        scope(worksites.id),
        ne(preventionRiskMatrices.status, "superseded"),
        // Las dos bandas que no pueden quedar sin programa (§6.2). La columna es
        // generada desde P×C, así que no hay forma de guardar una incoherente.
        inArray(preventionRiskEntries.classification, ["important", "intolerable"]),
        // «Importante sin medida» y «medida sin responsable o plazo» son el
        // mismo predicado: no tener NINGUNA medida completa. Una actividad
        // retirada ya no ejecuta nada, así que no cuenta como medida.
        sql`NOT EXISTS (
          SELECT 1 FROM ${preventionRiskControls}
          WHERE ${preventionRiskControls.riskEntryId} = ${preventionRiskEntries.id}
            AND ${preventionRiskControls.status} <> 'retired'
            AND ${preventionRiskControls.responsibleUserId} IS NOT NULL
            AND ${preventionRiskControls.dueDate} IS NOT NULL
        )`,
      ))
      .orderBy(asc(preventionRiskEntries.matrixId), asc(preventionRiskEntries.rowNumber)).limit(limit),
  ])

  const items: PreventionAttentionItem[] = []

  for (const row of matrices) {
    const awaitsLegal = row.reviewState === "pending_approval"
    items.push({
      id: `miper_review:${row.id}`, kind: "miper",
      title: awaitsLegal
        ? "MIPER esperando la firma de Legal y RRHH"
        : "MIPER esperando revisión técnica",
      detail: row.period ? `${row.title} · período ${row.period}` : row.title,
      worksiteName: row.worksiteName, dueDate: null,
      href: `/prevencion/miper/${row.id}?tab=revision`,
      tone: "warning",
    })
  }

  for (const row of occurrences) {
    items.push({
      id: `miper_occurrence:${row.id}`, kind: "miper",
      title: `Ocurrencia vencida del programa · N°${row.actionNumber}`,
      // El corte replica el de la cola del PDTP: una actividad se nombra, no se
      // vuelca entera en una fila de bandeja.
      detail: row.description.slice(0, 120),
      worksiteName: row.worksiteName, dueDate: row.dueOn,
      href: `/prevencion/miper/${row.matrixId}?tab=programa&ocurrencia=${row.id}`,
      tone: "danger",
    })
  }

  for (const row of entries) {
    const intolerable = row.classification === "intolerable"
    items.push({
      id: `miper_entry:${row.id}`, kind: "miper",
      title: intolerable
        ? "Riesgo Intolerable sin medida con responsable y plazo"
        : "Riesgo Importante sin medida con responsable y plazo",
      detail: (row.risk ?? row.hazard ?? row.hazardCode).slice(0, 120),
      worksiteName: row.worksiteName, dueDate: null,
      href: `/prevencion/miper/${row.matrixId}?fila=${row.id}`,
      tone: intolerable ? "danger" : "warning",
    })
  }

  return items
}

function addDaysIso(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}


/**
 * Dos relojes que hasta ahora no miraba nadie.
 *
 *  · La reevaluación de un protocolo MINSAL declarado aplicable.
 *  · El vencimiento o la inspección atrasada de un equipo de emergencia
 *    (carga del extintor, caducidad del botiquín).
 *
 * Las dos fechas existían en la base y ninguna consulta las leía: un extintor
 * descargado no aparecía en ninguna pantalla.
 *
 * Cada fuente lleva su propio interruptor porque cada una responde a un permiso
 * distinto (EMERGENCIAS-08). Se consultan sólo las encendidas.
 */
async function complianceAttentionItems(
  scope: (column: typeof worksites.id) => ReturnType<typeof inArray> | undefined,
  today: string,
  limit: number,
  include: { protocols: boolean; emergencyResources: boolean },
): Promise<PreventionAttentionItem[]> {
  if (!include.protocols && !include.emergencyResources) return []
  const soon = addDaysIso(today, 30)

  const [protocols, resources] = await Promise.all([
    include.protocols ? db.select({
      id: preventionProtocolApplicabilities.id,
      protocolCode: preventionProtocolApplicabilities.protocolCode,
      nextAssessmentOn: preventionProtocolApplicabilities.nextAssessmentOn,
      worksiteName: worksites.name,
    })
      .from(preventionProtocolApplicabilities)
      .innerJoin(worksites, eq(preventionProtocolApplicabilities.worksiteId, worksites.id))
      .where(and(
        scope(worksites.id),
        eq(preventionProtocolApplicabilities.status, "applicable"),
        lte(preventionProtocolApplicabilities.nextAssessmentOn, soon),
      ))
      .orderBy(asc(preventionProtocolApplicabilities.nextAssessmentOn)).limit(limit) : [],
    include.emergencyResources ? db.select({
      id: preventionEmergencyResources.id,
      name: preventionEmergencyResources.name,
      kind: preventionEmergencyResources.kind,
      location: preventionEmergencyResources.location,
      nextInspectionAt: preventionEmergencyResources.nextInspectionAt,
      expiresAt: preventionEmergencyResources.expiresAt,
      worksiteName: worksites.name,
    })
      .from(preventionEmergencyResources)
      .innerJoin(worksites, eq(preventionEmergencyResources.worksiteId, worksites.id))
      .where(and(
        scope(worksites.id),
        // Un equipo dado de baja ya no se inspecciona ni se recarga: seguir
        // pidiéndole inspección es ruido. Su ausencia no lo esconde — el
        // contador `resourcesOutOfService` del panel de Emergencias lo cuenta.
        ne(preventionEmergencyResources.status, "out_of_service"),
        or(
          lte(preventionEmergencyResources.expiresAt, soon),
          lte(preventionEmergencyResources.nextInspectionAt, soon),
        ),
      ))
      .orderBy(asc(preventionEmergencyResources.expiresAt)).limit(limit) : [],
  ])

  const items: PreventionAttentionItem[] = []

  for (const row of protocols) {
    if (!row.nextAssessmentOn) continue
    const overdue = row.nextAssessmentOn < today
    items.push({
      id: `protocol:${row.id}`, kind: "protocol",
      title: overdue ? "Reevaluación de protocolo vencida" : "Reevaluación de protocolo por vencer",
      detail: MINSAL_PROTOCOL_LABELS[row.protocolCode] ?? row.protocolCode,
      worksiteName: row.worksiteName,
      dueDate: row.nextAssessmentOn,
      href: "/prevencion/higiene?tab=protocols",
      tone: overdue ? "danger" : "warning",
    })
  }

  for (const row of resources) {
    // El vencimiento del equipo manda sobre la inspección: un extintor
    // inspeccionado pero descargado no sirve.
    const expired = row.expiresAt !== null && row.expiresAt <= soon
    const dueDate = expired ? row.expiresAt : row.nextInspectionAt
    if (!dueDate) continue
    const overdue = dueDate < today
    items.push({
      id: `emergency_resource:${row.id}`, kind: "emergency_resource",
      title: expired
        ? (overdue ? "Equipo de emergencia vencido" : "Equipo de emergencia por vencer")
        : (overdue ? "Inspección de equipo atrasada" : "Inspección de equipo por vencer"),
      detail: `${row.kind} · ${row.name} · ${row.location}`,
      worksiteName: row.worksiteName,
      dueDate,
      href: "/prevencion/emergencias",
      tone: overdue ? "danger" : "warning",
    })
  }

  return items
}
