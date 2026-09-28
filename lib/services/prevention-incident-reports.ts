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
import { INCIDENT_EVENT_TYPES, reportPreventionIncident, type IncidentAccess } from "@/lib/services/prevention-incidents"
import { chileLocalDateTimeToUtc, codeYear } from "@/lib/utils"
import { reasonSchema } from "@/lib/validation/reason-thresholds"

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

/*
 * Triage del buzón. Antes existía `triagePublicIncidentReport` sin llamador y
 * sin acceso: ni permiso ni faena, así que no podía exponerse y los reportes
 * quedaban `pending` para siempre. Las dos salidas exigen ahora el permiso de
 * triage de incidentes en la faena del reporte, el mismo que clasifica un
 * incidente formal: decidir si algo es un incidente es el mismo acto.
 */

const TRIAGE_PERMISSION = "prevention:incidents:triage"

async function loadPendingReportForTriage(reportId: string, access: IncidentAccess) {
  const [report] = await db.select().from(preventionIncidentPublicReports)
    .where(eq(preventionIncidentPublicReports.id, reportId)).limit(1)
  const inScope = report && (access.scope.mode === "all"
    || (access.scope.mode === "some" && access.scope.ids.includes(report.worksiteId)))
  if (!report || !inScope || !access.permissions.includes(TRIAGE_PERMISSION)) {
    throw new Error("Reporte no encontrado o fuera de alcance.")
  }
  if (report.status !== "pending") throw new Error("El reporte ya fue triado o no existe.")
  return report
}

const discardSchema = z.object({
  reportId: z.string().min(1),
  reason: reasonSchema("por qué se descarta el reporte"),
})

/** Descarta un reporte del buzón con motivo. No abre ni toca incidentes. */
export async function discardPublicIncidentReport(args: { reportId: string; reason: string; access: IncidentAccess }) {
  const data = discardSchema.parse({ reportId: args.reportId, reason: args.reason })
  await loadPendingReportForTriage(data.reportId, args.access)
  const now = new Date().toISOString()
  const [updated] = await db.update(preventionIncidentPublicReports).set({
    status: "discarded",
    triagedByUserId: args.access.ctx.userId,
    triagedAt: now,
    triageNotes: data.reason,
    incidentId: null,
    updatedAt: now,
  }).where(and(
    eq(preventionIncidentPublicReports.id, data.reportId),
    eq(preventionIncidentPublicReports.status, "pending"),
  )).returning()
  if (!updated) throw new Error("El reporte ya fue triado o no existe.")
  return updated
}

const convertSchema = z.object({
  reportId: z.string().min(1),
  eventType: z.enum(INCIDENT_EVENT_TYPES, "Selecciona el tipo de evento"),
  companyName: z.string().trim().min(2, "Indica la empresa del evento").max(300),
  occurredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Indica la hora aproximada del evento"),
  notes: reasonSchema("por qué se abre el incidente"),
})

/**
 * Convierte un reporte del buzón en el incidente formal, por la misma puerta
 * que cualquier reporte (`reportPreventionIncident`: su permiso, sus carriles y
 * sus plazos). Lo que el trabajador escribió se copia tal cual; quien tría sólo
 * aporta lo que el canal no pide —tipo de evento, empresa y hora—.
 */
export async function convertPublicIncidentReport(args: { input: unknown; access: IncidentAccess }) {
  const data = convertSchema.parse(args.input)
  const report = await loadPendingReportForTriage(data.reportId, args.access)
  return reportPreventionIncident({
    access: args.access,
    input: {
      // Determinista por reporte: un doble envío del diálogo es un replay, no
      // un segundo expediente.
      clientSubmissionId: `public-report:${report.id}`,
      worksiteId: report.worksiteId,
      companyName: data.companyName,
      eventType: data.eventType,
      occurredAt: chileLocalDateTimeToUtc(`${report.occurredAt}T${data.occurredTime}`),
      // La organización conoció el hecho cuando el reporte llegó al buzón, no
      // cuando alguien lo leyó: desde ahí corre el plazo DIAT/DIEP.
      knownAt: new Date(report.createdAt).toISOString(),
      location: report.location,
      initialNarrative: report.narrative,
      people: [],
    },
    fromPublicReport: { reportId: report.id, notes: data.notes },
  })
}
