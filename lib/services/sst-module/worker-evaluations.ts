import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { sstEvaluations, type SstEvaluation } from "@/db/schema/sst"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"

/**
 * Evaluaciones completas de una persona para su hoja de SST.
 *
 * #33: se filtran por la faena de CADA evaluación, no sólo por la persona. Un
 * trabajador que cambió de faena arrastra las actas de la anterior, y la
 * página sólo comprobaba la faena actual del trabajador: quien ve la faena
 * nueva leía las evaluaciones de la antigua. Vive acá, y no en la página,
 * para poder probarlo.
 */
export async function listWorkerEvaluations(workerId: string, worksiteIds: string[] | "all"): Promise<SstEvaluation[]> {
  return db.select().from(sstEvaluations)
    .where(and(eq(sstEvaluations.workerId, workerId), worksiteScopeSqlFor(worksiteIds, sstEvaluations.worksiteId)))
    .orderBy(desc(sstEvaluations.createdAt))
}
