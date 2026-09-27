/**
 * lib/services/pdtp/registration-authority.ts
 *
 * ¿Puede esta persona registrar la ejecución de esta actividad en esta faena?
 *
 * PREV-I03 (auditoría 2026-09-26). `prevention:pdtp:execute` dice que alguien
 * puede registrar trabajo del programa en las faenas de su alcance; no dice
 * **qué** trabajo. Antes de esta regla, sin asignación nominal, cualquiera con
 * ese permiso registraba cualquier actividad —incluidos los roles globales no
 * operacionales (gerente_legal_rrhh, subgerente_operaciones, jefe_mantencion),
 * que lo tienen por las actividades que sí son suyas— y la autoría del libro
 * quedaba difusa. La regla, en orden:
 *
 * 1. **Prevención y la administración del programa** registran cualquier
 *    actividad de las faenas de su alcance (`canRegisterAnyActivity`, ver
 *    `canRegisterAnyPdtpActivity` en `lib/auth/pdtp-registration.ts`).
 * 2. **Con asignación nominal vigente**, registra la persona asignada. La
 *    asignación es más fina que el cargo: si Prevención nombró a alguien, otro
 *    jefe de terreno de la misma faena no la registra por él.
 * 3. **Sin asignación**, registra quien tiene el rol de alguno de los
 *    responsables de la actividad (`responsibleSlugs` → catálogo), o el rol que
 *    opera la plataforma por él cuando el responsable no tiene cuenta (D21). Es
 *    exactamente el criterio de `/pendientes` (operational-work-queue.ts), así
 *    que lo que la cola le muestra a alguien es lo que puede registrar.
 * 4. Una actividad cuyo responsable no resuelve a ningún rol activo sólo la
 *    registra Prevención: nadie más responde por ella.
 *
 * La decisión es pura (`decidePdtpRegistrationAuthority`) para que la misma
 * regla la usen el servidor —la frontera real— y la UI, que sólo esconde el
 * botón "Registrar" donde el servidor lo rechazaría.
 */
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { pdtpActivities, pdtpActivityWorksiteAssignees, pdtpResponsibleCatalog, pdtpScheduledInstances } from "@/db/schema"
import { todayInChile } from "@/lib/utils"

type Client = DB | Tx

/** Quién registra, resuelto de la sesión en el servidor (nunca del cliente). */
export type PdtpRegistrationActor = {
  userId: string
  roles: readonly string[]
  /** Prevención o administración del programa: registra cualquier actividad. */
  canRegisterAnyActivity: boolean
}

export type PdtpActivityResponsibility = {
  /** Roles RBAC que responden por la actividad (propios u operadores, D21). */
  roles: readonly string[]
  /** Nombres visibles de los responsables, para el mensaje de error. */
  names: readonly string[]
}

export type PdtpRegistrationVerdict = { allowed: true } | { allowed: false; message: string }

export const PDTP_ASSIGNED_TO_OTHER_MESSAGE =
  "Esta actividad está asignada a otra persona en esta faena. Solo quien está asignado, o Prevención, puede registrarla."

export function decidePdtpRegistrationAuthority(input: {
  actor: PdtpRegistrationActor
  assigneeUserIds: readonly string[]
  responsible: PdtpActivityResponsibility
}): PdtpRegistrationVerdict {
  const { actor, assigneeUserIds, responsible } = input
  if (actor.canRegisterAnyActivity) return { allowed: true }
  if (assigneeUserIds.length > 0) {
    return assigneeUserIds.includes(actor.userId)
      ? { allowed: true }
      : { allowed: false, message: PDTP_ASSIGNED_TO_OTHER_MESSAGE }
  }
  if (responsible.roles.length === 0) {
    return {
      allowed: false,
      message: "Esta actividad no tiene un responsable con cuenta en la plataforma. Solo Prevención puede registrarla.",
    }
  }
  if (responsible.roles.some((role) => actor.roles.includes(role))) return { allowed: true }
  const names = responsible.names.length > 0 ? responsible.names.join(", ") : "otro cargo"
  return {
    allowed: false,
    message: `Esta actividad no es de tu cargo: su responsable es ${names}. Solo su responsable, la persona asignada o Prevención pueden registrarla.`,
  }
}

function slugsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((slug): slug is string => typeof slug === "string") : []
}

/**
 * Carga, para varias actividades de una faena, lo que la regla necesita:
 * asignados vigentes hoy y responsables resueltos contra el catálogo activo.
 * Tres consultas, sin importar cuántas actividades.
 */
async function loadAuthorityInputs(client: Client, activityIds: readonly string[], worksiteId: string) {
  const assignees = new Map<string, string[]>()
  const responsibility = new Map<string, { roles: string[]; names: string[] }>()
  if (activityIds.length === 0) return { assignees, responsibility }
  const today = todayInChile()
  const ids = [...activityIds]
  const [assigneeRows, activityRows] = await Promise.all([
    client.select({ activityId: pdtpActivityWorksiteAssignees.activityId, userId: pdtpActivityWorksiteAssignees.userId })
      .from(pdtpActivityWorksiteAssignees)
      .where(and(
        inArray(pdtpActivityWorksiteAssignees.activityId, ids),
        eq(pdtpActivityWorksiteAssignees.worksiteId, worksiteId),
        lte(pdtpActivityWorksiteAssignees.validFrom, today),
        or(isNull(pdtpActivityWorksiteAssignees.validUntil), gte(pdtpActivityWorksiteAssignees.validUntil, today)),
      )),
    client.select({ id: pdtpActivities.id, responsibleSlugs: pdtpActivities.responsibleSlugs, responsibleDisplay: pdtpActivities.responsibleDisplay })
      .from(pdtpActivities)
      .where(inArray(pdtpActivities.id, ids)),
  ])
  for (const row of assigneeRows) {
    assignees.set(row.activityId, [...(assignees.get(row.activityId) ?? []), row.userId])
  }
  const allSlugs = [...new Set(activityRows.flatMap((row) => slugsOf(row.responsibleSlugs)))]
  const catalog = allSlugs.length > 0
    ? await client.select({
      slug: pdtpResponsibleCatalog.slug,
      displayName: pdtpResponsibleCatalog.displayName,
      roleName: pdtpResponsibleCatalog.roleName,
      operatedByRoleName: pdtpResponsibleCatalog.operatedByRoleName,
    }).from(pdtpResponsibleCatalog)
      .where(and(inArray(pdtpResponsibleCatalog.slug, allSlugs), eq(pdtpResponsibleCatalog.isActive, true)))
    : []
  const bySlug = new Map(catalog.map((row) => [row.slug, row]))
  for (const row of activityRows) {
    const roles = new Set<string>()
    const names: string[] = []
    for (const slug of slugsOf(row.responsibleSlugs)) {
      const entry = bySlug.get(slug)
      if (!entry) continue
      if (entry.roleName) roles.add(entry.roleName)
      if (entry.operatedByRoleName) roles.add(entry.operatedByRoleName)
      names.push(entry.displayName)
    }
    responsibility.set(row.id, {
      roles: [...roles],
      names: names.length > 0 ? names : (row.responsibleDisplay ? [row.responsibleDisplay] : []),
    })
  }
  return { assignees, responsibility }
}

/** Lanza con el mensaje de la regla si `actor` no puede registrar la actividad. */
export async function assertPdtpActorMayRegister(
  input: { activityId: string; worksiteId: string; actor: PdtpRegistrationActor },
  client: Client = db,
): Promise<void> {
  if (input.actor.canRegisterAnyActivity) return
  const { assignees, responsibility } = await loadAuthorityInputs(client, [input.activityId], input.worksiteId)
  const verdict = decidePdtpRegistrationAuthority({
    actor: input.actor,
    assigneeUserIds: assignees.get(input.activityId) ?? [],
    responsible: responsibility.get(input.activityId) ?? { roles: [], names: [] },
  })
  if (!verdict.allowed) throw new Error(verdict.message)
}

/** Misma regla para una ocurrencia programada: resuelve su actividad y faena. */
export async function assertPdtpActorMayRegisterScheduledInstance(
  input: { instanceId: string; actor: PdtpRegistrationActor },
  client: Client = db,
): Promise<void> {
  if (input.actor.canRegisterAnyActivity) return
  const [instance] = await client.select({
    activityId: pdtpScheduledInstances.activityId,
    worksiteId: pdtpScheduledInstances.worksiteId,
  }).from(pdtpScheduledInstances).where(eq(pdtpScheduledInstances.id, input.instanceId)).limit(1)
  // Sin ocurrencia, el servicio responde su propio "no encontrada".
  if (!instance) return
  await assertPdtpActorMayRegister({ ...instance, actor: input.actor }, client)
}

/**
 * Las actividades de la lista que `actor` puede registrar en la faena. Lo usa
 * la UI para esconder "Registrar" donde el servidor lo rechazaría; no es una
 * frontera de autorización.
 */
export async function listPdtpRegistrableActivityIds(
  input: { activityIds: readonly string[]; worksiteId: string; actor: PdtpRegistrationActor },
  client: Client = db,
): Promise<Set<string>> {
  if (input.actor.canRegisterAnyActivity) return new Set(input.activityIds)
  const { assignees, responsibility } = await loadAuthorityInputs(client, input.activityIds, input.worksiteId)
  return new Set(input.activityIds.filter((activityId) => decidePdtpRegistrationAuthority({
    actor: input.actor,
    assigneeUserIds: assignees.get(activityId) ?? [],
    responsible: responsibility.get(activityId) ?? { roles: [], names: [] },
  }).allowed))
}
