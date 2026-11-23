/**
 * lib/services/pwa-heartbeat.ts — Guarda el aviso que mandan las apps del
 * teléfono (PPA Digital, Mantención y Control TAE).
 *
 * `POST /api/pwa/aviso` es público: PPA y TAE no tienen login. Por eso este
 * servicio nunca confía en lo que el teléfono dice de sí mismo más allá de lo
 * que ya validó el esquema: las fechas se corrigen por el desfase del reloj del
 * teléfono (`sentAt`) y se recortan a la hora de recepción (un reloj adelantado
 * no puede dejar un teléfono «atascado», uno atrasado no puede inventar un
 * pendiente de horas), la persona sólo sale de una credencial válida que además
 * es de ESTE teléfono, la faena sólo se guarda si existe y el enlace TAE sólo
 * si el hash calza con uno. No se guarda la IP.
 *
 * Diseño: `docs/superpowers/specs/2026-11-22-apps-de-terreno-ti-design.md` §5.2–5.3.
 */
import { and, eq, lt, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaePublicLinks, pwaDevices, worksites } from "@/db/schema"
import { findFieldApp } from "@/lib/apps/field-apps"
import { getUserRbacById } from "@/lib/auth/rbac"
import { isSessionRevokedByCredentialChange } from "@/lib/auth/session-revocation"
import { HEARTBEAT_MIN_MS, type PwaHeartbeat } from "@/lib/pwa/heartbeat-contract"
import { findDeviceCredentialOwner } from "@/lib/services/mantencion/device-credentials"
import { isRouteOperational } from "@/lib/services/module-toggles"

export type HeartbeatOutcome = "recorded" | "module_off"

/** Los teléfonos que no avisan desde hace más que esto se purgan al registrarse uno nuevo. */
export const PWA_DEVICE_RETENTION_DAYS = 180

export interface HeartbeatContext {
  /** Credencial de dispositivo del mecánico (`Authorization: Bearer …`), si vino. */
  bearer: string | null
  now?: Date
}

/** ¿Ya hay una fila para este teléfono? Lo usa la ruta para acotar el alta de teléfonos nuevos. */
export async function isKnownPwaDevice(app: string, deviceId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(pwaDevices)
    .where(and(eq(pwaDevices.app, app), eq(pwaDevices.deviceId, deviceId)))
    .limit(1)
  return Boolean(row)
}

function bound(ms: number, now: Date): string {
  return new Date(Math.max(HEARTBEAT_MIN_MS, Math.min(ms, now.getTime()))).toISOString()
}

/** La fecha que dice el teléfono, sin pasar de la hora en que el servidor la recibió. */
function clampToNow(value: string | null, now: Date): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  return bound(ms, now)
}

/**
 * Una fecha medida con el reloj del teléfono, llevada a la hora del servidor:
 * se le suma el desfase del reloj (hora del servidor menos `sentAt`) y luego se
 * recorta a la recepción. Un teléfono 3 h atrasado con un pendiente de hace
 * 10 min (según su reloj) queda con un pendiente de hace 10 min, no de 3 h 10.
 */
function shiftToServerClock(value: string | null, skewMs: number, now: Date): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  return bound(ms + skewMs, now)
}

/**
 * La persona dueña de la credencial, sólo si la credencial es de ESTE teléfono y
 * sigue valiendo para la app del mecánico: la misma comprobación que la
 * sincronización (`authenticateSyncRequest`: usuario activo, credencial no
 * anterior a un cambio de clave, permiso `mant:app:use`). Si no, `null` y el
 * aviso queda anónimo: nunca falla por una credencial mala. No usa
 * `authenticateDeviceToken` porque éste refresca `last_used_at` y un aviso no
 * debe contar como uso de la credencial.
 */
async function resolveMechanicUser(bearer: string, deviceId: string): Promise<string | null> {
  const owner = await findDeviceCredentialOwner(bearer)
  if (!owner || owner.deviceId !== deviceId) return null
  const rbac = await getUserRbacById(owner.userId, true)
  if (!rbac || !rbac.isActive) return null
  if (isSessionRevokedByCredentialChange(Date.parse(owner.createdAt), rbac.sessionsValidFrom)) return null
  if (!rbac.permissions.includes("mant:app:use")) return null
  return rbac.id
}

export async function recordPwaHeartbeat(input: PwaHeartbeat, ctx: HeartbeatContext): Promise<HeartbeatOutcome> {
  const def = findFieldApp(input.app)
  if (!def) return "module_off"
  if (!await isRouteOperational(def.toggleRoute)) return "module_off"

  const now = ctx.now ?? new Date()
  const nowIso = now.toISOString()
  // Cuánto se aparta el reloj del teléfono del del servidor (+ = el teléfono va atrasado).
  const skewMs = now.getTime() - Date.parse(input.sentAt)

  // Persona: sólo con una credencial vigente del mecánico y de este teléfono.
  // Una mala (vencida, revocada, de otro equipo, inventada) no hace fallar el
  // aviso ni borra lo que ya se sabía.
  const userId = input.app === "mantencion" && ctx.bearer
    ? await resolveMechanicUser(ctx.bearer, input.deviceId)
    : null

  // Enlace TAE: se asocia aunque esté revocado o vencido; un teléfono usando un
  // enlace muerto es justo lo que TI tiene que ver.
  let taeLinkId: string | null = null
  let worksiteId: string | null = null
  if (input.app === "tae" && input.linkHash) {
    const [link] = await db
      .select({ id: fuelTaePublicLinks.id, worksiteId: fuelTaePublicLinks.worksiteId })
      .from(fuelTaePublicLinks)
      .where(eq(fuelTaePublicLinks.tokenHash, input.linkHash))
      .limit(1)
    if (link) {
      taeLinkId = link.id
      worksiteId = link.worksiteId
    }
  }

  // Faena de PPA: sólo si existe (el cliente la saca del último envío y puede venir vieja).
  if (input.app === "ppa" && input.worksiteId) {
    const [site] = await db.select({ id: worksites.id }).from(worksites).where(eq(worksites.id, input.worksiteId)).limit(1)
    worksiteId = site?.id ?? null
  }

  const lastError = input.lastError?.trim() ? input.lastError.trim() : null
  const values = {
    app: input.app,
    deviceId: input.deviceId,
    lastSeenAt: nowIso,
    version: input.version,
    builtAt: clampToNow(input.builtAt, now),
    installed: input.installed,
    platform: input.platform,
    pendingCount: input.pending,
    failedCount: input.failed,
    oldestPendingAt: shiftToServerClock(input.oldestPendingAt, skewMs, now),
    lastAttemptAt: shiftToServerClock(input.lastAttemptAt, skewMs, now),
    lastError,
    lastErrorAt: lastError ? nowIso : null,
    userId,
    worksiteId,
    taeLinkId,
  }

  await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(pwaDevices)
      .values({ ...values, firstSeenAt: nowIso })
      .onConflictDoUpdate({
        target: [pwaDevices.app, pwaDevices.deviceId],
        // `first_seen_at` no está en `set`: no cambia después del alta.
        set: {
          lastSeenAt: values.lastSeenAt,
          version: values.version,
          builtAt: values.builtAt,
          installed: values.installed,
          platform: values.platform,
          pendingCount: values.pendingCount,
          failedCount: values.failedCount,
          oldestPendingAt: values.oldestPendingAt,
          // Un aviso sin fecha de intento no borra la última que se supo.
          lastAttemptAt: sql`COALESCE(excluded.last_attempt_at, ${pwaDevices.lastAttemptAt})`,
          // El último error se conserva aunque el aviso siguiente llegue sin error, y
          // `last_error_at` es cuándo APARECIÓ ese error: un teléfono que repite el
          // mismo mensaje en cada aviso no lo re-estampa (parecería un error de hoy).
          lastError: sql`CASE WHEN excluded.last_error IS NOT NULL AND excluded.last_error IS DISTINCT FROM ${pwaDevices.lastError} THEN excluded.last_error ELSE ${pwaDevices.lastError} END`,
          lastErrorAt: sql`CASE WHEN excluded.last_error IS NOT NULL AND excluded.last_error IS DISTINCT FROM ${pwaDevices.lastError} THEN excluded.last_error_at ELSE ${pwaDevices.lastErrorAt} END`,
          // Un aviso anónimo o con credencial inválida no borra la asociación previa.
          userId: sql`COALESCE(excluded.user_id, ${pwaDevices.userId})`,
          worksiteId: sql`COALESCE(excluded.worksite_id, ${pwaDevices.worksiteId})`,
          taeLinkId: sql`COALESCE(excluded.tae_link_id, ${pwaDevices.taeLinkId})`,
        },
      })
      // `xmax = 0` sólo en una fila recién insertada (no en la actualizada por el conflicto).
      .returning({ inserted: sql<boolean>`(xmax = 0)` })

    // Purga: al aparecer un teléfono nuevo se borran los que no avisan hace más de
    // 180 días. Sin cron: la tabla sólo crece con altas y se poda con ellas.
    if (saved?.inserted) {
      const cutoff = new Date(now.getTime() - PWA_DEVICE_RETENTION_DAYS * 86_400_000).toISOString()
      await tx.delete(pwaDevices).where(lt(pwaDevices.lastSeenAt, cutoff))
    }
  })

  return "recorded"
}
