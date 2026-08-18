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
 * El lock es de sesión y se libera solo al devolver la conexión al pool, pero
 * se libera explícitamente en `finally` para no depender de eso.
 */
export async function withCronLock<T>(
  jobName: string,
  run: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  const [acquired] = await db
    .execute<{ locked: boolean }>(sql`SELECT pg_try_advisory_lock(hashtext(${`cron:${jobName}`})) AS locked`)
    .then((result) => (result as unknown as { rows: Array<{ locked: boolean }> }).rows ?? [])

  if (!acquired?.locked) {
    logger.warn(`[cron/${jobName}] otra corrida está en curso; se omite este disparo`)
    return { skipped: true, reason: "another run in progress" }
  }

  try {
    return await run()
  } finally {
    await db
      .execute(sql`SELECT pg_advisory_unlock(hashtext(${`cron:${jobName}`}))`)
      .catch(() => { /* la conexión se devuelve al pool y el lock cae con ella */ })
  }
}
