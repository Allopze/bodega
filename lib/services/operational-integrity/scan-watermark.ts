import { eq, sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { systemSettings } from "@/db/schema"
import type { OperationalIntegrityFinding } from "./types"

type Domain = OperationalIntegrityFinding["domain"]

/**
 * TRZ-003 (auditoría 2026-09-14): el escaneo de integridad crecía con el
 * histórico completo. `scanStock` leía **todas** las filas de `worksite_stock` y
 * **todos** los `inventory_movements` del alcance, y `scanPurchasing` recorría
 * todas las OC no anuladas recalculando la conciliación de cada una. El costo
 * era proporcional a toda la historia operacional, no a lo ocurrido desde el
 * último escaneo, y la transacción `repeatable read` mantenía su snapshot cada
 * vez más tiempo (más riesgo de 40001).
 *
 * La marca de agua guarda, por dominio, el instante en que empezó el último
 * escaneo automático que terminó bien. El siguiente sólo mira lo que cambió
 * desde entonces.
 */
export function integrityScanWatermarkKey(domain: Domain) {
  return `operational_integrity:scan_watermark:${domain}`
}

/**
 * Margen que se resta a la marca de agua antes de recortar.
 *
 * El cron corre una vez al día (05:30 America/Santiago), así que la marca ya
 * cubre por sí sola las corridas que se hayan saltado: si el cron estuvo caído
 * una semana, la ventana abarca esa semana. Este margen es sólo el colchón
 * frente a desfases de reloj entre la aplicación y la base, filas escritas por
 * una transacción larga que confirma después de la marca y cualquier fecha
 * retrodatada. Una semana es deliberadamente generosa —el hallazgo se resuelve
 * con mucho menos—: el costo pasa de "todo el histórico" a "los últimos siete
 * días", y ante la duda se prefiere volver a mirar. Bajarlo es optimizar; no lo
 * hacemos sin una medición que lo pida.
 */
export const INTEGRITY_SCAN_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Inicio de la ventana a escanear, o `null` si hay que mirarlo todo (primera
 * corrida, marca ilegible o marca en el futuro). `null` significa siempre
 * "escaneo completo": ante cualquier duda, el detector ve la historia entera.
 */
export async function integrityScanWindowStart(tx: Tx, domain: Domain, now: Date): Promise<Date | null> {
  const [row] = await tx.select({ value: systemSettings.value }).from(systemSettings)
    .where(eq(systemSettings.key, integrityScanWatermarkKey(domain)))
  if (!row) return null
  const watermark = new Date(row.value)
  if (Number.isNaN(watermark.getTime()) || watermark.getTime() > now.getTime()) return null
  return new Date(watermark.getTime() - INTEGRITY_SCAN_OVERLAP_MS)
}

/**
 * Avanza la marca al instante en que empezó este escaneo —no al que terminó—:
 * lo que se haya escrito mientras corría cae dentro de la próxima ventana en vez
 * de perderse entre ambas.
 */
export async function saveIntegrityScanWatermark(tx: Tx, domain: Domain, startedAt: Date): Promise<void> {
  await tx.insert(systemSettings)
    .values({ key: integrityScanWatermarkKey(domain), value: startedAt.toISOString() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: startedAt.toISOString(), updatedAt: sql`now()` },
    })
}
