import { and, asc, eq, inArray, or } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActionPlan, pdtpExecutions, ppaSubmissions, sstEvaluations, worksites } from "@/db/schema"

export type PreventionAttentionItem = {
  id: string
  kind: "action" | "evaluation" | "ppa"
  title: string
  detail: string
  worksiteName: string
  dueDate: string | null
  href: string
  tone: "danger" | "warning" | "neutral"
}

export async function getPreventionAttention(args: {
  worksiteIds: string[] | "all"
  includeActions: boolean
  includeEvaluations: boolean
  includePpa: boolean
  limit?: number
}): Promise<PreventionAttentionItem[]> {
  if (args.worksiteIds !== "all" && args.worksiteIds.length === 0) return []
  const scope = (column: typeof worksites.id) => args.worksiteIds === "all" ? undefined : inArray(column, args.worksiteIds)
  const limit = args.limit ?? 12
  const today = new Date().toISOString().slice(0, 10)

  const [actionRows = [], evalRows = [], ppaRows = []] = await Promise.all([
    args.includeActions
      ? db.select({
          id: pdtpActionPlan.id, accion: pdtpActionPlan.accion, responsable: pdtpActionPlan.responsable,
          plazo: pdtpActionPlan.plazo, prioridad: pdtpActionPlan.prioridad, worksiteId: pdtpExecutions.worksiteId, worksiteName: worksites.name,
        }).from(pdtpActionPlan)
          .innerJoin(pdtpExecutions, eq(pdtpActionPlan.executionId, pdtpExecutions.id))
          .innerJoin(worksites, eq(pdtpExecutions.worksiteId, worksites.id))
          .where(and(scope(worksites.id), inArray(pdtpActionPlan.estado, ["pendiente", "en_proceso", "reabierto"])))
          .orderBy(asc(pdtpActionPlan.plazo)).limit(limit)
      : Promise.resolve([]),
    args.includeEvaluations
      ? db.select({ id: sstEvaluations.id, fecha: sstEvaluations.fechaEvaluacion, role: sstEvaluations.evaluatorRole, worksiteName: worksites.name })
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
    detail: `Acción ${row.prioridad} · ${row.responsable}`,
    worksiteName: row.worksiteName, dueDate: row.plazo,
    href: `/prevencion/pdtp/acciones?faena=${row.worksiteId}`,
    tone: row.plazo <= today ? "danger" as const : "warning" as const,
  })))

  items.push(...evalRows.map((row) => ({
    id: `evaluation:${row.id}`, kind: "evaluation" as const, title: "Evaluación SST pendiente",
    detail: row.role === "admin_contrato" ? "Supervisor de faena" : row.role === "conductor_lider" ? "Conductor líder" : "Prevencionista de faena",
    worksiteName: row.worksiteName, dueDate: row.fecha, href: `/prevencion/${row.id}`, tone: "warning" as const,
  })))

  items.push(...ppaRows.map((row) => ({
    id: `ppa:${row.id}`, kind: "ppa" as const, title: `PPA ${row.estado === "detenido" ? "detenido" : "en corrección"}`,
    detail: row.workerName, worksiteName: row.worksiteName, dueDate: row.createdAt.slice(0, 10),
    href: `/prevencion/ppa/${row.id}`, tone: row.estado === "detenido" ? "danger" as const : "warning" as const,
  })))

  return items.sort((a, b) => (a.tone === "danger" ? -1 : 0) - (b.tone === "danger" ? -1 : 0) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")).slice(0, limit)
}
