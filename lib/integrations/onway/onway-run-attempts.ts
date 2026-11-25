/**
 * Lectura de la última corrida de OnWay, fuera de `onway-sync.ts`.
 *
 * Existe para que `onway-client.ts` pueda consultar la cuarentena sin importar
 * `onway-sync.ts`: ese módulo ya importa al cliente, así que la dependencia
 * inversa sería un ciclo de módulos.
 *
 * Devuelve la forma mínima que consumen las reglas puras de
 * `onway-auth-cooldown.ts`: una fila, sin estado en memoria que un reinicio
 * pueda perder.
 */

import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { fleetGpsSyncRuns } from "@/db/schema"
import type { OnwayRunAttempt } from "./onway-auth-cooldown"

/** Última corrida de OnWay. `undefined` si nunca corrió. */
export async function readLatestOnwayRunAttempt(): Promise<OnwayRunAttempt | undefined> {
  const [latest] = await db.select({
    startedAt: fleetGpsSyncRuns.startedAt,
    status: fleetGpsSyncRuns.status,
    errorCode: fleetGpsSyncRuns.errorCode,
  })
    .from(fleetGpsSyncRuns)
    .where(eq(fleetGpsSyncRuns.provider, "onway"))
    .orderBy(desc(fleetGpsSyncRuns.startedAt))
    .limit(1)
  return latest
}
