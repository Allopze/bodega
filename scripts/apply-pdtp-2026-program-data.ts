/**
 * scripts/apply-pdtp-2026-program-data.ts
 *
 * Deja declarado el dato que el motor de acreditación necesita para cerrar solas
 * las actividades de simulacros y campañas del PDTP 2026 (grupos G3 y G4 del
 * TODO).
 *
 * Los conectores de esos dominios ya están cableados desde la fase 2 del motor,
 * pero leen el número de actividad de un registro del propio módulo —el del
 * plan de emergencia, el de la campaña—. Sin ese dato el simulacro se completa
 * y la campaña termina sin que el programa anual se entere.
 *
 * El grupo G2 —los doce cursos— salió de acá el 2026-09-19: los declara el
 * catálogo anual controlado (`lib/prevention/training-occurrences-catalog.ts`),
 * que es ahora el instrumento de las actividades de capacitación.
 *
 *   npm run pdtp:apply-program-data
 *   PDTP_PROGRAM_DATA_DRY_RUN=true npm run pdtp:apply-program-data
 *   PDTP_PROGRAM_DATA_DEPLOY_MODE=true node scripts/apply-pdtp-program-data.mjs
 *
 * Idempotente por clave natural: el `code` de la campaña. Corre
 * en cada deploy de producción por el mismo motivo que las decisiones de
 * catálogo: es dato del programa, no del código, y si depende de que alguien lo
 * cargue a mano se queda sin cargar.
 *
 * Qué NO hace, a propósito:
 *
 * - No crea planes de emergencia. Un plan lleva amenazas, escenarios y
 *   responsables: es contenido que Prevención redacta, no un catálogo. El script
 *   sólo declara la N°84 en los planes que ya existan.
 * - No marca campañas como hechas. Las crea en `pending`, que es materializar
 *   lo que el programa planificó, no declarar hecho lo que no se hizo. La
 *   evidencia la pone quien la ejecuta.
 */

import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionCampaigns,
  preventionEmergencyPlans,
  pdtpResponsibleCatalog,
  roles,
  userRoles,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"

const DRY_RUN = process.env.PDTP_PROGRAM_DATA_DRY_RUN === "true"
const DEPLOY_MODE = process.env.PDTP_PROGRAM_DATA_DEPLOY_MODE === "true"

/** N°84: "Simulacros". La acredita el simulacro completado, leyendo el plan. */
const DRILL_ACTIVITY_NUMBER = 84


/**
 * G4 — las cinco campañas que el programa planifica, una por faena.
 *
 * Se crean en `draft`: el programa las planificó, así que materializarlas es
 * reflejar el plan. Nada queda declarado como ejecutado —sin `startedAt`, sin
 * `completedAt`, sin asistencia— y el número correcto ya viene puesto, que es lo
 * que el diálogo de creación no permite hacer (fija `[85]` literal).
 */
const CAMPAIGNS: Array<{ slug: string; title: string; n: number; description: string }> = [
  { slug: "VIDA", n: 85, title: "Vida saludable", description: "Módulos de vida saludable, alimentación saludable y actividad física." },
  { slug: "ESTRES", n: 86, title: "Manejo del estrés", description: "Difusión y actividades de manejo del estrés laboral." },
  { slug: "ALCOHOL", n: 87, title: "Alcohol y drogas no van al volante", description: "Campaña de prevención del consumo de alcohol y drogas en la conducción." },
  { slug: "VIAL", n: 88, title: "Seguridad vial", description: "Campaña de seguridad vial para conductores y operadores." },
  { slug: "CIEGOS", n: 89, title: "Puntos ciegos en la conducción y operación", description: "Campaña sobre puntos ciegos en la conducción y la operación de equipos." },
]

/**
 * Corta por una condición que en el deploy no es un error: sin actor
 * administrador no hay a quién atribuir el alta, y abortar el despliegue por eso
 * dejaría la app anterior en pie por un dato que no bloquea el arranque.
 */
function bail(reason: string): never {
  if (DEPLOY_MODE) {
    console.warn(`  ⚠ ${reason}`)
    console.warn("    Modo deploy: se omite el paso sin abortar el despliegue.")
    process.exit(0)
  }
  throw new Error(reason)
}

async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.PDTP_PROGRAM_DATA_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .limit(1)
  if (!row) bail("No hay ningún usuario con rol `administrador`. Pasa PDTP_PROGRAM_DATA_ACTOR_USER_ID.")
  return row.userId
}

function sameNumbers(actual: unknown, expected: number[]): boolean {
  if (!Array.isArray(actual)) return false
  return actual.length === expected.length && expected.every((n, i) => actual[i] === n)
}

async function applyDrillPlans(): Promise<number> {
  console.log("")
  console.log("G3 — Simulacros: declarar la N°84 en el plan de cada faena")
  const plans = await db.select({
    id: preventionEmergencyPlans.id,
    code: preventionEmergencyPlans.code,
    worksiteId: preventionEmergencyPlans.worksiteId,
    numbers: preventionEmergencyPlans.pdtpActivityNumbers,
  }).from(preventionEmergencyPlans)

  // La cobertura se mide **por faena**, no globalmente: un plan en una faena no
  // acredita nada en las otras seis, y decir "hay planes" cuando faltan cinco es
  // exactamente el aviso que nadie acciona.
  const activeWorksites = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(eq(worksites.isActive, true))
  const worksitesWithPlan = new Set(plans.map((plan) => plan.worksiteId))
  const missing = activeWorksites.filter((worksite) => !worksitesWithPlan.has(worksite.id))
  if (missing.length > 0) {
    console.log(`  ⚠ ${missing.length} de ${activeWorksites.length} faena(s) sin plan de emergencia:`)
    for (const worksite of missing) console.log(`      · ${worksite.name}`)
    console.log("    Un plan lleva amenazas y escenarios: lo redacta Prevención, no este script.")
    console.log("    Sin plan, ni la N°83 (aprobar el plan) ni la N°84 (simulacro) pueden acreditar en esa faena.")
  }

  if (plans.length === 0) return 0

  let changes = 0
  for (const plan of plans) {
    const current = Array.isArray(plan.numbers) ? plan.numbers as number[] : []
    if (current.includes(DRILL_ACTIVITY_NUMBER)) {
      console.log(`  · ${plan.code}: ya declara la N°84.`)
      continue
    }
    // Se agrega, no se reemplaza: un plan puede declarar más de una actividad y
    // el script no es dueño de las que ya estuvieran.
    const next = [...current, DRILL_ACTIVITY_NUMBER].sort((a, b) => a - b)
    if (!DRY_RUN) {
      await db.update(preventionEmergencyPlans)
        .set({ pdtpActivityNumbers: next, updatedAt: new Date().toISOString() })
        .where(eq(preventionEmergencyPlans.id, plan.id))
    }
    console.log(`  ✓ ${plan.code}: ${JSON.stringify(current)} → ${JSON.stringify(next)}`)
    changes++
  }
  return changes
}

async function applyCampaigns(actorUserId: string): Promise<number> {
  console.log("")
  console.log("G4 — Campañas planificadas, una por faena")
  const sites = await db.select({ id: worksites.id, code: worksites.code, name: worksites.name })
    .from(worksites).where(eq(worksites.isActive, true))

  if (sites.length === 0) {
    console.log("  ⚠ No hay faenas activas.")
    return 0
  }

  const codes = sites.flatMap((s) => CAMPAIGNS.map((c) => `CAMP-${s.code}-${c.slug}`))
  const existing = await db.select({
    id: preventionCampaigns.id,
    code: preventionCampaigns.code,
    numbers: preventionCampaigns.pdtpActivityNumbers,
  }).from(preventionCampaigns).where(inArray(preventionCampaigns.code, codes))
  const byCode = new Map(existing.map((row) => [row.code, row]))

  let changes = 0
  for (const site of sites) {
    for (const campaign of CAMPAIGNS) {
      const code = `CAMP-${site.code}-${campaign.slug}`
      const numbers = [campaign.n]
      const found = byCode.get(code)

      if (found) {
        if (sameNumbers(found.numbers, numbers)) continue
        if (!DRY_RUN) {
          await db.update(preventionCampaigns)
            .set({ pdtpActivityNumbers: numbers, updatedAt: new Date().toISOString() })
            .where(eq(preventionCampaigns.id, found.id))
        }
        console.log(`  ✓ ${code}: declara la N°${campaign.n} (antes ${JSON.stringify(found.numbers)}).`)
        changes++
        continue
      }

      if (!DRY_RUN) {
        await db.insert(preventionCampaigns).values({
          id: `camp-${nanoid()}`,
          worksiteId: site.id,
          code,
          title: campaign.title,
          description: campaign.description,
          status: "pending",
          pdtpActivityNumbers: numbers,
          createdByUserId: actorUserId,
        }).onConflictDoNothing({ target: preventionCampaigns.code })
      }
      changes++
    }
  }
  console.log(`  ${changes === 0 ? "·" : "✓"} ${changes} campaña(s) creada(s) o corregida(s) en ${sites.length} faena(s), pendiente(s).`)
  return changes
}

/**
 * Quién opera la plataforma por un responsable que no tiene cuenta.
 *
 * El catálogo de responsables se siembra al importar el programa y ya distingue
 * un `worker_group` de un `rbac_role`, pero no decía quién hace el trabajo en la
 * plataforma cuando el responsable no puede entrar. Sin eso la N°25 no producía
 * tarea para nadie en la cola de pendientes (D21).
 */
const OPERATED_BY: Array<{ slug: string; roleName: string }> = [
  { slug: "conductores_operadores_choferes", roleName: "jefe_terreno" },
]

async function applyOperatedBy(): Promise<number> {
  console.log("")
  console.log("D21 — Quién opera por un responsable sin cuenta")
  let changes = 0
  for (const item of OPERATED_BY) {
    const [row] = await db.select({
      slug: pdtpResponsibleCatalog.slug,
      current: pdtpResponsibleCatalog.operatedByRoleName,
    }).from(pdtpResponsibleCatalog).where(eq(pdtpResponsibleCatalog.slug, item.slug)).limit(1)

    if (!row) { console.warn(`  ? ${item.slug}: no está en el catálogo de responsables.`); continue }
    if (row.current === item.roleName) { console.log(`  · ${item.slug}: ya lo opera ${item.roleName}.`); continue }
    if (!DRY_RUN) {
      await db.update(pdtpResponsibleCatalog)
        .set({ operatedByRoleName: item.roleName })
        .where(eq(pdtpResponsibleCatalog.slug, item.slug))
    }
    console.log(`  ✓ ${item.slug}: lo opera ${item.roleName} en la plataforma.`)
    changes++
  }
  return changes
}

async function main() {
  const actorUserId = await resolveActorUserId()
  console.log(`Datos del programa PDTP 2026 — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"} · actor=${actorUserId}`)
  console.log("")

  const plans = await applyDrillPlans()
  const campaigns = await applyCampaigns(actorUserId)
  const operated = await applyOperatedBy()

  console.log("")
  console.log(`Resumen: ${plans} plan(es), ${campaigns} campaña(s) y ${operated} responsable(s).`)
  // `plans` cuenta CAMBIOS, no planes: cero significa "nada que corregir", que
  // es el caso normal una vez que `seed-emergency-plans` los dejó declarados.
  // El aviso de faenas sin plan lo da `applyDrillPlans`, por nombre.
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
