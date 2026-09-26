/**
 * lib/services/pdtp/operational-years.ts
 *
 * PREV-C03.7: año operativo y año en cierre, leídos de la base. Vive aparte de
 * `lifecycle.ts` para que las pantallas y servicios de los submódulos
 * (capacitación, casillas, tablero) puedan resolver el año por omisión sin
 * arrastrar todo el ciclo de vida del programa. La regla es
 * `resolvePdtpOperationalYears` (period.ts).
 */

import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpPrograms } from "@/db/schema"
import { codeYear } from "@/lib/utils"
import { resolvePdtpOperationalYears, type PdtpOperationalYears } from "./period"

export async function getPdtpOperationalYears(now: Date = new Date()): Promise<PdtpOperationalYears> {
  const calendarYear = codeYear(now)
  const programs = await db.select({ year: pdtpPrograms.year, status: pdtpPrograms.status, yearClosedAt: pdtpPrograms.yearClosedAt })
    .from(pdtpPrograms)
    .where(inArray(pdtpPrograms.year, [calendarYear - 1, calendarYear]))
  return resolvePdtpOperationalYears(programs, calendarYear)
}
