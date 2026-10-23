import "server-only"
import type { Session } from "next-auth"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelEquipmentLoads } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { logger } from "@/lib/logger"

/** Estados de un caso de anomalía que todavía piden una decisión. */
export const OPEN_ANOMALY_STATUSES = ["open", "in_review", "reopened"] as const
/** Valor de `?estado=` en `/combustibles/anomalias` que lista exactamente esos estados. */
export const ANOMALY_OPEN_FILTER = "vigentes"
export const ANOMALY_OPEN_FILTER_LABEL = "Vigentes (abiertos, en revisión o reabiertos)"

export interface RevisionCounts {
  /** Cargas del control marcadas para revisión. `null` si la consulta falló. */
  flagged: number | null
  /** Casos de anomalía vigentes. `null` si la consulta falló. */
  anomalies: number | null
}

/**
 * Pendientes de las dos colas de «Revisión», dentro del alcance de faenas de la
 * sesión. Cada conteo cae a `null` por separado: un número que no se pudo
 * calcular no se pinta como cero.
 */
export async function loadRevisionCounts(session: Session): Promise<RevisionCounts> {
  const [flagged, anomalies] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(fuelEquipmentLoads)
      .where(and(eq(fuelEquipmentLoads.reviewStatus, "flagged"), worksiteScopeSql(session, fuelEquipmentLoads.worksiteId)))
      .then((rows) => rows[0]?.count ?? 0)
      .catch((error: unknown) => {
        logger.error("[combustibles/revision] conteo de cargas marcadas falló", error)
        return null
      }),
    db.select({ count: sql<number>`count(*)::int` }).from(fuelAnomalyCases)
      .where(and(inArray(fuelAnomalyCases.status, [...OPEN_ANOMALY_STATUSES]), worksiteScopeSql(session, fuelAnomalyCases.worksiteId)))
      .then((rows) => rows[0]?.count ?? 0)
      .catch((error: unknown) => {
        logger.error("[combustibles/revision] conteo de anomalías falló", error)
        return null
      }),
  ])
  return { flagged, anomalies }
}
