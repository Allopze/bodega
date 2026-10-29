import { createHash, randomBytes } from "node:crypto"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { mantDeviceCredentials, users } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
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
 * Emite una credencial nueva para (usuario, dispositivo) y revoca la vigente
 * anterior en la MISMA transacción: el índice parcial único deja a lo más una
 * viva por par, así que revocar primero es obligatorio, no cortesía.
 */
export async function issueDeviceCredential(input: {
  userId: string
  deviceId: string
  label?: string | null
  actorEmail?: string | null
}): Promise<{ token: string; expiresAt: string; credentialId: string }> {
  const token = randomBytes(32).toString("base64url")
  const credentialId = nanoid()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_CREDENTIAL_DAYS * 86_400_000).toISOString()
  const label = input.label?.trim() ? input.label.trim().slice(0, 120) : null

  await db.transaction(async (tx) => {
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

  return { token, expiresAt, credentialId }
}

/**
 * `null` si el token no existe, venció o fue revocado: el llamador no distingue
 * entre los tres (a la app le toca lo mismo: entrar de nuevo).
 */
export async function authenticateDeviceToken(
  token: string,
): Promise<{ credentialId: string; userId: string; deviceId: string } | null> {
  if (!token || token.length > 200) return null
  const [row] = await db
    .select({
      id: mantDeviceCredentials.id,
      userId: mantDeviceCredentials.userId,
      deviceId: mantDeviceCredentials.deviceId,
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
  return { credentialId: row.id, userId: row.userId, deviceId: row.deviceId }
}

/** Lista para la pantalla de dispositivos de jefatura (la más reciente primero). */
export async function listDeviceCredentials(filter?: { userId?: string }): Promise<DeviceCredentialRow[]> {
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
    .where(filter?.userId ? eq(mantDeviceCredentials.userId, filter.userId) : undefined)
    .orderBy(desc(mantDeviceCredentials.createdAt))
  const now = Date.now()
  return rows.map((row) => ({
    ...row,
    status: row.revokedAt ? "revocada" : Date.parse(row.expiresAt) <= now ? "vencida" : "vigente",
  }))
}

/**
 * Revoca una credencial. NO verifica el permiso `mant:devices:manage`: lo hace
 * quien llama (la server action de jefatura), igual que el resto de los
 * servicios de escritura del módulo que reciben `actorUserId`.
 */
export async function revokeDeviceCredential(input: {
  credentialId: string
  actorUserId: string
  actorEmail?: string | null
}): Promise<MantActionResult> {
  const revoked = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(mantDeviceCredentials)
      .set({ revokedAt: new Date().toISOString(), revokedBy: input.actorUserId })
      .where(and(eq(mantDeviceCredentials.id, input.credentialId), isNull(mantDeviceCredentials.revokedAt)))
      .returning({ id: mantDeviceCredentials.id, userId: mantDeviceCredentials.userId, deviceId: mantDeviceCredentials.deviceId })
    if (!row) return null
    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.actorEmail ?? undefined,
      action: "status_change",
      entityType: "mant_device_credential",
      entityId: row.id,
      entityCode: row.deviceId,
      oldState: { status: "vigente", userId: row.userId },
      newState: { status: "revocada", userId: row.userId },
    }, tx)
    return row
  })
  if (!revoked) return { ok: false, message: "Esa credencial no existe o ya estaba revocada." }
  return { ok: true, message: "Dispositivo desconectado. Tendrá que entrar de nuevo con señal." }
}
