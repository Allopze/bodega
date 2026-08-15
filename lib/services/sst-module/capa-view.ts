/**
 * Traductor CAPA → vocabulario del plan de acción de la evaluación SST
 * (D11, 2026-08-12, misma decisión que en el PDTP).
 *
 * `sst_action_plan` era un espejo de `prevention_capa_actions`:
 * `saveActionPlanItem` creaba primero la CAPA y después copiaba, y su
 * `capa_action_id` era obligatorio para poder cancelar. La acción vive en CAPA;
 * el acta la muestra numerada, que es como la firma el trabajador.
 *
 * Diferencia con el PDTP: aquí `n` **no** se deriva. Es la fila del acta que el
 * evaluador edita —`saveActionPlanItem` hace upsert por `(evaluationId, n)`—,
 * así que es identidad y se persiste en el `source_ref`. El índice único
 * `prevention_capa_sst_evaluation_n_unique` reemplaza al
 * `sst_action_plan_evaluation_n_unique` que se va con la tabla.
 */

import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { preventionCapaActions } from "@/db/schema"
import type { Tx } from "@/db"

type CapaRow = typeof preventionCapaActions.$inferSelect

/**
 * El acta tiene cinco estados y CAPA siete. `pending_verification` no tenía
 * equivalente propio en el acta y caía en `en_proceso`; se conserva ese mapeo.
 */
export const CAPA_A_SST_ESTADO: Record<string, string> = {
  pending: "pendiente",
  in_progress: "en_proceso",
  pending_verification: "en_proceso",
  verified: "verificado",
  closed: "verificado",
  reopened: "en_proceso",
  cancelled: "cancelado",
}

export function sstEstado(status: string): string {
  return CAPA_A_SST_ESTADO[status] ?? status
}

/** Un ítem del plan de acción, en la forma que consumen el acta y su impresión. */
export function capaToSstActionPlanItem(capa: CapaRow) {
  const meta = (capa.sourceRef ?? null) as { n?: number } | null
  return {
    id:           capa.id,
    evaluationId: capa.sourceId,
    capaActionId: capa.id,
    n:            meta?.n ?? 1,
    hallazgo:     capa.finding,
    accion:       capa.actionDescription,
    responsable:  capa.responsibleSnapshot ?? "",
    plazo:        capa.targetDate,
    estado:       sstEstado(capa.status),
  }
}

export type SstActionPlanItemView = ReturnType<typeof capaToSstActionPlanItem>

const esDeEvaluacionSst = eq(preventionCapaActions.sourceType, "sst_evaluation")

/** Ordena por `n`, que es el orden del acta, no el de creación. */
const porNumeroDeActa = asc(sql`(${preventionCapaActions.sourceRef}->>'n')::int`)

/**
 * Plan de acción de una evaluación. `incluirCanceladas` distingue el acta en
 * pantalla (que oculta las canceladas) de la impresión (que las conserva, para
 * que el documento firmado no cambie retroactivamente).
 */
export async function listSstActionPlan(
  evaluationId: string,
  opts?: { incluirCanceladas?: boolean },
): Promise<SstActionPlanItemView[]> {
  const rows = await db.select().from(preventionCapaActions)
    .where(and(
      esDeEvaluacionSst,
      eq(preventionCapaActions.sourceId, evaluationId),
      opts?.incluirCanceladas ? undefined : sql`${preventionCapaActions.status} <> 'cancelled'`,
    ))
    .orderBy(porNumeroDeActa)
  return rows.map(capaToSstActionPlanItem)
}

/** Busca el ítem `n` de una evaluación para decidir entre alta y edición. */
export async function findSstActionPlanItem(tx: Tx, evaluationId: string, n: number) {
  const [row] = await tx.select().from(preventionCapaActions)
    .where(and(
      esDeEvaluacionSst,
      eq(preventionCapaActions.sourceId, evaluationId),
      sql`(${preventionCapaActions.sourceRef}->>'n')::int = ${n}`,
    )).limit(1)
  return row ?? null
}

/** Carga un ítem por su id de CAPA, verificando que sea de una evaluación SST. */
export async function loadSstCapa(tx: Tx, actionId: string) {
  const [row] = await tx.select().from(preventionCapaActions)
    .where(and(esDeEvaluacionSst, eq(preventionCapaActions.id, actionId))).limit(1)
  return row ?? null
}
