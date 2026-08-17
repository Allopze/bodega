import { and, eq, inArray, max } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionCommitteeMeetings,
  preventionCommitteeProgramActivities,
  preventionCommitteePrograms,
  preventionCommittees,
} from "@/db/schema"
import { assessMeetingCadence, isMandateExpired } from "@/lib/prevention/cphs"
import { activityDeadline } from "@/lib/prevention/cphs-program"
import { expireLapsedCommittees } from "@/lib/services/prevention-cphs"
import {
  createNotifications,
  getUserIdsWithPermissionForWorksite,
} from "@/lib/services/notifications"
import { todayInChile } from "@/lib/utils"

export interface CphsReminderResult {
  expiredCommittees: number
  mandateWarnings: number
  cadenceWarnings: number
  overdueActivities: number
  notifiedUsers: number
}

/** Avisos escalonados: a 60, 30 y 7 días el mensaje cambia y el dedupe también. */
const MANDATE_WARNING_DAYS = [60, 30, 7] as const

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function selectMandateWarningThreshold(mandateEndsOn: string, today: string): 60 | 30 | 7 | null {
  return [...MANDATE_WARNING_DAYS]
    .reverse()
    .find((days) => mandateEndsOn <= addDays(today, days)) ?? null
}

/**
 * Job diario del comité paritario. Cubre tres deberes que hasta ahora sólo se
 * veían entrando a la pantalla: renovar el mandato antes de que venza, sesionar
 * cada mes y ejecutar el programa de trabajo.
 *
 * También es el único llamador de `expireLapsedCommittees`, que existía sin que
 * nadie la invocara fuera de su test: sin esto un comité con mandato vencido se
 * quedaba en `active` para siempre.
 */
export async function runPreventionCphsReminders(): Promise<CphsReminderResult> {
  const { expired } = await expireLapsedCommittees()

  const committees = await db.select({
    id: preventionCommittees.id,
    name: preventionCommittees.name,
    worksiteId: preventionCommittees.worksiteId,
    mandateEndsOn: preventionCommittees.mandateEndsOn,
  }).from(preventionCommittees).where(eq(preventionCommittees.status, "active"))

  const today = todayInChile()
  const now = new Date().toISOString()
  const notified = new Set<string>()
  let mandateWarnings = 0
  let cadenceWarnings = 0
  let overdueActivities = 0

  if (committees.length === 0) {
    return { expiredCommittees: expired, mandateWarnings, cadenceWarnings, overdueActivities, notifiedUsers: 0 }
  }

  const committeeIds = committees.map((row) => row.id)

  // Una consulta por faena, no una por comité: varias faenas repiten manager.
  const managersByWorksite = new Map<string, string[]>()
  await Promise.all([...new Set(committees.map((row) => row.worksiteId))].map(async (worksiteId) => {
    managersByWorksite.set(worksiteId, await getUserIdsWithPermissionForWorksite("prevention:cphs:manage", worksiteId))
  }))

  const [lastMeetings, activities] = await Promise.all([
    // `heldAt` y no `closedAt`: la cadencia mide cuándo SESIONÓ el comité, no
    // cuándo se firmó el acta. Con `closedAt` este job y la pantalla (que ya
    // usaba `heldAt`) contestaban distinto sobre el mismo comité — el acta de
    // enero firmada en marzo lo daba al día en marzo.
    db.select({
      committeeId: preventionCommitteeMeetings.committeeId,
      lastHeldAt: max(preventionCommitteeMeetings.heldAt),
    })
      .from(preventionCommitteeMeetings)
      .where(and(
        inArray(preventionCommitteeMeetings.committeeId, committeeIds),
        eq(preventionCommitteeMeetings.status, "closed"),
      ))
      .groupBy(preventionCommitteeMeetings.committeeId),
    db.select({
      activity: preventionCommitteeProgramActivities,
      programYear: preventionCommitteePrograms.year,
      committeeId: preventionCommitteePrograms.committeeId,
    })
      .from(preventionCommitteeProgramActivities)
      .innerJoin(preventionCommitteePrograms, eq(preventionCommitteePrograms.id, preventionCommitteeProgramActivities.programId))
      .where(and(
        inArray(preventionCommitteePrograms.committeeId, committeeIds),
        eq(preventionCommitteePrograms.status, "active"),
        eq(preventionCommitteeProgramActivities.status, "planned"),
      )),
  ])
  const lastBy = new Map(lastMeetings.map((row) => [row.committeeId, row.lastHeldAt]))
  const committeeById = new Map(committees.map((committee) => [committee.id, committee]))

  for (const committee of committees) {
    const managers = managersByWorksite.get(committee.worksiteId) ?? []
    if (managers.length === 0) continue
    const href = `/prevencion/cphs/${committee.id}`

    // El umbral más cercano que ya se cruzó manda: a 25 días avisa "30", no "60".
    const threshold = selectMandateWarningThreshold(committee.mandateEndsOn, today)
    if (threshold && !isMandateExpired(committee.mandateEndsOn, today)) {
      mandateWarnings++
      managers.forEach((id) => notified.add(id))
      await createNotifications(managers, {
        type: "system_alert",
        title: `Mandato del comité por vencer: ${committee.name}`,
        body: `El mandato termina el ${committee.mandateEndsOn}. Convoca la elección de la nueva directiva antes de esa fecha.`,
        entityType: "prevention_committee",
        entityId: committee.id,
        entityHref: href,
        dedupeKey: `cphs-mandate:${committee.id}:${committee.mandateEndsOn}:${threshold}`,
      })
    }

    const cadence = assessMeetingCadence(lastBy.get(committee.id) ?? null, now)
    if (cadence.overdue) {
      cadenceWarnings++
      managers.forEach((id) => notified.add(id))
      await createNotifications(managers, {
        type: "system_alert",
        title: `El comité no sesiona hace dos meses o más: ${committee.name}`,
        body: "El comité debe sesionar al menos una vez al mes. Convoca la sesión ordinaria pendiente.",
        entityType: "prevention_committee",
        entityId: committee.id,
        entityHref: href,
        // Por mes: reavisa cada mes que siga sin sesionar, no todos los días.
        dedupeKey: `cphs-cadence:${committee.id}:${today.slice(0, 7)}`,
      })
    }
  }

  for (const row of activities) {
    if (activityDeadline(row.activity, row.programYear) >= today) continue
    const committee = committeeById.get(row.committeeId)
    if (!committee) continue
    const managers = managersByWorksite.get(committee.worksiteId) ?? []
    if (managers.length === 0) continue

    overdueActivities++
    managers.forEach((id) => notified.add(id))
    await createNotifications(managers, {
      type: "system_alert",
      title: `Actividad del programa atrasada: ${row.activity.title}`,
      body: `La actividad venció el ${activityDeadline(row.activity, row.programYear)} y sigue planificada. Ciérrala con su evidencia o cancélala con motivo.`,
      entityType: "prevention_committee_program_activity",
      entityId: row.activity.id,
      entityHref: `/prevencion/cphs/${committee.id}/programa?programa=${row.activity.programId}`,
      dedupeKey: `cphs-activity:${row.activity.id}:${today.slice(0, 7)}`,
    })
  }

  return {
    expiredCommittees: expired,
    mandateWarnings,
    cadenceWarnings,
    overdueActivities,
    notifiedUsers: notified.size,
  }
}
