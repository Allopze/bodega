/**
 * Materialización de ejecuciones desde la programación de inspecciones.
 *
 * Antes de esto, `prevention_inspection_programs` era un calendario decorativo:
 * el índice `prevention_inspection_program_due_idx` sobre `(next_due_on,
 * is_active)` existía para este barrido y nadie lo leía, `program_id` no lo
 * enviaba ningún formulario, y `next_due_on` sólo avanzaba al completar una
 * ejecución que jamás se vinculaba a su programa. Resultado: toda programación
 * quedaba vencida para siempre y el KPI "Programaciones vencidas" sólo crecía
 * (B-04, auditoría 2026-08-18).
 *
 * Dos entradas, una sola lógica: el cron diario (barrido completo) y el botón
 * "Ejecutar ahora" del catálogo (un programa). No hay dos caminos de creación.
 */
import { and, eq, inArray, isNull, lte } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionInspectionFindings,
  preventionInspectionPrograms,
  preventionInspectionRuns,
  preventionInspectionTemplates,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { nextDueAfter } from "@/lib/prevention/inspections"
import { createNotifications } from "@/lib/services/notifications"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { codeYear, todayInChile } from "@/lib/utils"

export interface MaterializeResult {
  /** Programas vencidos considerados en esta corrida. */
  examined: number
  created: number
  /** Ya existía la ejecución de ese slot (reintento del cron el mismo día). */
  skippedDuplicate: number
  /** La plantilla dejó de estar aprobada: un fallo de datos que hay que ver. */
  skippedTemplate: number
  errors: number
}

/** Tope por corrida: una cota explícita vale más que un timeout de plataforma. */
const MAX_PROGRAMS_PER_RUN = 500

export async function materializeProgramRuns(options: { programId?: string } = {}): Promise<MaterializeResult> {
  const today = todayInChile()
  const result: MaterializeResult = { examined: 0, created: 0, skippedDuplicate: 0, skippedTemplate: 0, errors: 0 }

  const due = await db.select({
    program: preventionInspectionPrograms,
    templateStatus: preventionInspectionTemplates.status,
    templateName: preventionInspectionTemplates.name,
  })
    .from(preventionInspectionPrograms)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionPrograms.templateId))
    .where(options.programId
      // "Ejecutar ahora" no exige vencimiento: es una ejecución bajo demanda.
      ? eq(preventionInspectionPrograms.id, options.programId)
      : and(
          eq(preventionInspectionPrograms.isActive, true),
          lte(preventionInspectionPrograms.nextDueOn, today),
        ))
    .limit(MAX_PROGRAMS_PER_RUN)

  for (const row of due) {
    const { program } = row
    // `on_demand` no tiene cadencia: sólo nace por el botón.
    if (!options.programId && program.frequency === "on_demand") continue
    if (!program.isActive) continue
    result.examined += 1

    try {
      if (row.templateStatus !== "approved") {
        result.skippedTemplate += 1
        // Un programa apuntando a una plantilla reemplazada deja de producir
        // evidencia en silencio: es exactamente lo que hay que avisar.
        await notifyWorksite(program.worksiteId, {
          title: "Programación de inspección detenida",
          body: `La plantilla "${row.templateName}" ya no está aprobada, así que no se generó la inspección programada para el ${program.nextDueOn}.`,
          entityId: program.id,
          dedupeKey: `inspection:program-template:${program.id}:${program.nextDueOn}`,
          href: "/prevencion/inspecciones/catalogo",
        })
        continue
      }

      const scheduledFor = program.nextDueOn
      const created = await db.transaction(async (tx) => {
        const [inserted] = await tx.insert(preventionInspectionRuns).values({
          id: `insrun-${nanoid()}`,
          code: `INSP-${codeYear()}-${nanoid(8).toUpperCase()}`,
          templateId: program.templateId,
          programId: program.id,
          worksiteId: program.worksiteId,
          subjectType: program.subjectType,
          // El sujeto del programa no se propagaba: un programa "el extintor
          // del pañol" o "el camión KA-122" producía runs sin sujeto, y la
          // ejecución quedaba sin saber qué inspeccionar.
          subjectResourceId: program.subjectResourceId,
          subjectVehicleId: program.subjectVehicleId,
          scheduledFor,
          status: "planned",
          assignedToUserId: program.assignedToUserId,
          // El cron no tiene sesión: el actor es quien creó el programa, que es
          // un usuario real y referenciable por la FK.
          createdByUserId: program.createdByUserId,
        })
          // Idempotencia por el slot `(program_id, scheduled_for)`: dos disparos
          // del cron el mismo día no duplican la ejecución.
          .onConflictDoNothing()
          .returning()

        if (!inserted) return null

        // El `nextDueOn` lo mueve SÓLO este materializador (D-3): avanzarlo
        // también al completar contaba dos veces el mismo ciclo.
        await tx.update(preventionInspectionPrograms).set({
          nextDueOn: nextDueAfter(scheduledFor, program.intervalDays, today),
          updatedAt: new Date().toISOString(),
        }).where(eq(preventionInspectionPrograms.id, program.id))

        await recordOperationalActivity({
          eventType: "inspection.scheduled",
          module: "inspecciones",
          entityType: "inspection_run",
          entityId: inserted.id,
          entityCode: inserted.code,
          worksiteId: inserted.worksiteId,
          actorUserId: program.createdByUserId,
          payload: { programId: program.id, scheduledFor },
        }, tx)

        return inserted
      })

      if (!created) { result.skippedDuplicate += 1; continue }
      result.created += 1

      if (created.assignedToUserId) {
        await createNotifications([created.assignedToUserId], {
          type: "system_alert",
          title: "Inspección programada asignada",
          body: `${row.templateName} vence el ${scheduledFor}.`,
          entityType: "inspection_run",
          entityId: created.id,
          entityHref: `/prevencion/inspecciones/${created.id}`,
          dedupeKey: `inspection:assigned:${created.id}:${created.assignedToUserId}`,
        })
      }
    } catch (error) {
      // Un programa que falla no puede detener el barrido: el resto sigue.
      result.errors += 1
      logger.error({ err: error, programId: program.id }, "[inspection-scheduler] no se pudo materializar la programación")
    }
  }

  return result
}

/**
 * Aviso 4 (A-08): hallazgo alto o crítico sin acción correctiva pasadas 48 h.
 *
 * `assessRunReview` impide cerrar la inspección mientras exista, así que sin
 * este aviso el atasco es silencioso: la inspección queda esperando revisión y
 * nadie sabe que falta derivar la acción.
 */
const CRITICAL_FINDING_GRACE_HOURS = 48

export async function alertCriticalFindingsWithoutCapa(): Promise<{ alerted: number }> {
  const cutoff = new Date(Date.now() - CRITICAL_FINDING_GRACE_HOURS * 3_600_000).toISOString()
  const stale = await db.select({
    findingId: preventionInspectionFindings.id,
    description: preventionInspectionFindings.description,
    criticality: preventionInspectionFindings.criticality,
    runId: preventionInspectionRuns.id,
    runCode: preventionInspectionRuns.code,
    worksiteId: preventionInspectionRuns.worksiteId,
  })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .where(and(
      isNull(preventionInspectionFindings.capaActionId),
      eq(preventionInspectionFindings.status, "open"),
      inArray(preventionInspectionFindings.criticality, ["high", "critical"]),
      lte(preventionInspectionFindings.createdAt, cutoff),
      eq(preventionInspectionRuns.status, "completed"),
    ))
    .limit(MAX_PROGRAMS_PER_RUN)

  let alerted = 0
  for (const finding of stale) {
    try {
      const userIds = await getUserIdsWithPermissionForWorksite("prevention:inspections:execute", finding.worksiteId)
      if (userIds.length === 0) continue
      await createNotifications(userIds, {
        type: "system_alert",
        title: "Hallazgo grave sin acción correctiva",
        body: `${finding.runCode}: "${finding.description}" lleva más de ${CRITICAL_FINDING_GRACE_HOURS} h sin CAPA, y la inspección no puede cerrarse hasta que la tenga.`,
        entityType: "inspection_run",
        entityId: finding.runId,
        entityHref: `/prevencion/inspecciones/${finding.runId}`,
        // Sin fecha en la clave: se avisa UNA vez por hallazgo. Con fecha, el
        // barrido diario repetiría el mismo aviso indefinidamente.
        dedupeKey: `inspection:finding-no-capa:${finding.findingId}`,
      })
      alerted += 1
    } catch (error) {
      logger.error({ err: error, findingId: finding.findingId }, "[inspection-scheduler] no se pudo alertar el hallazgo sin CAPA")
    }
  }
  return { alerted }
}

async function notifyWorksite(worksiteId: string, args: {
  title: string
  body: string
  entityId: string
  dedupeKey: string
  href: string
}) {
  const userIds = await getUserIdsWithPermissionForWorksite("prevention:inspections:execute", worksiteId)
  if (userIds.length === 0) return
  await createNotifications(userIds, {
    type: "system_alert",
    title: args.title,
    body: args.body,
    entityType: "inspection_program",
    entityId: args.entityId,
    entityHref: args.href,
    dedupeKey: args.dedupeKey,
  })
}
