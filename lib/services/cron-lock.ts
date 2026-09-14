import { desc, eq, gte, sql } from "drizzle-orm"
import { db } from "@/db"
import { cronRuns } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"

/** Un `detail` es para leerlo en una tabla, no para volcar un stack. */
const DETAIL_MAX = 500

/**
 * OBS-002 (auditoría 2026-09-14): abre la fila de la corrida. Si escribirla
 * falla, la corrida **sigue igual**: la bitácora es observabilidad, y una
 * observabilidad que puede tumbar el trabajo que observa es peor que ninguna.
 */
async function openRun(jobName: string): Promise<string | null> {
  const id = nanoid()
  try {
    await db.insert(cronRuns).values({ id, jobName })
    return id
  } catch (err) {
    logger.error(`[cron/${jobName}] no se pudo abrir la bitácora de corrida`, err)
    return null
  }
}

async function closeRun(
  id: string | null,
  startedAt: number,
  outcome: "success" | "skipped" | "failed",
  detail?: string,
): Promise<void> {
  if (!id) return
  try {
    await db.update(cronRuns).set({
      finishedAt: new Date().toISOString(),
      outcome,
      durationMs: Date.now() - startedAt,
      detail: detail?.slice(0, DETAIL_MAX) ?? null,
    }).where(eq(cronRuns.id, id))
  } catch (err) {
    logger.error("[cron] no se pudo cerrar la bitácora de corrida", err)
  }
}

/**
 * Envuelve `run` dejando constancia del desenlace. El error se vuelve a lanzar:
 * el contrato de cada ruta —salida HTTP y código de salida del runner— lo
 * decide la ruta, no esto.
 */
async function recorded<T>(
  jobName: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  const runId = await openRun(jobName)
  try {
    const result = await run()
    await closeRun(runId, startedAt, "success")
    return result
  } catch (err) {
    await closeRun(runId, startedAt, "failed", err instanceof Error ? err.message : String(err))
    throw err
  }
}

/** Un disparo que se saltó porque otro estaba en curso también es información. */
async function recordSkip(jobName: string, reason: string): Promise<void> {
  const startedAt = Date.now()
  await closeRun(await openRun(jobName), startedAt, "skipped", reason)
}

export interface CronJobHealth {
  jobName: string
  lastStartedAt: string | null
  lastOutcome: string | null
  lastDurationMs: number | null
  lastDetail: string | null
}

/**
 * Última corrida conocida de cada job. Es la consulta que `OBS-002` echaba de
 * menos: sirve para responder «¿qué dejó de correr?» sin abrir veintiséis
 * pantallas.
 */
export async function getCronJobHealth(sinceDays = 30): Promise<CronJobHealth[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const rows = await db
    .selectDistinctOn([cronRuns.jobName], {
      jobName: cronRuns.jobName,
      startedAt: cronRuns.startedAt,
      outcome: cronRuns.outcome,
      durationMs: cronRuns.durationMs,
      detail: cronRuns.detail,
    })
    .from(cronRuns)
    .where(gte(cronRuns.startedAt, since))
    .orderBy(cronRuns.jobName, desc(cronRuns.startedAt))

  return rows.map((row) => ({
    jobName: row.jobName,
    lastStartedAt: row.startedAt,
    lastOutcome: row.outcome,
    lastDurationMs: row.durationMs,
    lastDetail: row.detail,
  }))
}

/**
 * Lock de corrida para un cron, con `pg_try_advisory_lock`.
 *
 * Los jobs ya son idempotentes por CONTENIDO (`dedupeKey` de notificaciones,
 * `alertSentAt`, uniques de recordatorio), pero no por CORRIDA: dos disparos
 * solapados del scheduler leían ambos "todavía no notificado" antes de que
 * ninguno escribiera, y salía correo duplicado a prevencionistas y jefaturas,
 * además de contadores de recordatorio inflados en registros con valor legal.
 *
 * `try` y no `pg_advisory_lock`: si otra corrida está en curso, la segunda se
 * salta en vez de encolarse y agotar el timeout de la plataforma.
 *
 * ## Por qué se RESERVA una conexión
 *
 * `pg_try_advisory_lock` es un lock de SESIÓN: vive en la conexión que lo tomó
 * y sólo se suelta con `pg_advisory_unlock` EN ESA MISMA conexión, o cuando la
 * conexión se cierra. El pool tiene `max: 10`, así que un `db.execute` suelto
 * para el unlock puede caer en otra conexión: ahí Postgres devuelve `false` sin
 * lanzar, el `catch` no ve nada y el lock queda tomado hasta que `idle_timeout`
 * cierre la conexión original. El comentario anterior afirmaba que "el lock cae
 * al devolver la conexión al pool" — eso no existe en Postgres.
 *
 * `reserve()` saca una conexión del pool y la devuelve recién en `release()`,
 * así que lock y unlock comparten sesión por construcción.
 */
export async function withCronLock<T>(
  jobName: string,
  run: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  const key = `cron:${jobName}`
  const client = db.$client as unknown as {
    reserve?: () => Promise<{
      unsafe: (query: string, params?: unknown[]) => Promise<unknown>
      release: () => void
    }>
  }

  // Sin `reserve` (PGlite en pruebas, o un driver distinto) se cae al camino
  // anterior: menos garantía, pero el job igual corre.
  if (typeof client?.reserve !== "function") return runWithPooledLock(key, jobName, run)

  const connection = await client.reserve()
  try {
    const rows = await connection.unsafe("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [key]) as Array<{ locked: boolean }>
    if (!rows?.[0]?.locked) {
      logger.warn(`[cron/${jobName}] otra corrida está en curso; se omite este disparo`)
      await recordSkip(jobName, "otra corrida en curso")
      return { skipped: true, reason: "another run in progress" }
    }
    try {
      return await recorded(jobName, run)
    } finally {
      // Mismo `connection`, así que el unlock no puede fallar por conexión
      // equivocada. Si aun así devuelve false, se registra: es una señal real.
      const unlocked = await connection.unsafe("SELECT pg_advisory_unlock(hashtext($1)) AS unlocked", [key])
        .then((result) => (result as Array<{ unlocked: boolean }>)?.[0]?.unlocked ?? false)
        .catch(() => false)
      if (!unlocked) logger.error(`[cron/${jobName}] no se pudo liberar el lock de corrida`)
    }
  } finally {
    connection.release()
  }
}

/** Camino sin conexión reservada. Ver el docblock: el unlock es best-effort. */
async function runWithPooledLock<T>(
  key: string,
  jobName: string,
  run: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  const [acquired] = await db
    .execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_lock(hashtext(${key})) AS locked`)
    .then((result) => (result as unknown as { rows: Array<{ locked: boolean }> }).rows ?? [])

  if (!acquired?.locked) {
    logger.warn(`[cron/${jobName}] otra corrida está en curso; se omite este disparo`)
    await recordSkip(jobName, "otra corrida en curso")
    return { skipped: true, reason: "another run in progress" }
  }

  try {
    return await recorded(jobName, run)
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${key}))`).catch(() => {})
  }
}
