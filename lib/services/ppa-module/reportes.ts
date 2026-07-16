import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { ppaCorrectiveActions, ppaSubmissions, type PpaCorrectiveAction, type PpaSubmission } from "@/db/schema/ppa"
import { worksites } from "@/db/schema/worksites"
import { ppaReviewSchema, type PpaReviewInput } from "@/lib/validation/ppa"
import {
  tipoTrabajoLabel,
  PPA_STOP_REASON_LABELS,
  type EstadoPpa,
  type PpaStopReason,
} from "@/lib/ppa/types"
import { estadoPpaLabel, decisionPpaLabel } from "@/lib/ppa/badges"
import type { ReportData } from "@/lib/reports/export"
import { listPpa, getPpa } from "./calculos"
import { nanoid } from "@/lib/id"

export async function reviewPpa(
  input: PpaReviewInput,
  userId: string,
  worksiteIds: string[] | "all",
): Promise<PpaSubmission> {
  const data = ppaReviewSchema.parse(input)

  const current = await getPpa(data.ppaId, worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado === "aprobado_auto") {
    throw new Error("Este PPA fue aprobado automáticamente y no requiere revisión.")
  }
  if (current.estado === "autorizado" || current.estado === "rechazado" || current.estado === "cerrado") {
    throw new Error("Este PPA ya fue resuelto y no puede modificarse.")
  }

  const estado: EstadoPpa =
    data.decision === "autorizado" ? "autorizado" :
    data.decision === "rechazado"  ? "rechazado"  :
    "en_correccion"

  const now = new Date().toISOString()

  const result = await db.transaction(async (tx) => {
    const updated = await tx.update(ppaSubmissions)
      .set({
        reviewedBy:       userId,
        fuiAlLugar:       data.fuiAlLugar,
        accionCorrectiva: data.accionCorrectiva || null,
        reviewNota:       data.reviewNota || null,
        decision:         data.decision,
        estado,
        reviewedAt:       now,
        updatedAt:        now,
      })
      .where(and(
        eq(ppaSubmissions.id, data.ppaId),
        inArray(ppaSubmissions.estado, ["detenido", "en_correccion"]),
      ))
      .returning()

    if (!updated[0]) return null

    if (data.decision === "autorizado") {
      await tx.insert(ppaCorrectiveActions).values({
        id: nanoid(),
        ppaId: current.id,
        worksiteId: current.worksiteId,
        description: data.accionCorrectiva!.trim(),
        responsibleRole: data.responsibleRole!,
        responsible: data.responsible!.trim(),
        dueDate: data.dueDate!,
        priority: data.priority!,
        status: "pendiente",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
    }

    return updated[0]
  })

  if (!result) {
    throw new Error("Este PPA ya fue procesado por otro responsable. Recarga la página.")
  }

  return result
}

export async function closePpa(
  id: string,
  worksiteIds: string[] | "all",
): Promise<PpaSubmission> {
  const current = await getPpa(id, worksiteIds)
  if (!current) throw new Error("PPA no encontrado o fuera de tu alcance.")
  if (current.estado !== "autorizado" && current.estado !== "rechazado") {
    throw new Error("Solo se pueden cerrar casos autorizados o rechazados.")
  }

  const now = new Date().toISOString()
  const result = await db.update(ppaSubmissions)
    .set({ estado: "cerrado", updatedAt: now })
    .where(and(
      eq(ppaSubmissions.id, id),
      inArray(ppaSubmissions.estado, ["autorizado", "rechazado"]),
    ))
    .returning()

  if (!result[0]) {
    throw new Error("Este caso ya fue cerrado por otro responsable. Recarga la página.")
  }

  return result[0]
}

/** Obtiene la acción que nació de un PPA dentro del alcance ya validado. */
export async function getPpaCorrectiveAction(
  ppaId: string,
  worksiteIds: string[] | "all",
): Promise<PpaCorrectiveAction | null> {
  const current = await getPpa(ppaId, worksiteIds)
  if (!current) return null
  const [action] = await db
    .select()
    .from(ppaCorrectiveActions)
    .where(eq(ppaCorrectiveActions.ppaId, ppaId))
    .limit(1)
  return action ?? null
}

export interface PpaExportFilters {
  estado?: string
  worksiteId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

export async function buildPpaExport(
  worksiteIds: string[] | "all",
  filters: PpaExportFilters = {},
): Promise<ReportData> {
  const maxRows = 10_000
  const rows = await listPpa({ worksiteIds, ...filters }, maxRows + 1, 0)
  const rowLimitApplied = rows.length > maxRows
  const exportRows = rowLimitApplied ? rows.slice(0, maxRows) : rows
  return {
    filenameBase: `ppa_digital_${new Date().toISOString().slice(0, 10)}`,
    worksheetName: "PPA Digital",
    headers: [
      "Fecha", "Trabajador", "RUT", "Identificación manual", "Faena", "Tarea",
      "Crítica", "Resultado", "Estado", "Motivos detención", "Decisión",
      "Acción correctiva", "Revisado",
    ],
    rows: exportRows.map((r) => [
      new Date(r.createdAt).toLocaleString("es-CL"),
      r.workerName,
      r.workerRut ?? "",
      r.manualIdentificacion ? "Sí" : "No",
      r.worksiteName ?? "",
      tipoTrabajoLabel(r.tipoTrabajo),
      r.esCritica ? "Sí" : "No",
      r.resultado === "detenido" ? "Detenido" : "Autorizado auto.",
      estadoPpaLabel(r.estado),
      ((r.triggeredReasons as PpaStopReason[] | null) ?? [])
        .map((x) => PPA_STOP_REASON_LABELS[x] ?? x).join(" | "),
      decisionPpaLabel(r.decision),
      r.accionCorrectiva ?? "",
      r.reviewedAt ? new Date(r.reviewedAt).toLocaleString("es-CL") : "",
    ]),
    rowLimitApplied,
  }
}

export async function listScopedWorksites(
  worksiteIds: string[] | "all",
): Promise<{ id: string; name: string }[]> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return []
  const cond = worksiteIds !== "all"
    ? and(eq(worksites.isActive, true), inArray(worksites.id, worksiteIds))
    : eq(worksites.isActive, true)
  return db
    .select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(cond)
    .orderBy(worksites.name)
}
