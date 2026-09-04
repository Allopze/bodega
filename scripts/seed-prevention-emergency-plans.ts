/**
 * scripts/seed-prevention-emergency-plans.ts
 *
 * Siembra el plan de emergencia de cada faena activa, en borrador, con sus
 * escenarios obligatorios y su organigrama mínimo.
 *
 *   npm run db:seed-emergency-plans
 *   EMERGENCY_PLANS_DRY_RUN=true npm run db:seed-emergency-plans
 *
 * **Por qué existe.** `prevention_emergency_plans` llegó vacío a producción y
 * eso deja bloqueada la activación del programa anual: la compuerta exige que
 * la N°84 tenga dónde acreditar, y su número lo declara el plan. Además, sin
 * plan aprobado no se puede programar ningún simulacro.
 *
 * **Lo que NO hace, y no es un olvido:**
 *
 * - **No aprueba.** `approveEmergencyPlan` exige que quien aprueba no sea quien
 *   creó el plan, y aprobar es justamente el acto que acredita la N°83. Es una
 *   firma, y una firma la pone una persona.
 * - **No programa simulacros**: `scheduleEmergencyDrill` exige el plan aprobado.
 * - **No siembra las amenazas que dependen del territorio** (tsunami, incendio
 *   forestal, erupción volcánica). El DO-41 las condiciona a "ubicación,
 *   historia o exposición" contra el Visor Territorial de SENAPRED, y
 *   `worksites` sólo guarda región, no comuna. Declarar una erupción volcánica
 *   en una faena que no la tiene expuesta es dato falso dentro de un plan que
 *   se audita. Están en `EMERGENCY_THREAT_CATALOG` con su procedimiento escrito
 *   para agregarlas desde la pantalla.
 * - No siembra contactos ni recursos de emergencia.
 *
 * Idempotente por la clave que ya impone el índice parcial
 * `prevention_emergency_plan_active_worksite_unique`: una faena, un plan no
 * archivado. Los escenarios se comparan por `type` dentro del plan y el rol por
 * su nombre.
 *
 * La lógica vive en `lib/services/prevention-emergency-seed.ts` —decidir qué
 * amenazas, quién coordina y cuándo saltarse una faena es dominio, y se prueba
 * como tal—. Acá quedan el actor, la impresión y el código de salida.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { roles, userRoles, users } from "@/db/schema"
import { seedEmergencyPlansForActiveWorksites } from "@/lib/services/prevention-emergency-seed"

const DRY_RUN = process.env.EMERGENCY_PLANS_DRY_RUN === "true"
const DEPLOY_MODE = process.env.EMERGENCY_PLANS_DEPLOY_MODE === "true"

function bail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(DEPLOY_MODE ? 0 : 1)
}

/**
 * El actor que crea los planes **no puede ser quien después los apruebe**:
 * `approveEmergencyPlan` rechaza que coincidan. Por eso se prefiere
 * `prevencionista_faena`, que es el rol con `emergency:manage` y sin
 * `emergency:approve`. Elegir `administrador` dejaría los siete planes
 * imposibles de aprobar por esa misma cuenta.
 */
async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.EMERGENCY_PLANS_ACTOR_USER_ID?.trim()
  if (fromEnv) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, fromEnv)).limit(1)
    if (!user) bail(`EMERGENCY_PLANS_ACTOR_USER_ID=${fromEnv} no existe.`)
    return fromEnv
  }
  for (const roleName of ["prevencionista_faena", "prevencionista"]) {
    const [row] = await db.select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(roles.name, roleName))
      .limit(1)
    if (row) {
      if (roleName !== "prevencionista_faena") {
        console.log(`  ⚠ actor con rol \`${roleName}\`, que también puede aprobar.`)
        console.log("    Asegúrate de que quien apruebe los planes sea otra persona.")
      }
      return row.userId
    }
  }
  bail("No hay ningún usuario con rol `prevencionista_faena` ni `prevencionista` para crear los planes.")
}

async function main() {
  const actorUserId = await resolveActorUserId()
  console.log(`Planes de emergencia por faena — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"} · actor=${actorUserId}`)

  const result = await seedEmergencyPlansForActiveWorksites({
    actorUserId,
    dryRun: DRY_RUN,
    onProgress: (line) => console.log(line),
  })
  if (result.worksites === 0) bail("No hay faenas activas.")

  console.log("")
  console.log(`Resumen: ${result.plansCreated} plan(es), ${result.scenariosCreated} escenario(s) y ${result.rolesCreated} rol(es) sobre ${result.worksites} faena(s).`)
  if (result.withoutStaff.length > 0) {
    console.log(`⚠ Sin organigrama por falta de dotación activa: ${result.withoutStaff.join(", ")}.`)
  }
  console.log("Los planes quedan en borrador: aprobarlos es un acto humano y es lo que acredita la N°83.")
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(DEPLOY_MODE ? 0 : 1)
})
