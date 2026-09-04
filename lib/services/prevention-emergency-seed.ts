/**
 * lib/services/prevention-emergency-seed.ts
 *
 * Siembra el plan de emergencia de cada faena activa, en borrador, con sus
 * amenazas obligatorias y su organigrama mínimo.
 *
 * Vive acá y no dentro del script por la misma razón que
 * `ensurePdtp2026InspectionTemplates`: un sembrador que decide cosas —qué
 * amenazas, quién coordina, cuándo saltarse una faena— es lógica de dominio y
 * se prueba como tal. El script queda con lo suyo: resolver el actor, imprimir
 * y salir.
 *
 * Escribe por los **servicios**, no con INSERT crudo: `createEmergencyPlan`,
 * `addEmergencyScenario` y `addEmergencyRole` validan que el titular esté
 * activo y sea de la faena, que el procedimiento tenga largo suficiente, y
 * dejan traza en `prevention_emergency_history`. Un plan sembrado sin historia
 * es un plan sin origen ante un auditor.
 */

import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionEmergencyPlans,
  preventionEmergencyRoles,
  preventionEmergencyScenarios,
  workers,
  worksites,
} from "@/db/schema"
import { mandatoryEmergencyThreats } from "@/lib/prevention/emergency-threats"
import {
  addEmergencyRole,
  addEmergencyScenario,
  createEmergencyPlan,
  setEmergencyPlanPdtpActivities,
  type EmergencyAccess,
} from "@/lib/services/prevention-emergency"

/** N°84 "Simulacros": la acredita el simulacro completado, leyendo el plan. */
const DRILL_ACTIVITY_NUMBER = 84

export const EMERGENCY_COORDINATOR_ROLE_NAME = "Coordinador de emergencia"

/** Cargos que el DO-41 pone al frente de la respuesta. */
const COORDINATOR_POSITION_HINT = /jefe|supervisor|encargad|administrador/i

export type EmergencyPlanSeedResult = {
  worksites: number
  plansCreated: number
  scenariosCreated: number
  rolesCreated: number
  /** Faenas sin dotación activa: su plan queda sin organigrama y no podrá aprobarse. */
  withoutStaff: string[]
  /** Faenas cuyo plan ya estaba aprobado: su contenido está congelado. */
  frozen: string[]
}

/**
 * Titular del organigrama. La elección es **determinista** —primero un cargo de
 * mando, si no el menor id— para que reejecutar en otra base dé el mismo
 * resultado y el diff entre ambientes sea legible.
 */
export function pickEmergencyCoordinator<T extends { id: string; position: string | null }>(
  candidates: readonly T[],
): T | null {
  const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id))
  return ordered.find((worker) => COORDINATOR_POSITION_HINT.test(worker.position ?? "")) ?? ordered[0] ?? null
}

export async function seedEmergencyPlansForActiveWorksites(input: {
  actorUserId: string
  dryRun?: boolean
  onProgress?: (line: string) => void
}): Promise<EmergencyPlanSeedResult> {
  const log = input.onProgress ?? (() => {})
  const access: EmergencyAccess = {
    userId: input.actorUserId,
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:emergency:manage"],
  }
  const threats = mandatoryEmergencyThreats()
  const activeWorksites = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(eq(worksites.isActive, true)).orderBy(worksites.name)

  const result: EmergencyPlanSeedResult = {
    worksites: activeWorksites.length,
    plansCreated: 0, scenariosCreated: 0, rolesCreated: 0,
    withoutStaff: [], frozen: [],
  }

  for (const worksite of activeWorksites) {
    // La clave natural es la que ya impone el índice parcial
    // `prevention_emergency_plan_active_worksite_unique`: una faena, un plan no
    // archivado. El `code` lleva un nanoid y no sirve para reconocer nada.
    const [existing] = await db.select({
      id: preventionEmergencyPlans.id,
      code: preventionEmergencyPlans.code,
      status: preventionEmergencyPlans.status,
      version: preventionEmergencyPlans.version,
      numbers: preventionEmergencyPlans.pdtpActivityNumbers,
    }).from(preventionEmergencyPlans)
      .where(and(
        eq(preventionEmergencyPlans.worksiteId, worksite.id),
        sql`${preventionEmergencyPlans.status} <> 'archived'`,
      ))
      .limit(1)

    let plan = existing
    if (!plan) {
      if (input.dryRun) {
        log(`  ✓ ${worksite.name}: crearía el plan con ${threats.length} escenario(s).`)
        result.plansCreated++
        continue
      }
      const created = await createEmergencyPlan({
        worksiteId: worksite.id,
        title: `Plan de emergencia y respuesta ante desastres — ${worksite.name}`,
        description:
          "Plan de respuesta por amenaza, según la metodología ACCEDER del procedimiento DO-41. "
          + "Contiene las amenazas obligatorias para todo centro de trabajo; las que dependen del "
          + "territorio se agregan según el Visor Territorial de SENAPRED.",
      }, access)
      plan = {
        id: created.id, code: created.code, status: created.status,
        version: created.version, numbers: created.pdtpActivityNumbers,
      }
      result.plansCreated++
      log(`  ✓ ${worksite.name}: plan ${created.code} creado.`)
    } else {
      log(`  · ${worksite.name}: ya tiene el plan ${plan.code} (${plan.status}).`)
    }

    if (plan.status === "approved") {
      // `loadEditablePlan` congela el contenido de un plan aprobado. No es un
      // error: es la garantía de que lo firmado no cambia por debajo.
      result.frozen.push(worksite.name)
      log("    · aprobado: no admite escenarios ni roles nuevos.")
    } else if (!input.dryRun) {
      const already = await db.select({ type: preventionEmergencyScenarios.type })
        .from(preventionEmergencyScenarios)
        .where(eq(preventionEmergencyScenarios.planId, plan.id))
      const present = new Set(already.map((row) => row.type))
      for (const threat of threats) {
        if (present.has(threat.type)) continue
        await addEmergencyScenario({
          planId: plan.id, type: threat.type,
          title: threat.title, responseProcedure: threat.responseProcedure,
        }, access)
        result.scenariosCreated++
      }

      const [existingRole] = await db.select({ id: preventionEmergencyRoles.id })
        .from(preventionEmergencyRoles)
        .where(and(
          eq(preventionEmergencyRoles.planId, plan.id),
          eq(preventionEmergencyRoles.roleName, EMERGENCY_COORDINATOR_ROLE_NAME),
        ))
        .limit(1)
      if (!existingRole) {
        const dotacion = await db.select({ id: workers.id, position: workers.position })
          .from(workers)
          .where(and(eq(workers.worksiteId, worksite.id), eq(workers.isActive, true)))
        const titular = pickEmergencyCoordinator(dotacion)
        if (!titular) {
          // No se aborta ni se omite el plan: el plan y sus escenarios son lo
          // que destraba la compuerta. Lo que falta es la firma, y eso se avisa.
          result.withoutStaff.push(worksite.name)
          log("    ⚠ sin trabajadores activos: el plan queda sin organigrama y NO podrá aprobarse (N°83).")
        } else {
          const suplente = dotacion.map((w) => w.id).sort().find((id) => id !== titular.id) ?? null
          await addEmergencyRole({
            planId: plan.id, roleName: EMERGENCY_COORDINATOR_ROLE_NAME,
            assigneeWorkerId: titular.id, backupWorkerId: suplente,
          }, access)
          result.rolesCreated++
        }
      }
    }

    // La N°84 se declara siempre. Es redundante con `apply-pdtp-program-data` y
    // la redundancia es deliberada: destrabar la activación del programa no
    // debe depender del orden de dos pasos del despliegue.
    const numbers = Array.isArray(plan.numbers) ? plan.numbers as number[] : []
    if (!numbers.includes(DRILL_ACTIVITY_NUMBER) && !input.dryRun && plan.status !== "archived") {
      const [fresh] = await db.select({ version: preventionEmergencyPlans.version })
        .from(preventionEmergencyPlans).where(eq(preventionEmergencyPlans.id, plan.id)).limit(1)
      await setEmergencyPlanPdtpActivities({
        planId: plan.id,
        expectedVersion: fresh?.version ?? plan.version,
        pdtpActivityNumbers: [...numbers, DRILL_ACTIVITY_NUMBER].sort((a, b) => a - b),
      }, access)
      log(`    ✓ declara la N°${DRILL_ACTIVITY_NUMBER}.`)
    }
  }

  return result
}
