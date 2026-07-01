/**
 * lib/services/prevention-kpis.ts
 * Tasas de frecuencia/gravedad conectadas a incidentes reales (N° 7 PDTP).
 *
 * Índice de frecuencia (IF) = (N° accidentes × 10^6) / horas hombre trabajadas (HHT).
 * Índice de gravedad (IG) requiere "días perdidos" por accidente, dato que hoy
 * no existe en `prevention_incidents` — no se calcula (ver AUDITORIA_PREVENCION.md).
 */

import { and, eq, gte, like, lte } from "drizzle-orm"
import { db } from "@/db"
import { laborHours, preventionIncidents } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { laborHoursSetSchema } from "@/lib/validation/prevention"

type WorksiteScope = string[] | "all"

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) throw new Error("Sin acceso a esta faena.")
}

export async function setLaborHours(input: unknown, scope: WorksiteScope) {
  const data = laborHoursSetSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)

  const existing = await db.select().from(laborHours)
    .where(and(eq(laborHours.worksiteId, data.worksiteId), eq(laborHours.period, data.period)))
    .limit(1)

  if (existing[0]) {
    const [row] = await db.update(laborHours)
      .set({ hours: data.hours })
      .where(eq(laborHours.id, existing[0].id))
      .returning()
    if (!row) throw new Error("No se pudo actualizar las horas hombre.")
    return row
  }

  const [row] = await db.insert(laborHours).values({
    id: `lhr-${nanoid()}`,
    worksiteId: data.worksiteId,
    period: data.period,
    hours: data.hours,
    createdAt: new Date().toISOString(),
  }).returning()
  if (!row) throw new Error("No se pudo registrar las horas hombre.")
  return row
}

export async function listLaborHours(worksiteId: string, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)
  return db.select().from(laborHours).where(eq(laborHours.worksiteId, worksiteId)).orderBy(laborHours.period)
}

export async function getIncidentFrequencyRate(worksiteId: string, year: number, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)

  const yearStart = `${year}-01-01T00:00:00.000Z`
  const yearEnd = `${year}-12-31T23:59:59.999Z`

  const [hoursRows, accidentRows] = await Promise.all([
    db.select().from(laborHours).where(and(eq(laborHours.worksiteId, worksiteId), like(laborHours.period, `${year}-%`))),
    db.select({ id: preventionIncidents.id }).from(preventionIncidents).where(and(
      eq(preventionIncidents.worksiteId, worksiteId),
      eq(preventionIncidents.type, "accidente"),
      gte(preventionIncidents.occurredAt, yearStart),
      lte(preventionIncidents.occurredAt, yearEnd),
    )),
  ])

  const totalHours = hoursRows.reduce((sum, row) => sum + row.hours, 0)
  const accidentCount = accidentRows.length

  return {
    year,
    accidentCount,
    totalHours,
    frequencyRate: totalHours > 0 ? (accidentCount * 1_000_000) / totalHours : null,
    // Índice de gravedad: bloqueado — prevention_incidents no registra días perdidos.
    severityRate: null as number | null,
  }
}
