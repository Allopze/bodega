/**
 * lib/services/pwa-heartbeat.ts — Guarda el aviso que mandan las apps del
 * teléfono (PPA Digital, Mantención y Control TAE).
 *
 * `POST /api/pwa/aviso` es público: PPA y TAE no tienen login. Por eso este
 * servicio nunca confía en lo que el teléfono dice de sí mismo más allá de lo
 * que ya validó el esquema: las fechas del futuro se recortan a la hora de
 * recepción (un reloj adelantado no puede dejar un teléfono «atascado»), la
 * persona sólo sale de una credencial válida, la faena sólo se guarda si existe
 * y el enlace TAE sólo si el hash calza con uno. No se guarda la IP.
 *
 * Diseño: `docs/superpowers/specs/2026-11-22-apps-de-terreno-ti-design.md` §5.2–5.3.
 */
import { eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaePublicLinks, pwaDeviceDays, pwaDevices, worksites } from "@/db/schema"
import { findFieldApp } from "@/lib/apps/field-apps"
import type { PwaHeartbeat } from "@/lib/pwa/heartbeat-contract"
import { authenticateDeviceToken } from "@/lib/services/mantencion/device-credentials"
import { isRouteOperational } from "@/lib/services/module-toggles"
import { todayInChile } from "@/lib/utils"

export type HeartbeatOutcome = "recorded" | "module_off"

export interface HeartbeatContext {
  /** Credencial de dispositivo del mecánico (`Authorization: Bearer …`), si vino. */
  bearer: string | null
  now?: Date
}

/** La fecha que dice el teléfono, sin pasar de la hora en que el servidor la recibió. */
function clampToNow(value: string | null, now: Date): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  return new Date(Math.min(ms, now.getTime())).toISOString()
}

export async function recordPwaHeartbeat(input: PwaHeartbeat, ctx: HeartbeatContext): Promise<HeartbeatOutcome> {
  const def = findFieldApp(input.app)
  if (!def) return "module_off"
  if (!await isRouteOperational(def.toggleRoute)) return "module_off"

  const now = ctx.now ?? new Date()
  const nowIso = now.toISOString()

  // Persona: sólo con una credencial vigente del mecánico. Una mala (vencida,
  // revocada, inventada) no hace fallar el aviso ni borra lo que ya se sabía.
  // Ojo: `authenticateDeviceToken` refresca `last_used_at` de la credencial
  // (como mucho cada 10 min), así que un aviso cuenta como «uso» de la credencial.
  let userId: string | null = null
  if (input.app === "mantencion" && ctx.bearer) {
    const credential = await authenticateDeviceToken(ctx.bearer)
    userId = credential?.userId ?? null
  }

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
    oldestPendingAt: clampToNow(input.oldestPendingAt, now),
    lastAttemptAt: clampToNow(input.lastAttemptAt, now),
    lastError,
    lastErrorAt: lastError ? nowIso : null,
    userId,
    worksiteId,
    taeLinkId,
  }

  await db.transaction(async (tx) => {
    await tx
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
          lastAttemptAt: values.lastAttemptAt,
          // Un aviso sin error no borra el último que se supo.
          lastError: sql`COALESCE(excluded.last_error, ${pwaDevices.lastError})`,
          lastErrorAt: sql`COALESCE(excluded.last_error_at, ${pwaDevices.lastErrorAt})`,
          // Un aviso anónimo o con credencial inválida no borra la asociación previa.
          userId: sql`COALESCE(excluded.user_id, ${pwaDevices.userId})`,
          worksiteId: sql`COALESCE(excluded.worksite_id, ${pwaDevices.worksiteId})`,
          taeLinkId: sql`COALESCE(excluded.tae_link_id, ${pwaDevices.taeLinkId})`,
        },
      })

    await tx
      .insert(pwaDeviceDays)
      .values({ app: input.app, deviceId: input.deviceId, day: todayInChile(now), reports: 1 })
      .onConflictDoUpdate({
        target: [pwaDeviceDays.app, pwaDeviceDays.deviceId, pwaDeviceDays.day],
        set: { reports: sql`${pwaDeviceDays.reports} + 1` },
      })
  })

  return "recorded"
}
