/**
 * lib/services/pdtp/request-cache.ts
 *
 * I12 (T7b): lecturas base del cumplimiento PDTP, deduplicadas **dentro de un
 * request** con `React.cache` y sólo con argumentos primitivos (un id o un
 * año), para que la clave de la memoria sea estable.
 *
 * El tablero pide el mismo programa, su ventana de versión y sus actividades
 * desde el indicador, el avance por eje y la planilla agregada; la ficha del
 * programa, desde la planilla y el indicador. Con esto cada lectura sale una
 * vez por render. Fuera de un render de Server Components —pruebas, scripts,
 * crons, server actions— `cache` no memoriza y cada llamada consulta como
 * antes, así que una mutación nunca lee una fila vieja de acá.
 *
 * D25: nada de esto sobrevive al request (ni la caché de datos de Next ni la
 * directiva de caché). Una ejecución aprobada se ve en la siguiente carga, no
 * cuando expire algo. Lo vigila `pdtp-compliance-performance.test.ts`.
 *
 * Lo que devuelven se comparte entre quienes llaman en el mismo render: no se
 * muta.
 */
import { cache } from "react"
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms } from "@/db/schema"
import { loadPdtpVersionWindow, loadPdtpYearVersionWindows } from "./version-window"

export type PdtpCachedProgram = typeof pdtpPrograms.$inferSelect

export const loadPdtpProgramForRequest = cache(async (programId: string): Promise<PdtpCachedProgram | null> => {
  const [found] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  return found ?? null
})

/** La versión que representa al año: la activa, o la más reciente de las diez últimas. */
export const loadPdtpProgramForYearForRequest = cache(async (year: number): Promise<PdtpCachedProgram | null> => {
  const programs = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year)).orderBy(desc(pdtpPrograms.version)).limit(10)
  return programs.find((p) => p.status === "active") ?? programs[0] ?? null
})

export const loadPdtpVersionWindowForRequest = cache((programId: string) => loadPdtpVersionWindow(programId))

export const loadPdtpYearVersionWindowsForRequest = cache((year: number) => loadPdtpYearVersionWindows(year))

/** Las columnas de actividad que usan el indicador y el avance por eje. */
export type PdtpIndicatorActivity = {
  id: string
  n: number
  catalogActivityId: string | null
  /** Eje SG-SST (`pdtpActivities.program`): lo usa el avance por eje. */
  program: string
  indicatorMode: string
  subjectSource: string | null
  subjectCapabilityCodes: string[] | null
  scheduleDefinition: unknown
  minAnnualExecutions: number | null
  status: string
  retiredEffectiveFrom: string | null
}

export const loadPdtpIndicatorActivitiesForRequest = cache((programId: string): Promise<PdtpIndicatorActivity[]> => db.select({
  id: pdtpActivities.id,
  n: pdtpActivities.n,
  catalogActivityId: pdtpActivities.catalogActivityId,
  program: pdtpActivities.program,
  indicatorMode: pdtpActivities.indicatorMode,
  subjectSource: pdtpActivities.subjectSource,
  subjectCapabilityCodes: pdtpActivities.subjectCapabilityCodes,
  scheduleDefinition: pdtpActivities.scheduleDefinition,
  minAnnualExecutions: pdtpActivities.minAnnualExecutions,
  status: pdtpActivities.status,
  retiredEffectiveFrom: pdtpActivities.retiredEffectiveFrom,
}).from(pdtpActivities)
  .where(eq(pdtpActivities.programId, programId)))
