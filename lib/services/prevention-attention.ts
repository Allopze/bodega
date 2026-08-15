import { and, asc, eq, inArray, max, or } from "drizzle-orm"
import { db } from "@/db"
import {
  ppaSubmissions,
  preventionCapaActions,
  preventionCommitteeMeetings,
  preventionCommittees,
  sstEvaluations,
  worksites,
} from "@/db/schema"
import { adminContratoLabel } from "@/lib/prevention/admin-contrato-label"
import { assessMeetingCadence, isMandateExpired } from "@/lib/prevention/cphs"
import { capaPrioridad } from "@/lib/services/pdtp/capa-view"

export type PreventionAttentionItem = {
  id: string
  kind: "action" | "evaluation" | "ppa" | "cphs"
  title: string
  detail: string
  worksiteName: string
  dueDate: string | null
  href: string
  tone: "danger" | "warning" | "neutral"
}

/** Sin esto `warning` y `neutral` empataban y el orden dependía del azar. */
const TONE_RANK: Record<PreventionAttentionItem["tone"], number> = { danger: 0, warning: 1, neutral: 2 }

export async function getPreventionAttention(args: {
  worksiteIds: string[] | "all"
  includeActions: boolean
  includeEvaluations: boolean
  includePpa: boolean
  includeCphs?: boolean
  limit?: number
}): Promise<PreventionAttentionItem[]> {
  if (args.worksiteIds !== "all" && args.worksiteIds.length === 0) return []
  const scope = (column: typeof worksites.id) => args.worksiteIds === "all" ? undefined : inArray(column, args.worksiteIds)
  const limit = args.limit ?? 12
  const today = new Date().toISOString().slice(0, 10)

  const [actionRows = [], evalRows = [], ppaRows = []] = await Promise.all([
    args.includeActions
      // D11: la acción del PDTP se lee de su CAPA, que es donde vive el estado.
      // La faena es columna directa, así que la ejecución ya no hace falta.
      ? db.select({
          id: preventionCapaActions.id, accion: preventionCapaActions.actionDescription,
          responsable: preventionCapaActions.responsibleSnapshot,
          plazo: preventionCapaActions.targetDate, prioridad: preventionCapaActions.priority,
          worksiteId: preventionCapaActions.worksiteId, worksiteName: worksites.name,
        }).from(preventionCapaActions)
          .innerJoin(worksites, eq(preventionCapaActions.worksiteId, worksites.id))
          .where(and(
            scope(worksites.id),
            eq(preventionCapaActions.sourceType, "pdtp"),
            inArray(preventionCapaActions.status, ["pending", "in_progress", "reopened"]),
          ))
          .orderBy(asc(preventionCapaActions.targetDate)).limit(limit)
      : Promise.resolve([]),
    args.includeEvaluations
      ? db.select({ id: sstEvaluations.id, fecha: sstEvaluations.fechaEvaluacion, role: sstEvaluations.evaluatorRole, worksiteName: worksites.name, adminContratoLabel: worksites.adminContratoLabel })
          .from(sstEvaluations).innerJoin(worksites, eq(sstEvaluations.worksiteId, worksites.id))
          .where(and(scope(worksites.id), eq(sstEvaluations.estado, "borrador"))).orderBy(asc(sstEvaluations.fechaEvaluacion)).limit(limit)
      : Promise.resolve([]),
    args.includePpa
      ? db.select({ id: ppaSubmissions.id, workerName: ppaSubmissions.workerName, estado: ppaSubmissions.estado, createdAt: ppaSubmissions.createdAt, worksiteName: worksites.name })
          .from(ppaSubmissions).innerJoin(worksites, eq(ppaSubmissions.worksiteId, worksites.id))
          .where(and(scope(worksites.id), or(eq(ppaSubmissions.estado, "detenido"), eq(ppaSubmissions.estado, "en_correccion"))))
          .orderBy(asc(ppaSubmissions.createdAt)).limit(limit)
      : Promise.resolve([]),
  ])

  const items: PreventionAttentionItem[] = []

  items.push(...actionRows.map((row) => ({
    id: `action:${row.id}`, kind: "action" as const, title: row.accion,
    // La prioridad llega en vocabulario CAPA y esto se imprime tal cual: sin
    // traducir mostraría "Acción high" en una pantalla en español.
    detail: `Acción ${capaPrioridad(row.prioridad)} · ${row.responsable ?? "sin responsable"}`,
    worksiteName: row.worksiteName, dueDate: row.plazo,
    href: `/prevencion/pdtp/acciones?faena=${row.worksiteId}`,
    tone: row.plazo <= today ? "danger" as const : "warning" as const,
  })))

  items.push(...evalRows.map((row) => ({
    id: `evaluation:${row.id}`, kind: "evaluation" as const, title: "Evaluación SST pendiente",
    detail: row.role === "admin_contrato" ? adminContratoLabel(row.adminContratoLabel) : row.role === "conductor_lider" ? "Conductor líder" : "Prevencionista de faena",
    worksiteName: row.worksiteName, dueDate: row.fecha, href: `/prevencion/${row.id}`, tone: "warning" as const,
  })))

  items.push(...ppaRows.map((row) => ({
    id: `ppa:${row.id}`, kind: "ppa" as const, title: `PPA ${row.estado === "detenido" ? "detenido" : "en corrección"}`,
    detail: row.workerName, worksiteName: row.worksiteName, dueDate: row.createdAt.slice(0, 10),
    href: `/prevencion/ppa/${row.id}`, tone: row.estado === "detenido" ? "danger" as const : "warning" as const,
  })))

  if (args.includeCphs) items.push(...await cphsAttentionItems(scope, today, limit))

  return items
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]
      || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, limit)
}

/**
 * Dos deberes del comité que sólo se notaban leyendo su ficha: el mandato por
 * vencer y la cadencia mensual. La cadencia se calcula con la misma función
 * pura que usa la pantalla del comité, no con una regla paralela en SQL.
 */
async function cphsAttentionItems(
  scope: (column: typeof worksites.id) => ReturnType<typeof inArray> | undefined,
  today: string,
  limit: number,
): Promise<PreventionAttentionItem[]> {
  const committees = await db.select({
    id: preventionCommittees.id,
    name: preventionCommittees.name,
    mandateEndsOn: preventionCommittees.mandateEndsOn,
    createdAt: preventionCommittees.createdAt,
    worksiteName: worksites.name,
  })
    .from(preventionCommittees)
    .innerJoin(worksites, eq(preventionCommittees.worksiteId, worksites.id))
    .where(and(scope(worksites.id), eq(preventionCommittees.status, "active")))
    .limit(limit)
  if (committees.length === 0) return []

  const lastMeetings = await db.select({
    committeeId: preventionCommitteeMeetings.committeeId,
    lastClosedAt: max(preventionCommitteeMeetings.closedAt),
  })
    .from(preventionCommitteeMeetings)
    .where(and(
      inArray(preventionCommitteeMeetings.committeeId, committees.map((row) => row.id)),
      eq(preventionCommitteeMeetings.status, "closed"),
    ))
    .groupBy(preventionCommitteeMeetings.committeeId)
  const lastBy = new Map(lastMeetings.map((row) => [row.committeeId, row.lastClosedAt]))

  const now = new Date().toISOString()
  const items: PreventionAttentionItem[] = []

  for (const committee of committees) {
    const href = `/prevencion/cphs/${committee.id}`
    const expired = isMandateExpired(committee.mandateEndsOn, today)
    if (expired || committee.mandateEndsOn <= addDaysIso(today, 60)) {
      items.push({
        id: `cphs:${committee.id}:mandate`, kind: "cphs",
        title: expired ? "Mandato del comité vencido" : "Mandato del comité por vencer",
        detail: committee.name, worksiteName: committee.worksiteName,
        dueDate: committee.mandateEndsOn, href, tone: expired ? "danger" : "warning",
      })
    }

    // Un comité con el mandato vencido ya está reportado arriba; insistir con
    // su cadencia sería contar el mismo problema dos veces.
    if (!expired && assessMeetingCadence(lastBy.get(committee.id) ?? null, now).overdue) {
      items.push({
        id: `cphs:${committee.id}:cadence`, kind: "cphs",
        title: "El comité lleva dos meses o más sin sesionar",
        detail: committee.name, worksiteName: committee.worksiteName,
        dueDate: null, href, tone: "warning",
      })
    }
  }

  return items
}

function addDaysIso(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}
