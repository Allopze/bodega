import { sql } from "drizzle-orm"
import { db } from "@/db"
import { logger } from "@/lib/logger"

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
      return { skipped: true, reason: "another run in progress" }
    }
    try {
      return await run()
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
    return { skipped: true, reason: "another run in progress" }
  }

  try {
    return await run()
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${key}))`).catch(() => {})
  }
}
