import { createHash, randomBytes } from "node:crypto"
import { and, desc, eq, exists, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantDeviceCredentials, users, worksiteUsers } from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import { getUserRbacById } from "@/lib/auth/rbac"
import { nanoid } from "@/lib/id"
import type { MantActionResult } from "./result"

/**
 * Credencial de dispositivo de la app del mecánico (decisión D8 del plan).
 *
 * Se emite con la SESIÓN de la plataforma (`POST /api/mantencion/dispositivo`)
 * y es lo único que acepta `/api/mantencion/sync/*`: así la cola de una tablet
 * compartida se envía con la credencial de su autor aunque el navegador tenga
 * abierta la sesión de otra persona o ésta haya expirado. En la base sólo vive
 * el SHA-256 del token; el token en claro existe una vez, en la respuesta que
 * lo emite (y nunca va a la bitácora ni a los logs).
 */

/** Vigencia de una credencial (§9). */
export const DEVICE_CREDENTIAL_DAYS = 30
/** `lastUsedAt` se refresca como mucho cada 10 minutos: la sync golpea seguido y no hay que escribir en cada llamada. */
const LAST_USED_REFRESH_MS = 10 * 60 * 1000

export type DeviceCredentialStatus = "vigente" | "vencida" | "revocada"

export interface DeviceCredentialRow {
  id: string
  userId: string
  userName: string
  userEmail: string
  deviceId: string
  label: string | null
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  status: DeviceCredentialStatus
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * Quien administra dispositivos. El alcance sale de la sesión: `mant:devices:manage`
 * por sí solo no abre las credenciales de otra faena.
 */
export interface DeviceCredentialActor {
  userId: string
  isGlobal: boolean
  viewAll: boolean
  worksiteIds: readonly string[]
}

/** `null` = todas las faenas. */
function deviceWorksiteScope(actor: DeviceCredentialActor): string[] | null {
  return actor.isGlobal || actor.viewAll ? null : [...actor.worksiteIds]
}

/** «Ese dispositivo no es de tu faena.» — el mismo texto para lista y revocación. */
export const DEVICE_OUT_OF_SCOPE = "Ese dispositivo no es de tu faena."

/** Índice parcial que deja una sola credencial viva por (usuario, dispositivo). */
const LIVE_UNIQUE = "mant_device_credentials_live_unique"

/** ¿El dueño de la credencial comparte alguna faena con quien administra? */
async function ownerSharesWorksite(client: Pick<Tx, "select">, actor: DeviceCredentialActor, ownerId: string): Promise<boolean> {
  if (actor.isGlobal || actor.viewAll) return true
  const scope = deviceWorksiteScope(actor)
  if (!scope || scope.length === 0) return false
  const rows = await client
    .select({ worksiteId: worksiteUsers.worksiteId })
    .from(worksiteUsers)
    .where(and(eq(worksiteUsers.userId, ownerId), inArray(worksiteUsers.worksiteId, scope)))
    .limit(1)
  return rows.length > 0
}

/**
 * Alcance de un llamador que no lo pasó. Las acciones siempre lo pasan; esto
 * cubre a los llamadores históricos (pruebas, scripts) sin dejar la revocación
 * abierta: el RBAC se relee de la base, igual que en la sincronización.
 */
async function actorFromRbac(userId: string): Promise<DeviceCredentialActor | null> {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) return null
  return {
    userId: rbac.id,
    isGlobal: rbac.isGlobal,
    viewAll: rbac.permissions.includes("mant:records:view_all"),
    worksiteIds: rbac.worksiteIds,
  }
}

/** La jefatura revocó un dispositivo de esta persona después de que empezó su sesión web. */
export class DeviceReissueBlockedError extends Error {
  constructor() {
    super("Tu acceso a la app en este dispositivo fue revocado. Cierra sesión y vuelve a entrar con tu contraseña para conectarlo de nuevo.")
    this.name = "DeviceReissueBlockedError"
  }
}

/**
 * Emite una credencial nueva para (usuario, dispositivo) y revoca la vigente
 * anterior en la MISMA transacción: el índice parcial único deja a lo más una
 * viva por par, así que revocar primero es obligatorio, no cortesía.
 */
export async function issueDeviceCredential(input: {
  userId: string
  deviceId: string
  label?: string | null
  actorEmail?: string | null
  /**
   * Inicio (ms) de la sesión web que pide la credencial. Si alguien de jefatura
   * revocó un dispositivo de esta persona DESPUÉS de ese instante, no se emite:
   * revocar no servía, porque la app volvía a pedir una credencial con la
   * misma sesión (una tablet robada conserva la cookie). Se exige iniciar
   * sesión de nuevo, con contraseña. `undefined` (llamadores sin sesión, como
   * las pruebas) no aplica el bloqueo. Auditoría 2026-11-11.
   */
  sessionIssuedAt?: number
}): Promise<{ token: string; expiresAt: string; credentialId: string }> {
  const token = randomBytes(32).toString("base64url")
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_CREDENTIAL_DAYS * 86_400_000).toISOString()
  const label = input.label?.trim() ? input.label.trim().slice(0, 120) : null

  // Dos emisiones simultáneas del mismo par chocaban al confirmar el índice
  // parcial y respondían 500 en un endpoint cuyo contrato es «emitir/reemplazar».
  const run = async (): Promise<string> => {
    const credentialId = nanoid()
    await db.transaction(async (tx) => {
      // Serializa por (usuario, dispositivo): la segunda transacción ve la fila de la primera.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.deviceId}`}))`)
      if (input.sessionIssuedAt !== undefined) {
        // Cualquier dispositivo, no sólo éste: borrar los datos de la app genera otro `deviceId`.
        const [blocked] = await tx.select({ id: mantDeviceCredentials.id }).from(mantDeviceCredentials).where(and(
          eq(mantDeviceCredentials.userId, input.userId),
          isNotNull(mantDeviceCredentials.revokedBy),
          gt(mantDeviceCredentials.revokedAt, new Date(input.sessionIssuedAt).toISOString()),
        )).limit(1)
        if (blocked) throw new DeviceReissueBlockedError()
      }
      const replaced = await tx
        .update(mantDeviceCredentials)
        .set({ revokedAt: now.toISOString(), revokedBy: null })
        .where(and(
          eq(mantDeviceCredentials.userId, input.userId),
          eq(mantDeviceCredentials.deviceId, input.deviceId),
          isNull(mantDeviceCredentials.revokedAt),
        ))
        .returning({ id: mantDeviceCredentials.id })
      await tx.insert(mantDeviceCredentials).values({
        id: credentialId,
        userId: input.userId,
        deviceId: input.deviceId,
        tokenHash: hashDeviceToken(token),
        label,
        createdAt: now.toISOString(),
        expiresAt,
      })
      await recordAudit({
        userId: input.userId,
        userEmail: input.actorEmail ?? undefined,
        action: "create",
        entityType: "mant_device_credential",
        entityId: credentialId,
        entityCode: input.deviceId,
        newState: { deviceId: input.deviceId, label, expiresAt, replacedCredentialIds: replaced.map((row) => row.id) },
      }, tx)
    })
    return credentialId
  }

  let credentialId: string
  try {
    credentialId = await run()
  } catch (error) {
    // Red de seguridad fuera de este proceso: si el INSERT chocó con una fila viva
    // confirmada por otro nodo, el reintento la revoca y deja exactamente una viva.
    if (!isUniqueViolation(error, LIVE_UNIQUE)) throw error
    credentialId = await run()
  }

  return { token, expiresAt, credentialId }
}

/**
 * `null` si el token no existe, venció o fue revocado: el llamador no distingue
 * entre los tres (a la app le toca lo mismo: entrar de nuevo).
 */
export async function authenticateDeviceToken(
  token: string,
): Promise<{ credentialId: string; userId: string; deviceId: string; createdAt: string } | null> {
  if (!token || token.length > 200) return null
  const [row] = await db
    .select({
      id: mantDeviceCredentials.id,
      userId: mantDeviceCredentials.userId,
      deviceId: mantDeviceCredentials.deviceId,
      createdAt: mantDeviceCredentials.createdAt,
      lastUsedAt: mantDeviceCredentials.lastUsedAt,
    })
    .from(mantDeviceCredentials)
    .where(and(
      eq(mantDeviceCredentials.tokenHash, hashDeviceToken(token)),
      isNull(mantDeviceCredentials.revokedAt),
      sql`${mantDeviceCredentials.expiresAt} > now()`,
    ))
    .limit(1)
  if (!row) return null

  const stale = !row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > LAST_USED_REFRESH_MS
  if (stale) {
    // Una falla de este refresco no debe tumbar una sincronización válida.
    await db.update(mantDeviceCredentials)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(mantDeviceCredentials.id, row.id))
      .catch(() => undefined)
  }
  return { credentialId: row.id, userId: row.userId, deviceId: row.deviceId, createdAt: row.createdAt }
}

/**
 * Lista para la pantalla de dispositivos de jefatura (la más reciente primero).
 * Con `actor`, sólo salen las credenciales de personas que comparten alguna de
 * sus faenas: los correos de otras faenas no se listan. El filtro va en SQL
 * (`exists`), así que un usuario con varias faenas no se duplica.
 */
export async function listDeviceCredentials(filter?: {
  userId?: string
  actor?: DeviceCredentialActor
}): Promise<DeviceCredentialRow[]> {
  const scope = filter?.actor ? deviceWorksiteScope(filter.actor) : null
  const rows = await db
    .select({
      id: mantDeviceCredentials.id,
      userId: mantDeviceCredentials.userId,
      userName: users.name,
      userEmail: users.email,
      deviceId: mantDeviceCredentials.deviceId,
      label: mantDeviceCredentials.label,
      createdAt: mantDeviceCredentials.createdAt,
      expiresAt: mantDeviceCredentials.expiresAt,
      lastUsedAt: mantDeviceCredentials.lastUsedAt,
      revokedAt: mantDeviceCredentials.revokedAt,
    })
    .from(mantDeviceCredentials)
    .innerJoin(users, eq(users.id, mantDeviceCredentials.userId))
    .where(and(
      filter?.userId ? eq(mantDeviceCredentials.userId, filter.userId) : undefined,
      scope
        ? exists(
          db.select({ one: sql`1` }).from(worksiteUsers).where(and(
            eq(worksiteUsers.userId, mantDeviceCredentials.userId),
            inArray(worksiteUsers.worksiteId, scope),
          )),
        )
        : undefined,
    ))
    .orderBy(desc(mantDeviceCredentials.createdAt))
  const now = Date.now()
  return rows.map((row) => ({
    ...row,
    status: row.revokedAt ? "revocada" : Date.parse(row.expiresAt) <= now ? "vencida" : "vigente",
  }))
}

/**
 * Revoca una credencial. NO verifica el permiso `mant:devices:manage`: lo hace
 * quien llama (la server action de jefatura). Sí verifica el ALCAZANCE: sólo se
 * revoca el dispositivo de alguien que comparta faena con quien revoca (o de
 * cualquiera, si es global o ve todas las faenas). Así una jefatura delegada no
 * deja sin sincronizar a la planta entera.
 */
export async function revokeDeviceCredential(input: {
  credentialId: string
  actorUserId: string
  actorEmail?: string | null
  actor?: DeviceCredentialActor
}): Promise<MantActionResult> {
  const actor = input.actor ?? await actorFromRbac(input.actorUserId)
  if (!actor) return { ok: false, message: "No se pudo verificar tu alcance: recarga la página e inténtalo de nuevo." }

  return db.transaction(async (tx): Promise<MantActionResult> => {
    // Se bloquea la credencial: dos revocaciones simultáneas no auditan dos veces.
    const [credential] = await tx
      .select({
        id: mantDeviceCredentials.id,
        userId: mantDeviceCredentials.userId,
        deviceId: mantDeviceCredentials.deviceId,
        revokedAt: mantDeviceCredentials.revokedAt,
      })
      .from(mantDeviceCredentials)
      .where(eq(mantDeviceCredentials.id, input.credentialId))
      .for("update")
      .limit(1)
    // Mismo mensaje para «no existe» y «ya estaba revocada»: no se confirma el id.
    if (!credential || credential.revokedAt) return { ok: false, message: "Esa credencial no existe o ya estaba revocada." }
    if (!(await ownerSharesWorksite(tx, actor, credential.userId))) return { ok: false, message: DEVICE_OUT_OF_SCOPE }

    await tx.update(mantDeviceCredentials)
      .set({ revokedAt: new Date().toISOString(), revokedBy: input.actorUserId })
      .where(eq(mantDeviceCredentials.id, credential.id))
    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.actorEmail ?? undefined,
      action: "status_change",
      entityType: "mant_device_credential",
      entityId: credential.id,
      entityCode: credential.deviceId,
      oldState: { status: "vigente", userId: credential.userId },
      newState: { status: "revocada", userId: credential.userId },
    }, tx)
    return { ok: true, message: "Dispositivo desconectado. Tendrá que entrar de nuevo con señal." }
  })
}
