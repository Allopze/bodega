/**
 * lib/services/pdtp/assignees.ts
 *
 * Asignación NOMINAL de actividades del programa preventivo: quién, con nombre
 * y apellido, responde por una actividad en una faena concreta.
 *
 * El programa firmado nombra el CARGO ("Jefe de terreno"), y así debe seguir:
 * el documento tiene que sobrevivir a la rotación de personas. Lo que faltaba
 * era la capa de operación encima: con dos jefes de terreno en la misma faena,
 * `/pendientes` le mostraba la misma fila a los dos y ninguno sabía si era
 * suya.
 *
 * Tres decisiones que conviene tener a la vista antes de tocar este archivo:
 *
 * 1. **No entra en la huella firmada** (`content-digest.ts`). Asignar no es un
 *    cambio de contenido y no abre una revisión v+1, igual que los overrides de
 *    meta por faena y los desvíos por celda. Su rastro vive en
 *    `pdtp_change_log`, sección `assignee:{n}`.
 *
 * 2. **Cambia la visibilidad**, y por eso el permiso es propio
 *    (`prevention:pdtp:assignee:manage`). Con un asignado vigente, los demás
 *    usuarios del mismo rol dejan de ver esa fila en la cola operacional. Es
 *    intencional —es el punto de asignar— pero significa que asignar mal deja
 *    trabajo invisible para todos menos uno. Sin asignado vigente la
 *    visibilidad por rol queda exactamente como antes de esta fase.
 *
 * 3. **Vigencia por fecha, no por bandera.** Sacar a alguien cierra su fila
 *    (`valid_until`), no la borra. Quién era el responsable en la semana que
 *    pregunta el fiscalizador es justamente lo que un DELETE haría imposible de
 *    contestar. Todo se resuelve en fecha de Chile (`todayInChile`): un corte
 *    en UTC movería el día de entrada en vigencia entre las 20:00 y la
 *    medianoche.
 *
 * **Mes cerrado**: esta escritura NO pasa por `assertPdtpPeriodOpen`, a
 * diferencia de ejecuciones, desvíos y overrides. No es una omisión: una
 * asignación no tiene mes. No toca lo planificado ni lo ejecutado de ningún
 * período, y la foto congelada del cierre resuelve sus asignados a la fecha de
 * corte de ese mes —que ya pasó—, así que nombrar hoy a un responsable no puede
 * alterar un mes cerrado. Bloquearla obligaría a reabrir un mes cerrado para
 * poder nombrar al responsable del mes en curso.
 */

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityExecutorAssignments,
  pdtpActivityWorksiteAssignees,
  pdtpPrograms,
  pdtpResponsibleCatalog,
  roles,
  userRoles,
  users,
  worksiteUsers,
  type PdtpActivityWorksiteAssignee,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"
import {
  addPdtpChangeLogEntry,
  assertWorksiteAccess,
  isActivePdtpWorksite,
  type WorksiteScope,
} from "./helpers"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"

export type PdtpActivityAssignee = {
  activityId: string
  userId: string
  userName: string
  /** Rol con el que se ofreció a la persona como candidata. Informativo. */
  roleLabel: string | null
  validFrom: string
  validUntil: string | null
}

export type PdtpAssigneeCandidate = {
  userId: string
  name: string
  roleLabels: string[]
}

export type PdtpSetAssigneesInput = {
  activityId: string
  worksiteId: string
  userIds: string[]
  /** Día en que empieza a regir la nueva nómina. Default: hoy en Chile. */
  validFrom?: string
  note?: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Día anterior a una fecha `YYYY-MM-DD`, en el calendario civil (sin husos). */
function previousDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() - 1)
  return parsed.toISOString().slice(0, 10)
}

/**
 * Condición SQL de "vigente en esta fecha": empezó y no ha terminado.
 *
 * Una asignación con `valid_from` futuro todavía no rige — y eso importa más de
 * lo que parece, porque mientras no rija la fila la sigue viendo el rol
 * completo, que es el comportamiento anterior a esta fase.
 */
function currentAt(date: string) {
  return and(
    lte(pdtpActivityWorksiteAssignees.validFrom, date),
    or(
      isNull(pdtpActivityWorksiteAssignees.validUntil),
      sql`${pdtpActivityWorksiteAssignees.validUntil} >= ${date}`,
    ),
  )
}

/**
 * Asignados vigentes de todas las actividades de un programa en una faena.
 *
 * `asOf` (día civil chileno, `YYYY-MM-DD`) es lo que hace reproducible la foto
 * del cierre mensual: preguntar por el 31 de marzo devuelve siempre a quien era
 * el responsable el 31 de marzo, aunque hoy sea otro, porque las vigencias se
 * cierran en vez de borrarse.
 */
export async function listPdtpActivityAssignees(
  programId: string,
  worksiteId: string,
  opts?: { asOf?: string },
): Promise<PdtpActivityAssignee[]> {
  const asOf = normalizeDate(opts?.asOf) ?? todayInChile()
  const rows = await db
    .select({
      activityId: pdtpActivityWorksiteAssignees.activityId,
      userId: pdtpActivityWorksiteAssignees.userId,
      userName: users.name,
      roleLabel: roles.label,
      validFrom: pdtpActivityWorksiteAssignees.validFrom,
      validUntil: pdtpActivityWorksiteAssignees.validUntil,
    })
    .from(pdtpActivityWorksiteAssignees)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpActivityWorksiteAssignees.activityId))
    .innerJoin(users, eq(users.id, pdtpActivityWorksiteAssignees.userId))
    .leftJoin(roles, eq(roles.id, pdtpActivityWorksiteAssignees.roleId))
    .where(and(
      eq(pdtpActivities.programId, programId),
      eq(pdtpActivityWorksiteAssignees.worksiteId, worksiteId),
      currentAt(asOf),
    ))
    .orderBy(asc(pdtpActivityWorksiteAssignees.activityId), asc(users.name))
  return rows.map((row) => ({ ...row, roleLabel: row.roleLabel ?? null }))
}

/** Asignados vigentes de UNA celda actividad × faena en una fecha dada. */
export async function resolvePdtpAssigneesForCell(
  activityId: string,
  worksiteId: string,
  date: string,
): Promise<Array<{ userId: string; userName: string }>> {
  const asOf = normalizeDate(date) ?? todayInChile()
  return db
    .select({ userId: pdtpActivityWorksiteAssignees.userId, userName: users.name })
    .from(pdtpActivityWorksiteAssignees)
    .innerJoin(users, eq(users.id, pdtpActivityWorksiteAssignees.userId))
    .where(and(
      eq(pdtpActivityWorksiteAssignees.activityId, activityId),
      eq(pdtpActivityWorksiteAssignees.worksiteId, worksiteId),
      currentAt(asOf),
    ))
    .orderBy(asc(users.name))
}

/**
 * Roles que pueden responder por una actividad: los del catálogo de
 * responsables declarados en la actividad (`roleName` y el `operatedByRoleName`
 * de D21, que es quien opera la plataforma por un responsable sin cuenta) más
 * los ejecutores acreditadores asignados a la actividad.
 *
 * Es la MISMA unión que usa la cola operacional para decidir a qué rol le toca
 * la fila. Si acá se abriera más, se podría asignar a alguien que después no ve
 * nada en `/pendientes`.
 */
async function candidateRoleIds(activityId: string): Promise<string[]> {
  const [activity] = await db
    .select({ responsibleSlugs: pdtpActivities.responsibleSlugs })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.id, activityId))
    .limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")
  const slugs = Array.isArray(activity.responsibleSlugs) ? activity.responsibleSlugs as string[] : []

  const [catalogRows, executorRows] = await Promise.all([
    slugs.length > 0
      ? db.select({
          roleName: pdtpResponsibleCatalog.roleName,
          operatedByRoleName: pdtpResponsibleCatalog.operatedByRoleName,
        })
        .from(pdtpResponsibleCatalog)
        .where(and(
          inArray(pdtpResponsibleCatalog.slug, slugs),
          eq(pdtpResponsibleCatalog.isActive, true),
        ))
      : Promise.resolve([] as Array<{ roleName: string | null; operatedByRoleName: string | null }>),
    db.select({ roleId: pdtpActivityExecutorAssignments.roleId })
      .from(pdtpActivityExecutorAssignments)
      .where(eq(pdtpActivityExecutorAssignments.activityId, activityId)),
  ])

  const roleNames = new Set<string>()
  for (const row of catalogRows) {
    if (row.roleName) roleNames.add(row.roleName)
    if (row.operatedByRoleName) roleNames.add(row.operatedByRoleName)
  }

  const roleIds = new Set(executorRows.map((row) => row.roleId))
  if (roleNames.size > 0) {
    const namedRoles = await db.select({ id: roles.id })
      .from(roles)
      .where(inArray(roles.name, [...roleNames]))
    for (const role of namedRoles) roleIds.add(role.id)
  }
  return [...roleIds]
}

/**
 * Personas que pueden recibir esta actividad en esta faena: cuentas activas con
 * alguno de los roles candidatos, que además estén adscritas a la faena o
 * tengan un rol global (los roles globales operan todas las faenas, así que
 * excluirlos dejaría fuera a la jefatura que sí puede hacerse cargo).
 */
export async function listPdtpAssigneeCandidates(
  activityId: string,
  worksiteId: string,
): Promise<PdtpAssigneeCandidate[]> {
  const roleIds = await candidateRoleIds(activityId)
  if (roleIds.length === 0) return []

  const rows = await db
    .select({ userId: users.id, name: users.name, roleLabel: roles.label })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(
      eq(users.isActive, true),
      inArray(userRoles.roleId, roleIds),
      or(
        sql`EXISTS (
          SELECT 1 FROM ${worksiteUsers}
          WHERE ${worksiteUsers.userId} = ${users.id} AND ${worksiteUsers.worksiteId} = ${worksiteId}
        )`,
        sql`EXISTS (
          SELECT 1 FROM ${userRoles} AS global_ur
          INNER JOIN ${roles} AS global_role ON global_role.id = global_ur.role_id
          WHERE global_ur.user_id = ${users.id} AND global_role.is_global
        )`,
      ),
    ))
    .orderBy(asc(users.name))

  const byUser = new Map<string, PdtpAssigneeCandidate>()
  for (const row of rows) {
    const existing = byUser.get(row.userId)
    if (existing) {
      if (!existing.roleLabels.includes(row.roleLabel)) existing.roleLabels.push(row.roleLabel)
    } else {
      byUser.set(row.userId, { userId: row.userId, name: row.name, roleLabels: [row.roleLabel] })
    }
  }
  return [...byUser.values()]
}

/**
 * Fija la nómina completa de asignados de una actividad en una faena.
 *
 * Es un `set`, no un `add`: lo que no viene en `userIds` sale. Salir cierra la
 * vigencia (`valid_until = validFrom − 1 día`), no borra la fila.
 *
 * Los candidatos se revalidan **en el servidor**. Que la UI sólo haya ofrecido
 * los correctos no es garantía de nada: asignar a alguien sin rol compatible le
 * daría la fila en `/pendientes` y se la quitaría a quien sí podía hacerla.
 */
export async function setPdtpActivityAssignees(
  input: PdtpSetAssigneesInput,
  userId: string,
  scope: WorksiteScope,
): Promise<void> {
  assertWorksiteAccess(input.worksiteId, scope)
  if (!await isActivePdtpWorksite(input.worksiteId)) {
    throw new Error("La faena no existe o está inactiva.")
  }

  const [activity] = await db
    .select({ programId: pdtpActivities.programId, n: pdtpActivities.n, status: pdtpActivities.status })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.id, input.activityId))
    .limit(1)
  if (!activity) throw new Error("Actividad PDTP no encontrada.")
  if (activity.status !== "active") {
    throw new Error("La actividad está retirada y no admite asignaciones nuevas.")
  }

  const [program] = await db
    .select({ status: pdtpPrograms.status, version: pdtpPrograms.version })
    .from(pdtpPrograms)
    .where(eq(pdtpPrograms.id, activity.programId))
    .limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.status !== "active") {
    throw new Error("Solo se pueden asignar actividades de programas PDTP en estado activo.")
  }
  await assertPdtpWorksiteCanOperateProgram(activity.programId, input.worksiteId)

  const validFrom = normalizeDate(input.validFrom) ?? todayInChile()
  const wanted = [...new Set(input.userIds.filter((id) => id.trim().length > 0))]

  // Candidatos: se valida contra la lista real, no contra lo que dijo el
  // cliente. Un `userId` que no esté ahí se rechaza con nombre propio cuando se
  // puede, para que el mensaje sirva en faena.
  const candidates = await listPdtpAssigneeCandidates(input.activityId, input.worksiteId)
  const candidateById = new Map(candidates.map((candidate) => [candidate.userId, candidate]))
  for (const wantedId of wanted) {
    if (!candidateById.has(wantedId)) {
      const [person] = await db.select({ name: users.name }).from(users).where(eq(users.id, wantedId)).limit(1)
      throw new Error(
        person
          ? `${person.name} no puede recibir esta actividad en esta faena: su rol no es responsable ni ejecutor de ella.`
          : "La persona seleccionada no existe o no puede recibir esta actividad en esta faena.",
      )
    }
  }

  // `roleId` informativo: el primero de los roles candidatos que efectivamente
  // tiene la persona. No manda sobre la visibilidad —esa la decide el userId—,
  // sólo deja escrito con qué sombrero se le asignó.
  const roleIds = await candidateRoleIds(input.activityId)
  const roleIdByUser = new Map<string, string | null>()
  if (wanted.length > 0 && roleIds.length > 0) {
    const roleRows = await db
      .select({ userId: userRoles.userId, roleId: userRoles.roleId })
      .from(userRoles)
      .where(and(inArray(userRoles.userId, wanted), inArray(userRoles.roleId, roleIds)))
    for (const row of roleRows) {
      if (!roleIdByUser.has(row.userId)) roleIdByUser.set(row.userId, row.roleId)
    }
  }

  const now = new Date().toISOString()
  const closeAt = previousDay(validFrom)

  await db.transaction(async (tx) => {
    const open = await tx
      .select()
      .from(pdtpActivityWorksiteAssignees)
      .where(and(
        eq(pdtpActivityWorksiteAssignees.activityId, input.activityId),
        eq(pdtpActivityWorksiteAssignees.worksiteId, input.worksiteId),
        isNull(pdtpActivityWorksiteAssignees.validUntil),
      ))

    const openByUser = new Map(open.map((row) => [row.userId, row]))
    const leaving = open.filter((row) => !wanted.includes(row.userId))
    const joining = wanted.filter((id) => !openByUser.has(id))

    for (const row of leaving) {
      if (closeAt < row.validFrom) {
        // Corrección del mismo día: la asignación nunca llegó a regir un día
        // completo, así que no hay período de responsabilidad que conservar —y
        // el CHECK `valid_until >= valid_from` no admite cerrarla antes de
        // empezar. Se borra; lo que queda del intento es la entrada del
        // control de cambios.
        await tx.delete(pdtpActivityWorksiteAssignees)
          .where(eq(pdtpActivityWorksiteAssignees.id, row.id))
      } else {
        await tx.update(pdtpActivityWorksiteAssignees)
          .set({ validUntil: closeAt, updatedAt: now })
          .where(eq(pdtpActivityWorksiteAssignees.id, row.id))
      }
    }

    if (joining.length > 0) {
      await tx.insert(pdtpActivityWorksiteAssignees).values(joining.map((assigneeId) => ({
        id: nanoid(),
        activityId: input.activityId,
        worksiteId: input.worksiteId,
        userId: assigneeId,
        roleId: roleIdByUser.get(assigneeId) ?? null,
        validFrom,
        validUntil: null,
        note: input.note?.trim() || null,
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })))
    }

    if (leaving.length === 0 && joining.length === 0) return

    const nameById = new Map(candidates.map((candidate) => [candidate.userId, candidate.name]))
    const leavingNames = await resolveNames(tx, leaving.map((row) => row.userId))
    const beforeNames = open.map((row) => leavingNames.get(row.userId) ?? nameById.get(row.userId) ?? row.userId)
    const afterNames = wanted.map((id) => nameById.get(id) ?? id)

    await addPdtpChangeLogEntry(
      activity.programId, program.version, userId, `assignee:${activity.n}`,
      open.length > 0 ? { worksiteId: input.worksiteId, assignees: beforeNames } : null,
      { worksiteId: input.worksiteId, assignees: afterNames, validFrom },
      afterNames.length > 0
        ? `Actividad ${activity.n} asignada a ${afterNames.join(", ")} desde el ${validFrom} en esta faena.`
        : `Actividad ${activity.n} sin asignación nominal desde el ${validFrom}: vuelve a verse por rol en esta faena.`,
      tx,
    )
  })
}

/** Nombres de personas por id, para el control de cambios. */
async function resolveNames(
  client: Tx | typeof db,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await client.select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, userIds))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** `YYYY-MM-DD` o nada. Una fecha mal formada no se adivina: se rechaza. */
function normalizeDate(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!ISO_DATE.test(trimmed)) {
    throw new Error("La fecha de vigencia debe tener el formato AAAA-MM-DD.")
  }
  return trimmed
}

export type { PdtpActivityWorksiteAssignee }
