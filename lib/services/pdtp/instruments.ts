/**
 * lib/services/pdtp/instruments.ts
 *
 * "El instrumento que acredita este número está vigente", en un solo lugar.
 *
 * Declarar no es poder ejecutar, y la compuerta confundía las dos cosas: daba
 * por cableada una actividad cuya plantilla estaba en borrador —y sólo una
 * plantilla `approved` se puede programar o ejecutar—, cuyo curso no tenía
 * ninguna versión `published` —`createTrainingSession` la exige— o cuyo plan de
 * emergencia seguía en `draft`, que es lo que la N°84 necesita aprobado para
 * poder programar un simulacro.
 *
 * El preflight ya calculaba una parte de esto por su cuenta y la dejaba fuera
 * de su propio `ok`. Dos lugares que opinan sobre lo mismo se desincronizan y
 * el que avisa termina mintiendo, así que la respuesta vive acá y los dos la
 * consultan.
 *
 * `sst_document_types` no participa: no tiene columna de estado, y el
 * instrumento de la N°36 y la N°43 es el documento publicado, que es un hecho y
 * no una configuración.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCampaigns,
  preventionEmergencyPlans,
  preventionInspectionTemplates,
  preventionTrainingCourses,
  preventionTrainingCourseVersions,
  sstDocumentTypes,
} from "@/db/schema"

type QueryClient = DB | Tx

export async function usablePdtpInstrumentNumbers(client: QueryClient = db): Promise<{
  global: Set<number>
  perWorksite: Map<number, Set<string>>
}> {
  const [approvedTemplates, courses, docTypes] = await Promise.all([
    client.select({ n: preventionInspectionTemplates.pdtpActivityNumbers })
      .from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.status, "approved")),
    client.select({
      id: preventionTrainingCourses.id,
      n: preventionTrainingCourses.pdtpActivityNumbers,
      minimumDurationMinutes: preventionTrainingCourses.minimumDurationMinutes,
    }).from(preventionTrainingCourses),
    client.select({
      n: sstDocumentTypes.pdtpActivityNumbers,
      ack: sstDocumentTypes.pdtpAcknowledgmentActivityNumbers,
    }).from(sstDocumentTypes),
  ])

  // Un curso cuenta cuando alguna de sus versiones está `published`:
  // `createTrainingSession` rechaza cualquier otro estado. Mismo join que ya
  // hace el preflight para su propio reporte no-bloqueante.
  const publishedVersions = courses.length === 0 ? [] : await client.select({
    courseId: preventionTrainingCourseVersions.courseId,
    durationMinutes: preventionTrainingCourseVersions.durationMinutes,
  }).from(preventionTrainingCourseVersions).where(and(
    inArray(preventionTrainingCourseVersions.courseId, courses.map((course) => course.id)),
    eq(preventionTrainingCourseVersions.status, "published"),
  ))
  const minimumDurationByCourseId = new Map(courses.map((course) => [course.id, course.minimumDurationMinutes]))
  const publishedCourseIds = new Set<string>()
  for (const row of publishedVersions) {
    if (row.durationMinutes >= (minimumDurationByCourseId.get(row.courseId) ?? Number.POSITIVE_INFINITY)) {
      publishedCourseIds.add(row.courseId)
    }
  }

  const global = new Set<number>()
  for (const row of approvedTemplates) for (const n of (row.n as number[] | null) ?? []) global.add(n)
  for (const course of courses) {
    if (!publishedCourseIds.has(course.id)) continue
    for (const n of (course.n as number[] | null) ?? []) global.add(n)
  }
  for (const row of docTypes) {
    for (const n of (row.n as number[] | null) ?? []) global.add(n)
    for (const n of (row.ack as number[] | null) ?? []) global.add(n)
  }

  // Campañas sin condición de estado: una campaña en borrador es trabajo por
  // hacer, no un instrumento faltante. Planes de emergencia `approved` —
  // excluyendo `archived`, el tercer valor del CHECK.
  const [campaigns, plans] = await Promise.all([
    client.select({ n: preventionCampaigns.pdtpActivityNumbers, worksiteId: preventionCampaigns.worksiteId })
      .from(preventionCampaigns),
    client.select({ n: preventionEmergencyPlans.pdtpActivityNumbers, worksiteId: preventionEmergencyPlans.worksiteId })
      .from(preventionEmergencyPlans)
      .where(eq(preventionEmergencyPlans.status, "approved")),
  ])
  const perWorksite = new Map<number, Set<string>>()
  for (const rows of [campaigns, plans]) {
    for (const row of rows) {
      for (const n of (row.n as number[] | null) ?? []) {
        const set = perWorksite.get(n) ?? new Set<string>()
        set.add(row.worksiteId)
        perWorksite.set(n, set)
      }
    }
  }

  return { global, perWorksite }
}
