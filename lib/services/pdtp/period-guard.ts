/**
 * lib/services/pdtp/period-guard.ts
 *
 * El guard de "mes cerrado", solo.
 *
 * Vive aparte de `period-closures.ts` por una razón concreta de grafo de
 * módulos: lo llaman `executions.ts`, `deviations.ts` y `overrides.ts`, y
 * `period-closures.ts` importa —para armar la foto— `re36-document.ts`,
 * `compliance.ts` y `management-report.ts`, que a su vez llegan a `helpers.ts`,
 * que importa `overrides.ts` y `deviations.ts`. Poner el guard allá metía a las
 * tres escrituras en un ciclo de importación largo y sin ninguna necesidad:
 * para saber si un mes está cerrado basta una fila de `pdtp_period_closures`.
 *
 * `period-closures.ts` lo reexporta, así que el resto del código puede seguir
 * importando `assertPdtpPeriodOpen` desde ahí.
 */

import { and, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpPeriodClosures } from "@/db/schema"

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** "marzo de 2026" — para mensajes de error legibles en faena. */
export function pdtpMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? String(month)} de ${year}`
}

/**
 * Lanza si el mes de esa faena está cerrado.
 *
 * **Se llama dentro de la transacción de la escritura**, pasando el `tx`: una
 * lectura previa y por fuera vuelve a ser obsoleta en cuanto otra transacción
 * cierra el mes entre la comprobación y el INSERT. Es el mismo criterio que la
 * exclusión mutua celda-desvío de `executions.ts` y `deviations.ts`.
 *
 * Un cierre `reopened` no bloquea: reabrir es exactamente la operación que
 * devuelve la escritura.
 */
export async function assertPdtpPeriodOpen(
  programId: string,
  worksiteId: string,
  year: number,
  month: number,
  client: Tx | typeof db = db,
): Promise<void> {
  const [closure] = await client.select({ status: pdtpPeriodClosures.status })
    .from(pdtpPeriodClosures)
    .where(and(
      eq(pdtpPeriodClosures.programId, programId),
      eq(pdtpPeriodClosures.worksiteId, worksiteId),
      eq(pdtpPeriodClosures.year, year),
      eq(pdtpPeriodClosures.month, month),
    ))
    .limit(1)
  if (closure?.status === "closed") {
    throw new Error(`El mes de ${pdtpMonthLabel(year, month)} está cerrado para esta faena. Reábrelo con un motivo si necesitas corregir algo.`)
  }
}
