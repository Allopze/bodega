/**
 * Aplica el plan de una persona en su propia transacción, con los mismos
 * servicios que la pantalla de Trabajadores. Audita a nombre del sistema.
 *
 * Antes de escribir vuelve a leer la ficha con `FOR UPDATE`: si alguien la
 * cambió entre la planificación y este momento, no se toca (Chome manda) y la
 * persona se reintenta en la próxima corrida. El cambio, los marcadores y la
 * base se escriben juntos, así una caída a mitad de corrida no los desalinea.
 */
import { eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { talanaContracts, talanaWorkerLinks, workers } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { getWorkerOffboardingSummary } from "@/lib/services/worker-offboarding"
import { bulkAssignWorkerPosition, recordWorkerPositionChange } from "@/lib/services/worker-positions"
import { insertWorker, setWorkerActive, updateWorkerFields, type WorkerLifecycleEvent } from "@/lib/services/workers"
import type { PersonPlan, PlanItem } from "./talana-planner"

export const TALANA_SYSTEM_EMAIL = "sistema@chome.cl"
const REASON = "Sincronización con Talana"

export interface AppliedItem extends Omit<PlanItem, "outcome"> {
  outcome: "applied" | "skipped" | "failed"
}

export interface AppliedPerson {
  workerId: string | null
  items: AppliedItem[]
  events: WorkerLifecycleEvent[]
  failed: boolean
}

type WorkerRow = typeof workers.$inferSelect

class ConcurrentChange extends Error {}

function sameFields(fresh: WorkerRow, expected: NonNullable<PersonPlan["expected"]>): boolean {
  return fresh.isActive === expected.isActive
    && fresh.worksiteId === expected.worksiteId
    && fresh.positionId === expected.positionId
    && (fresh.supervisor ?? "").trim() === (expected.supervisor ?? "").trim()
    && (fresh.sex ?? null) === (expected.sex ?? null)
}

async function writeMarkersAndBase(tx: Tx, plan: PersonPlan, workerId: string | null, runId: string, now: string) {
  if (plan.markActivation.length) {
    await tx.update(talanaContracts).set({ activationProcessedAt: now }).where(inArray(talanaContracts.talanaContractId, plan.markActivation))
  }
  if (plan.markFiniquito.length) {
    await tx.update(talanaContracts).set({ finiquitoProcessedAt: now }).where(inArray(talanaContracts.talanaContractId, plan.markFiniquito))
  }
  if (plan.resetActivation.length) {
    // Tras una baja, un contrato que vuelva a estar activo es una señal nueva.
    await tx.update(talanaContracts).set({ activationProcessedAt: null }).where(inArray(talanaContracts.talanaContractId, plan.resetActivation))
  }
  if (plan.nextBase) {
    const base = {
      baseCargoKey: plan.nextBase.cargoKey,
      basePositionId: plan.nextBase.positionId,
      baseCostCenterId: plan.nextBase.costCenterId,
      baseWorksiteId: plan.nextBase.worksiteId,
      baseJefeKey: plan.nextBase.jefeKey,
      baseSupervisor: plan.nextBase.supervisor,
      baseUpdatedAt: now,
      baseRunId: runId,
      updatedAt: now,
    }
    await tx.insert(talanaWorkerLinks).values({ rut: plan.rut, workerId, ...base })
      .onConflictDoUpdate({ target: talanaWorkerLinks.rut, set: { workerId, ...base } })
  }
}

export async function applyPersonPlan(plan: PersonPlan, ctx: { runId: string; now: string }): Promise<AppliedPerson> {
  const events: WorkerLifecycleEvent[] = []
  let workerId = plan.workerId
  try {
    await db.transaction(async (tx) => {
      let fresh: WorkerRow | null = null
      if (plan.workerId) {
        const [row] = await tx.select().from(workers).where(eq(workers.id, plan.workerId)).for("update")
        if (!row || !plan.expected || !sameFields(row, plan.expected)) throw new ConcurrentChange()
        fresh = row
      }

      /* Alta ─ */
      if (plan.create) {
        const taken = await tx.select({ id: workers.id }).from(workers).where(eq(workers.rut, plan.rut)).limit(1)
        if (taken.length > 0) throw new ConcurrentChange()
        const id = nanoid()
        const created = plan.create
        const result = await insertWorker({
          id, rut: plan.rut, firstName: created.firstName, lastName: created.lastName, sex: created.sex,
          supervisor: created.supervisor, positionId: created.positionId, position: created.positionName,
          worksiteId: created.worksiteId, isActive: true,
        }, tx)
        await recordWorkerPositionChange({
          workerId: id, nextPosition: { id: created.positionId, name: created.positionName }, source: "system",
          actorUserId: null, reason: `Cargo asignado al crear el trabajador desde Talana`,
        }, tx)
        await recordAudit({
          userId: null, userEmail: TALANA_SYSTEM_EMAIL, action: "create", entityType: "worker", entityId: id,
          newState: {
            firstName: created.firstName, lastName: created.lastName, rut: plan.rut, position: created.positionName,
            supervisor: created.supervisor, ...(created.sex ? { sexoRegistrado: true } : {}),
          },
          reason: REASON, worksiteId: created.worksiteId,
        }, tx)
        events.push(...result.events)
        workerId = id
      }

      /* Reactivación, traslado, jefe, sexo ─ */
      if (fresh && (plan.reactivate || plan.changes.worksiteId || plan.changes.supervisor !== undefined || plan.changes.sex)) {
        const changes: Partial<WorkerRow> = {}
        if (plan.reactivate) { changes.isActive = true; changes.worksiteId = plan.reactivate.worksiteId }
        if (plan.changes.worksiteId) changes.worksiteId = plan.changes.worksiteId
        if (plan.changes.supervisor !== undefined) changes.supervisor = plan.changes.supervisor
        if (plan.changes.sex) changes.sex = plan.changes.sex
        const isTransfer = fresh.isActive && !!changes.worksiteId && changes.worksiteId !== fresh.worksiteId
        const pendings = isTransfer ? await getWorkerOffboardingSummary(fresh.id, tx) : null
        const result = await updateWorkerFields(fresh.id, changes, fresh, tx)
        await recordAudit({
          userId: null, userEmail: TALANA_SYSTEM_EMAIL, action: "update", entityType: "worker", entityId: fresh.id,
          oldState: {
            ...(changes.isActive ? { isActive: false } : {}),
            ...(changes.worksiteId ? { worksiteId: fresh.worksiteId } : {}),
            ...(changes.supervisor !== undefined ? { supervisor: fresh.supervisor } : {}),
          },
          newState: {
            ...(changes.isActive ? { isActive: true } : {}),
            ...(changes.worksiteId ? { worksiteId: changes.worksiteId } : {}),
            ...(changes.supervisor !== undefined ? { supervisor: changes.supervisor } : {}),
            // Sólo el hecho, no el valor: la auditoría es append-only.
            ...(changes.sex ? { sexoModificado: true } : {}),
            ...(pendings ? { pendientesEnFaenaDeOrigen: pendings.items } : {}),
          },
          reason: REASON, worksiteId: changes.worksiteId ?? fresh.worksiteId,
        }, tx)
        events.push(...result.events)
      }

      /* Cargo ─ */
      if (fresh && plan.changes.positionId) {
        await bulkAssignWorkerPosition({
          workerIds: [fresh.id], positionId: plan.changes.positionId, reason: REASON,
          actorUserId: null, actorEmail: TALANA_SYSTEM_EMAIL, source: "system",
        }, tx)
      }

      /* Baja ─ */
      if (fresh && plan.deactivate) {
        const pendings = await getWorkerOffboardingSummary(fresh.id, tx)
        const result = await setWorkerActive(fresh.id, false, fresh, tx)
        await recordAudit({
          userId: null, userEmail: TALANA_SYSTEM_EMAIL, action: "update", entityType: "worker", entityId: fresh.id,
          oldState: { isActive: true },
          newState: { isActive: false, pendientesAlDesactivar: pendings.items },
          reason: `${REASON}: finiquito con término el ${plan.deactivate.endsOn}`, worksiteId: fresh.worksiteId,
        }, tx)
        events.push(...result.events)
      }

      await writeMarkersAndBase(tx, plan, workerId, ctx.runId, ctx.now)
    })
  } catch (error) {
    if (error instanceof ConcurrentChange) {
      return {
        workerId: plan.workerId,
        events: [],
        failed: false,
        items: plan.items.map((item) => ({ ...item, outcome: "skipped", reasonCode: item.outcome === "planned" ? "conflicto_concurrente" : item.reasonCode })),
      }
    }
    // Sólo el tipo de error: el mensaje puede traer datos de la persona.
    logger.error("[talana] no se pudo aplicar el plan de una persona", { code: error instanceof Error ? error.name : "unknown" })
    return {
      workerId: plan.workerId,
      events: [],
      failed: true,
      items: plan.items.map((item) => (item.outcome === "planned" ? { ...item, outcome: "failed", reasonCode: "error" } : { ...item, outcome: "skipped" })),
    }
  }
  return {
    workerId,
    events,
    failed: false,
    items: plan.items.map((item) => ({ ...item, outcome: item.outcome === "planned" ? "applied" : "skipped" })),
  }
}
