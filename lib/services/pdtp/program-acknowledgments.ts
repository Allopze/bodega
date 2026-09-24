/**
 * lib/services/pdtp/program-acknowledgments.ts
 *
 * Toma de conocimiento del programa: la difusión del plan (N°2 a gerencias y
 * subgerencias, N°3 en cada faena) se acredita cuando **todo** su padrón abrió
 * el programa vigente en la plataforma. Decisión de la jefatura de prevención
 * del 2026-09-23.
 *
 * Dos reglas que no son obvias:
 *
 * - Sólo cuenta abrir la versión **activa**. Un borrador todavía no es el plan,
 *   y una revisión firmada después es otro plan: la constancia es por
 *   `programId`, así que la v+1 se vuelve a difundir desde cero.
 * - Sólo acredita si la actividad es `enganche` y está activa en esa versión.
 *   El mecanismo es parte del contenido firmado: una versión que todavía la
 *   declara `constancia` (o retirada) se sigue cumpliendo como dice su firma, y
 *   acá sólo se muestra el avance.
 *
 * El padrón se calcula al leer, desde roles y adscripción a faenas: quien entra
 * o sale del cargo entra o sale del padrón sin que nadie lo mantenga a mano.
 */

import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityWorksiteExclusions,
  pdtpProgramAcknowledgments,
  pdtpProgramWorksites,
  pdtpPrograms,
  roles,
  userRoles,
  users,
  worksiteUsers,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { pdtpCatalogActivityIdForLegacyNumber } from "@/lib/services/pdtp-adapters/catalog-activities-2026"
import { recordPdtpFulfillmentEvent } from "./fulfillment"
import { resolveProgramWorksiteIds } from "./worksites"

/** N°2: "Difundir el plan a gerencias y subgerencias". */
export const PDTP_MANAGEMENT_DIFFUSION_ACTIVITY_NUMBER = 2
/** N°3: "Difundir el plan en faenas". */
export const PDTP_WORKSITE_DIFFUSION_ACTIVITY_NUMBER = 3

/** Padrón de la N°2: las gerencias y subgerencias que tienen actividades del programa. */
export const PDTP_MANAGEMENT_DIFFUSION_ROLES = ["gerente_legal_rrhh", "subgerente_operaciones", "jefe_mantencion"] as const
/** Padrón de la N°3: los cargos de faena que responden por actividades del programa. */
export const PDTP_WORKSITE_DIFFUSION_ROLES = ["prevencionista_faena", "jefe_terreno", "supervisor_terreno", "admin_contrato", "cphs"] as const

export type PdtpDiffusionPerson = {
  userId: string
  name: string
  roleLabels: string[]
  acknowledgedAt: string | null
}

export type PdtpDiffusionGroup = {
  activityNumber: 2 | 3
  /** `null` para gerencias: su padrón es corporativo. */
  worksiteId: string | null
  label: string
  people: PdtpDiffusionPerson[]
  acknowledgedCount: number
  complete: boolean
  /** La actividad es `enganche` y está activa en esta versión: completar el padrón la acredita. */
  accredits: boolean
}

export type PdtpProgramDiffusionStatus = {
  programId: string
  programActive: boolean
  /** Faenas del programa: a todas se reparte la N°2, que es corporativa. */
  worksiteIds: string[]
  groups: PdtpDiffusionGroup[]
}

/**
 * Deja constancia de que `userId` abrió el programa. Idempotente: vale la
 * primera vez. Si esa primera vez completa algún padrón, acredita.
 *
 * Devuelve `recorded: false` cuando el programa no es la versión activa.
 */
export async function recordPdtpProgramAcknowledgment(programId: string, userId: string): Promise<{ recorded: boolean }> {
  const [program] = await db.select({ status: pdtpPrograms.status }).from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, programId)).limit(1)
  if (program?.status !== "active") return { recorded: false }

  const inserted = await db.insert(pdtpProgramAcknowledgments).values({
    id: nanoid(),
    programId,
    userId,
    acknowledgedAt: new Date().toISOString(),
  }).onConflictDoNothing().returning({ id: pdtpProgramAcknowledgments.id })

  // Sólo una constancia nueva puede completar un padrón; repetir la visita no
  // cambia nada y no tiene por qué volver a tocar el motor de acreditación.
  if (inserted.length > 0) await accreditCompletedPdtpDiffusions(programId)
  return { recorded: true }
}

/** Padrones de la N°2 y la N°3 de esta versión, con quién tomó conocimiento y cuándo. */
export async function getPdtpProgramDiffusionStatus(programId: string): Promise<PdtpProgramDiffusionStatus | null> {
  const [program] = await db.select({
    id: pdtpPrograms.id,
    status: pdtpPrograms.status,
    appliesToAllWorksites: pdtpPrograms.appliesToAllWorksites,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null

  const [activities, memberships, activeWorksites, acknowledgments, people] = await Promise.all([
    db.select({ id: pdtpActivities.id, n: pdtpActivities.n, status: pdtpActivities.status, mechanism: pdtpActivities.mechanism })
      .from(pdtpActivities)
      .where(and(
        eq(pdtpActivities.programId, programId),
        inArray(pdtpActivities.n, [PDTP_MANAGEMENT_DIFFUSION_ACTIVITY_NUMBER, PDTP_WORKSITE_DIFFUSION_ACTIVITY_NUMBER]),
      )),
    db.select({ worksiteId: pdtpProgramWorksites.worksiteId }).from(pdtpProgramWorksites)
      .where(and(eq(pdtpProgramWorksites.programId, programId), eq(pdtpProgramWorksites.isActive, true))),
    db.select({ id: worksites.id, name: worksites.name }).from(worksites)
      .where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.select({ userId: pdtpProgramAcknowledgments.userId, acknowledgedAt: pdtpProgramAcknowledgments.acknowledgedAt })
      .from(pdtpProgramAcknowledgments).where(eq(pdtpProgramAcknowledgments.programId, programId)),
    db.select({ userId: users.id, name: users.name, roleName: roles.name, roleLabel: roles.label })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(
        eq(users.isActive, true),
        inArray(roles.name, [...PDTP_MANAGEMENT_DIFFUSION_ROLES, ...PDTP_WORKSITE_DIFFUSION_ROLES]),
      ))
      .orderBy(asc(users.name)),
  ])

  const byN = new Map(activities.map((activity) => [activity.n, activity]))
  const ackAt = new Map(acknowledgments.map((row) => [row.userId, row.acknowledgedAt]))
  const worksiteIds = resolveProgramWorksiteIds(
    memberships.map((row) => row.worksiteId), "all", activeWorksites.map((row) => row.id), program.appliesToAllWorksites,
  )
  const worksiteSiteUsers = worksiteIds.length > 0
    ? await db.select({ userId: worksiteUsers.userId, worksiteId: worksiteUsers.worksiteId }).from(worksiteUsers)
      .where(inArray(worksiteUsers.worksiteId, worksiteIds))
    : []
  const worksiteActivity = byN.get(PDTP_WORKSITE_DIFFUSION_ACTIVITY_NUMBER)
  const excluded = worksiteActivity
    ? new Set((await db.select({ worksiteId: pdtpActivityWorksiteExclusions.worksiteId }).from(pdtpActivityWorksiteExclusions)
      .where(eq(pdtpActivityWorksiteExclusions.activityId, worksiteActivity.id))).map((row) => row.worksiteId))
    : new Set<string>()

  const accredits = (n: number) => {
    const activity = byN.get(n)
    return activity?.status === "active" && activity.mechanism === "enganche"
  }
  const roster = (roleNames: readonly string[], allow: (userId: string) => boolean): PdtpDiffusionPerson[] => {
    const byUser = new Map<string, PdtpDiffusionPerson>()
    for (const row of people) {
      if (!roleNames.includes(row.roleName) || !allow(row.userId)) continue
      const person = byUser.get(row.userId)
      if (person) {
        if (!person.roleLabels.includes(row.roleLabel)) person.roleLabels.push(row.roleLabel)
      } else {
        byUser.set(row.userId, { userId: row.userId, name: row.name, roleLabels: [row.roleLabel], acknowledgedAt: ackAt.get(row.userId) ?? null })
      }
    }
    return [...byUser.values()]
  }
  const group = (activityNumber: 2 | 3, worksiteId: string | null, label: string, members: PdtpDiffusionPerson[]): PdtpDiffusionGroup => {
    const acknowledgedCount = members.filter((person) => person.acknowledgedAt).length
    return {
      activityNumber,
      worksiteId,
      label,
      people: members,
      acknowledgedCount,
      // Un padrón vacío no está completo: nadie recibió la difusión.
      complete: members.length > 0 && acknowledgedCount === members.length,
      accredits: accredits(activityNumber),
    }
  }

  const worksiteName = new Map(activeWorksites.map((row) => [row.id, row.name]))
  const groups: PdtpDiffusionGroup[] = []
  if (byN.has(PDTP_MANAGEMENT_DIFFUSION_ACTIVITY_NUMBER)) {
    groups.push(group(2, null, "Gerencias y subgerencias", roster(PDTP_MANAGEMENT_DIFFUSION_ROLES, () => true)))
  }
  if (worksiteActivity) {
    for (const worksiteId of worksiteIds) {
      if (excluded.has(worksiteId)) continue
      const assigned = new Set(worksiteSiteUsers.filter((row) => row.worksiteId === worksiteId).map((row) => row.userId))
      groups.push(group(3, worksiteId, worksiteName.get(worksiteId) ?? worksiteId, roster(PDTP_WORKSITE_DIFFUSION_ROLES, (id) => assigned.has(id))))
    }
  }
  return { programId, programActive: program.status === "active", worksiteIds, groups }
}

/**
 * Acredita cada padrón completo. La N°2 es corporativa y el cumplimiento del
 * programa es por faena, así que se reparte a todas las faenas del programa,
 * igual que la N°1 (`onPdtpProgramLegallyApproved`).
 *
 * Idempotente por la clave del motor: el `sourceId` nombra el padrón, y
 * reintentar uno ya acreditado devuelve la ejecución existente.
 */
async function accreditCompletedPdtpDiffusions(programId: string): Promise<void> {
  const status = await getPdtpProgramDiffusionStatus(programId)
  if (!status?.programActive) return

  for (const item of status.groups) {
    if (!item.complete || !item.accredits) continue
    // El padrón se completó con la última constancia: ése es el hecho.
    const occurredAt = item.people.map((person) => person.acknowledgedAt!).sort().at(-1)!
    const targets = item.worksiteId ? [item.worksiteId] : status.worksiteIds
    for (const worksiteId of targets) {
      await recordPdtpFulfillmentEvent({
        sourceType: "toma_conocimiento",
        sourceId: item.worksiteId ? `programa:${programId}:faena:${item.worksiteId}` : `programa:${programId}:gerencias`,
        worksiteId,
        programId,
        catalogActivityIds: [pdtpCatalogActivityIdForLegacyNumber(item.activityNumber)],
        occurredAt,
        executedQuantity: 1,
        evidenceRef: `Toma de conocimiento del programa: ${item.people.length} de ${item.people.length} (${item.label}).`,
        metadata: { acknowledgedUserIds: item.people.map((person) => person.userId) },
      })
    }
  }
}
