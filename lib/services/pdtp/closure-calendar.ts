/**
 * lib/services/pdtp/closure-calendar.ts
 *
 * Los datos del calendario de cierres mensuales (CHART-008): qué faenas debe
 * cerrar el programa de un año y qué meses ya tienen cierre vigente. La regla
 * —desde cuándo se debe, hasta cuándo, qué cierre vale— es la del cierre anual
 * (`year-close.ts`) y vive, probada, en `lib/prevention/pdtp-closure-calendar.ts`.
 *
 * Una consulta de lectura y nada más: no cierra ni reabre meses.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpPeriodClosures, pdtpProgramWorksites, pdtpPrograms, worksites } from "@/db/schema"
import { chileDateParts } from "@/lib/utils"
import { closureExigibleRange, type ClosureCalendarWorksite } from "@/lib/prevention/pdtp-closure-calendar"
import type { WorksiteScope } from "./helpers"
import { effectiveActivationFor, pdtpActivationPeriod } from "./period"
import { listPdtpProgramOperatingWorksiteIds } from "./worksites"

export interface PdtpClosureCalendarData {
  /** El año del programa. */
  year: number
  worksites: ClosureCalendarWorksite[]
  /** Meses con cierre vigente (no reabierto) por faena. */
  closedMonths: Map<string, Set<number>>
}

const EMPTY = (year: number): PdtpClosureCalendarData => ({ year, worksites: [], closedMonths: new Map() })

/**
 * Faenas y cierres del año de un programa, dentro del alcance del usuario.
 *
 * - **Alcance**: una faena fuera de `scope` no aparece ni como fila ni en los
 *   cierres; una lista vacía no tiene calendario.
 * - **Versiones**: el año puede tener varias versiones del programa. El cierre
 *   de cualquiera de ellas vale, y la exigibilidad parte con la primera que se
 *   activó (como el cierre anual: una v2 no hace desaparecer lo que la v1 ya cubría).
 * - Un programa que nunca se activó no exige nada: devuelve sin filas.
 * - **Filas**: las faenas que hoy operan el programa y las que tienen algún
 *   cierre (una faena dada de baja con cierres sigue en su historia).
 */
export async function getPdtpClosureCalendarData(programId: string, scope: WorksiteScope): Promise<PdtpClosureCalendarData | null> {
  const [program] = await db.select({ id: pdtpPrograms.id, year: pdtpPrograms.year })
    .from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null
  if (scope !== "all" && scope.length === 0) return EMPTY(program.year)

  const versions = await db.select({ id: pdtpPrograms.id, activatedAt: pdtpPrograms.activatedAt })
    .from(pdtpPrograms).where(eq(pdtpPrograms.year, program.year))
  const versionIds = versions.map((version) => version.id)
  const firstActivatedAt = versions
    .map((version) => version.activatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null
  if (!firstActivatedAt) return EMPTY(program.year)

  const [operating, closures, memberships] = await Promise.all([
    listPdtpProgramOperatingWorksiteIds(program.id),
    db.select({ worksiteId: pdtpPeriodClosures.worksiteId, month: pdtpPeriodClosures.month })
      .from(pdtpPeriodClosures)
      .where(and(
        inArray(pdtpPeriodClosures.programId, versionIds),
        eq(pdtpPeriodClosures.year, program.year),
        eq(pdtpPeriodClosures.status, "closed"),
      )),
    db.select({ worksiteId: pdtpProgramWorksites.worksiteId, addedAt: pdtpProgramWorksites.addedAt })
      .from(pdtpProgramWorksites)
      .where(inArray(pdtpProgramWorksites.programId, versionIds)),
  ])

  const inScope = (worksiteId: string) => scope === "all" || scope.includes(worksiteId)
  const closedMonths = new Map<string, Set<number>>()
  for (const closure of closures) {
    if (!inScope(closure.worksiteId)) continue
    const months = closedMonths.get(closure.worksiteId) ?? new Set<number>()
    months.add(closure.month)
    closedMonths.set(closure.worksiteId, months)
  }

  // La incorporación más antigua entre las versiones del año: una v2 no borra lo que la faena debía desde la v1.
  const addedAt = new Map<string, string>()
  for (const row of memberships) {
    const current = addedAt.get(row.worksiteId)
    if (!current || Date.parse(row.addedAt) < Date.parse(current)) addedAt.set(row.worksiteId, row.addedAt)
  }

  const candidateIds = [...new Set([...operating, ...closedMonths.keys()])].filter(inScope)
  if (candidateIds.length === 0) return EMPTY(program.year)
  const rows = await db.select({
    id: worksites.id, name: worksites.name, createdAt: worksites.createdAt, deactivatedAt: worksites.deactivatedAt,
  }).from(worksites).where(inArray(worksites.id, candidateIds))

  const result: ClosureCalendarWorksite[] = rows.map((row) => {
    // Sin membresía (programa corporativo) la faena debe desde que existe en la plataforma.
    const joinedAt = addedAt.get(row.id) ?? row.createdAt
    const { firstMonth, lastMonth } = closureExigibleRange({
      year: program.year,
      activation: pdtpActivationPeriod(effectiveActivationFor(firstActivatedAt, joinedAt)),
      deactivated: row.deactivatedAt ? chileDateParts(row.deactivatedAt) : null,
    })
    return { id: row.id, label: row.name, firstMonth, lastMonth }
  })
  return { year: program.year, worksites: result, closedMonths }
}
