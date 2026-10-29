import { asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { mantRecordJobs, mantRecordParts } from "@/db/schema"

/**
 * Trabajos de una correctiva con sus repuestos, ya agrupados. Lo comparten el
 * detalle de jefatura y el PDF; el Excel agrupa con `groupJobs` sobre sus
 * propias consultas por lote.
 */

export interface RecordJob {
  id: string
  workTypeName: string
  hours: number
  noParts: boolean
  parts: Array<{ quantity: number; description: string }>
}

type JobRow = { id: string; workTypeName: string; hours: number; noParts: boolean }
type PartRow = { jobId: string | null; quantity: number; description: string }

/**
 * Cuelga cada repuesto de su trabajo. Un repuesto sin `job_id` (filas anteriores a
 * los trabajos por tipo; el servidor nuevo siempre lo llena) se muestra bajo el primero
 * para que no desaparezca de la vista.
 */
export function groupJobs(jobs: readonly JobRow[], parts: readonly PartRow[]): RecordJob[] {
  const byId = new Map<string, RecordJob>(jobs.map((job) => [job.id, { ...job, parts: [] }]))
  const first = jobs[0] ? byId.get(jobs[0].id) : undefined
  for (const part of parts) {
    const target = (part.jobId ? byId.get(part.jobId) : undefined) ?? first
    target?.parts.push({ quantity: part.quantity, description: part.description })
  }
  return [...byId.values()]
}

export async function loadRecordJobs(recordId: string): Promise<RecordJob[]> {
  const [jobs, parts] = await Promise.all([
    db.select({ id: mantRecordJobs.id, workTypeName: mantRecordJobs.workTypeName, hours: mantRecordJobs.hours, noParts: mantRecordJobs.noParts })
      .from(mantRecordJobs).where(eq(mantRecordJobs.recordId, recordId)).orderBy(asc(mantRecordJobs.sortOrder)),
    db.select({ jobId: mantRecordParts.jobId, quantity: mantRecordParts.quantity, description: mantRecordParts.description })
      .from(mantRecordParts).where(eq(mantRecordParts.recordId, recordId)).orderBy(asc(mantRecordParts.sortOrder)),
  ])
  return groupJobs(jobs, parts)
}
