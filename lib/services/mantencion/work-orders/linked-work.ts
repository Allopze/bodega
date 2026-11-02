import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordCorrectives, mantRecordJobs, mantRecordParts, mantRecords } from "@/db/schema"

/**
 * Lo que el mecánico firmó contra una OT, para el talonario impreso: el folio,
 * quién lo hizo, qué trabajos, cuántas horas y qué repuestos.
 *
 * No valida alcance: lo llama la hoja imprimible DESPUÉS de que
 * `loadWorkOrderDetail` comprobó que quien mira puede ver ESA OT. Ver la OT
 * incluye ver el trabajo hecho en ella, aunque no se tengan permisos sobre los
 * registros del módulo (la administración de contrato no los tiene).
 */
export interface WorkOrderLinkedWork {
  id: string
  folio: string | null
  kind: "P" | "C"
  workDate: string
  executorName: string
  voided: boolean
  /** Correctiva: los tipos de trabajo; preventiva: la pauta y su intervalo. */
  work: string
  /** Correctiva: total de horas; preventiva: null (no se registran). */
  hours: number | null
  parts: Array<{ quantity: number; description: string }>
}

export async function loadWorkOrderLinkedWork(workOrderId: string): Promise<WorkOrderLinkedWork[]> {
  const records = await db
    .select({
      id: mantRecords.id,
      folio: mantRecords.folio,
      kind: mantRecords.kind,
      workDate: mantRecords.workDate,
      executorName: mantRecords.executorName,
      status: mantRecords.status,
      scheduleName: mantRecords.scheduleNameSnapshot,
      intervalValue: mantRecords.intervalValue,
      unit: mantRecords.unit,
      hours: mantRecordCorrectives.hours,
      workTypes: mantRecordCorrectives.workTypes,
    })
    .from(mantRecords)
    .leftJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .where(eq(mantRecords.workOrderId, workOrderId))
    .orderBy(asc(mantRecords.signedAt))
  if (records.length === 0) return []

  const ids = records.map((record) => record.id)
  const [jobs, parts] = await Promise.all([
    db.select({ recordId: mantRecordJobs.recordId, name: mantRecordJobs.workTypeName })
      .from(mantRecordJobs).where(inArray(mantRecordJobs.recordId, ids)).orderBy(asc(mantRecordJobs.sortOrder)),
    db.select({ recordId: mantRecordParts.recordId, quantity: mantRecordParts.quantity, description: mantRecordParts.description })
      .from(mantRecordParts).where(inArray(mantRecordParts.recordId, ids)).orderBy(asc(mantRecordParts.sortOrder)),
  ])

  return records.map((record) => {
    const jobNames = jobs.filter((job) => job.recordId === record.id).map((job) => job.name)
    const work = record.kind === "P"
      ? [record.scheduleName, record.intervalValue != null ? `${record.intervalValue.toLocaleString("es-CL")} ${record.unit}` : null].filter(Boolean).join(" · ") || "Preventiva"
      : (jobNames.length ? jobNames : record.workTypes ?? []).join(", ") || "Correctiva"
    return {
      id: record.id,
      folio: record.folio,
      kind: record.kind as "P" | "C",
      workDate: record.workDate,
      executorName: record.executorName,
      voided: record.status === "anulado",
      work,
      hours: record.kind === "C" ? record.hours ?? null : null,
      parts: parts.filter((part) => part.recordId === record.id).map((part) => ({ quantity: part.quantity, description: part.description })),
    }
  })
}
