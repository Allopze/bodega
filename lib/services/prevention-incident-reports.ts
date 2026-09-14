/**
 * INC-001 (auditoría 2026-09-14) — El canal de reporte del trabajador, con vía
 * anónima.
 *
 * Antes, reportar un incidente exigía `prevention:incidents:report`, concedido
 * a prevencionista, prevencionista de faena, administrador de contrato, jefe
 * de terreno y equivalentes. Un trabajador que presenciaba un cuasi accidente
 * dependía de que un mando lo registrara, y no había ni ruta pública ni campo
 * para reportar sin dar el nombre. El módulo hacía muy bien todo lo que viene
 * después del reporte; faltaba la puerta de entrada.
 *
 * Dos decisiones que conviene tener a la vista:
 *
 * 1. **El reporte no es un incidente.** Esto escribe en un buzón
 *    (`prevention_incident_public_reports`) y no toca `prevention_incidents`:
 *    el expediente formal conserva intactos su código, su plazo legal, su
 *    responsable y su segregación. Quien tiene el permiso tría el buzón y
 *    decide. Abrir el incidente formal directamente desde el reporte sería
 *    dejar que cualquiera sin sesión dispare los plazos DIAT/DIEP.
 *
 * 2. **Anónimo quiere decir anónimo.** Ni esta función ni la acción pública
 *    guardan usuario, sesión, IP o user agent junto al reporte, ni escriben
 *    una línea de auditoría que permita cruzarlo con quién estaba conectado.
 *    La cuota por IP que frena el abuso vive en el limitador de la acción y no
 *    deja rastro en la fila. Un canal de denuncia rastreable —por sesión o por
 *    IP en la auditoría— no es un canal de denuncia: la persona que ve algo y
 *    teme represalias es exactamente a quien este canal existe para servir.
 *
 * Lo que queda por decidir, y no se inventa acá: qué hace la organización con
 * un reporte anónimo que no puede investigarse sin hablar con quien lo hizo, y
 * en qué plazo debe triarse el buzón. Hoy no hay SLA ni recordatorio propio.
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import { preventionIncidentPublicReports, worksites } from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { INCIDENT_REPORT_CATEGORIES } from "@/lib/prevention/incident-report-categories"
import { codeYear } from "@/lib/utils"

export { INCIDENT_REPORT_CATEGORIES, INCIDENT_REPORT_CATEGORY_LABELS } from "@/lib/prevention/incident-report-categories"

export const publicIncidentReportSchema = z.object({
  worksiteId: z.string().min(1, "Selecciona la faena"),
  category: z.enum(INCIDENT_REPORT_CATEGORIES),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  location: z.string().trim().min(3, "Indica dónde ocurrió").max(300),
  narrative: z.string().trim().min(10, "Describe lo que pasó en al menos 10 caracteres").max(4000),
  isAnonymous: z.boolean(),
  reporterName: z.string().trim().max(200).nullable().optional(),
  reporterContact: z.string().trim().max(200).nullable().optional(),
}).superRefine((data, ctx) => {
  // El anonimato se respeta aunque el formulario mande basura: si la persona
  // eligió no identificarse, no se guarda identidad. Ver el CHECK homónimo.
  if (data.isAnonymous) return
  if (!data.reporterName || data.reporterName.trim().length < 3) {
    ctx.addIssue({ code: "custom", path: ["reporterName"], message: "Escribe tu nombre o marca el reporte como anónimo" })
  }
})

function reportCode() {
  return `RPT-${codeYear()}-${nanoid(8).toUpperCase()}`
}

/**
 * Registra un reporte del canal público. **Sin sesión y sin identidad
 * técnica**: los únicos datos de la persona son los que ella escribió, y sólo
 * si eligió identificarse.
 */
export async function submitPublicIncidentReport(input: unknown) {
  const data = publicIncidentReportSchema.parse(input)
  const [worksite] = await db.select({ id: worksites.id })
    .from(worksites)
    .where(and(eq(worksites.id, data.worksiteId), eq(worksites.isActive, true)))
    .limit(1)
  if (!worksite) throw new Error("La faena seleccionada no existe o está inactiva.")

  const now = new Date().toISOString()
  const [created] = await db.insert(preventionIncidentPublicReports).values({
    id: `incrpt-${nanoid()}`,
    code: reportCode(),
    worksiteId: data.worksiteId,
    category: data.category,
    occurredAt: data.occurredAt,
    location: data.location,
    narrative: data.narrative,
    isAnonymous: data.isAnonymous,
    // El anonimato se aplica acá, no en el cliente: si es anónimo, la
    // identidad no llega a la base aunque venga en el payload.
    reporterName: data.isAnonymous ? null : (data.reporterName?.trim() || null),
    reporterContact: data.isAnonymous ? null : (data.reporterContact?.trim() || null),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }).returning()
  if (!created) throw new Error("No se pudo registrar el reporte.")
  // Devuelve el código para que la persona pueda referirse a su reporte sin
  // identificarse: es el único acuse que puede darse a un canal anónimo.
  return { code: created.code }
}

/** El buzón, para quien tiene el permiso de reportar/gestionar incidentes. */
export async function listPublicIncidentReports(args: {
  scope: WorksiteScope
  status?: "pending" | "triaged" | "discarded"
  limit?: number
}) {
  const scopeFilter = args.scope.mode === "all"
    ? undefined
    : inArray(preventionIncidentPublicReports.worksiteId, args.scope.ids.length > 0 ? args.scope.ids : [""])
  return db.select().from(preventionIncidentPublicReports)
    .where(and(scopeFilter, args.status ? eq(preventionIncidentPublicReports.status, args.status) : undefined))
    .orderBy(desc(preventionIncidentPublicReports.createdAt))
    .limit(args.limit ?? 100)
}

/**
 * Cierra el triage de un reporte. No abre el incidente formal por sí solo: eso
 * sigue pasando por `reportPreventionIncident`, con su permiso y sus plazos.
 */
export async function triagePublicIncidentReport(args: {
  reportId: string
  status: "triaged" | "discarded"
  notes: string
  incidentId?: string | null
  actorUserId: string
}) {
  const now = new Date().toISOString()
  const [updated] = await db.update(preventionIncidentPublicReports).set({
    status: args.status,
    triagedByUserId: args.actorUserId,
    triagedAt: now,
    triageNotes: args.notes,
    incidentId: args.incidentId ?? null,
    updatedAt: now,
  }).where(and(
    eq(preventionIncidentPublicReports.id, args.reportId),
    eq(preventionIncidentPublicReports.status, "pending"),
  )).returning()
  if (!updated) throw new Error("El reporte ya fue triado o no existe.")
  return updated
}
