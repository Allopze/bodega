/**
 * scripts/apply-pdtp-2026-program-data.ts
 *
 * Deja declarado el dato que el motor de acreditación necesita para cerrar solas
 * las actividades de capacitación, simulacros y campañas del PDTP 2026 (grupos
 * G2, G3 y G4 del TODO).
 *
 * Los conectores de esos tres dominios ya están cableados desde la fase 2 del
 * motor, pero leen el número de actividad de un registro del propio módulo
 * —`prevention_training_courses.pdtp_activity_numbers`, el del plan de
 * emergencia, el de la campaña—. Sin ese dato la sesión se cierra, el simulacro
 * se completa y la campaña termina sin que el programa anual se entere.
 *
 *   npm run pdtp:apply-program-data
 *   PDTP_PROGRAM_DATA_DRY_RUN=true npm run pdtp:apply-program-data
 *   PDTP_PROGRAM_DATA_DEPLOY_MODE=true node scripts/apply-pdtp-program-data.mjs
 *
 * Idempotente por clave natural: el `code` del curso y el de la campaña. Corre
 * en cada deploy de producción por el mismo motivo que las decisiones de
 * catálogo: es dato del programa, no del código, y si depende de que alguien lo
 * cargue a mano se queda sin cargar.
 *
 * Qué NO hace, a propósito:
 *
 * - No crea planes de emergencia. Un plan lleva amenazas, escenarios y
 *   responsables: es contenido que Prevención redacta, no un catálogo. El script
 *   sólo declara la N°84 en los planes que ya existan.
 * - No registra asistencia ni completa campañas. Las crea en `draft`, que es
 *   materializar lo que el programa planificó, no declarar hecho lo que no se
 *   hizo. La evidencia y el padrón los pone quien la ejecuta.
 */

import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionCampaigns,
  preventionEmergencyPlans,
  preventionTrainingCourses,
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
 * G2 — los doce cursos que el programa 2026 planifica, con la actividad que
 * cada uno acredita al cerrar una sesión.
 *
 * `code` es la clave natural: reejecutar no duplica y sí corrige el número.
 * La N°56 usa `PDTP-56`: `B-01` es una inducción corporativa histórica y no se
 * reutiliza como curso práctico sólo porque su código ya exista.
 */
const COURSES: Array<{
  code: string
  name: string
  n: number
  kind: string
  minutes: number
  legalBasis?: string
  validityMonths?: number
}> = [
  { code: "PDTP-56", name: "Manejo a la defensiva", n: 56, kind: "practical_training", minutes: 480, validityMonths: 24 },
  // N°16. No hacía falta ningún conector nuevo: `closeTrainingSession` ya cuenta
  // como acreditados a los asistentes con evaluación aprobada, que es
  // literalmente "rindió y pasó la prueba de la inducción IRL". Lo único que
  // faltaba era la fila del curso.
  { code: "PDTP-16", name: "Prueba de evaluación de la inducción IRL", n: 16, kind: "practical_training", minutes: 60 },
  { code: "PDTP-37", name: "Charla de seguridad (Prevencionista de faena)", n: 37, kind: "operational_talk", minutes: 30 },
  { code: "PDTP-38", name: "Charla de seguridad por turno (Supervisor / Jefe de terreno)", n: 38, kind: "operational_talk", minutes: 30 },
  { code: "PDTP-51", name: "Capacitación según detección de necesidades", n: 51, kind: "practical_training", minutes: 240 },
  { code: "PDTP-53", name: "Charla diaria de seguridad y salud en el trabajo", n: 53, kind: "operational_talk", minutes: 15 },
  { code: "PDTP-54", name: "Uso y manejo de extintores", n: 54, kind: "legal_mandatory", minutes: 240, legalBasis: "DS 594 art. 44 y 45", validityMonths: 12 },
  { code: "PDTP-55", name: "Primeros auxilios", n: 55, kind: "legal_mandatory", minutes: 480, legalBasis: "DS 594 art. 45", validityMonths: 24 },
  { code: "PDTP-57", name: "Comunicación efectiva", n: 57, kind: "practical_training", minutes: 240 },
  { code: "PDTP-58", name: "Coordinador de Gestión de Riesgos de Desastres", n: 58, kind: "legal_mandatory", minutes: 480, legalBasis: "DS 44 art. 22", validityMonths: 24 },
  { code: "PDTP-59", name: "Investigación de accidentes por árbol causal", n: 59, kind: "practical_training", minutes: 480, validityMonths: 24 },
  { code: "PDTP-60", name: "Liderazgo para la línea de mando", n: 60, kind: "practical_training", minutes: 480 },
  { code: "PDTP-63", name: "Uso correcto, reposición y eliminación de EPP", n: 63, kind: "legal_mandatory", minutes: 120, legalBasis: "DS 594 art. 53", validityMonths: 12 },
]

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

/**
 * B-01 puede contener historial de inducción ya publicado. Se conserva el
 * curso y sus versiones; sólo se retira el enlace accidental a la N°56.
 */
async function unlinkLegacyCourseActivity(): Promise<number> {
  const [legacy] = await db.select({
    id: preventionTrainingCourses.id,
    numbers: preventionTrainingCourses.pdtpActivityNumbers,
  }).from(preventionTrainingCourses).where(eq(preventionTrainingCourses.code, "B-01")).limit(1)
  if (!legacy) return 0
  const current = Array.isArray(legacy.numbers) ? legacy.numbers as number[] : []
  if (!current.includes(56)) return 0
  const next = current.filter((n) => n !== 56)
  if (!DRY_RUN) {
    await db.update(preventionTrainingCourses)
      .set({ pdtpActivityNumbers: next, updatedAt: new Date().toISOString() })
      .where(eq(preventionTrainingCourses.id, legacy.id))
  }
  console.log(`  ✓ B-01: se conserva el curso histórico y se retira únicamente la N°56 (${JSON.stringify(current)} → ${JSON.stringify(next)}).`)
  return 1
}

async function applyCourses(actorUserId: string): Promise<number> {
  console.log("G2 — Cursos de capacitación")
  const existing = await db.select({
    id: preventionTrainingCourses.id,
    code: preventionTrainingCourses.code,
    numbers: preventionTrainingCourses.pdtpActivityNumbers,
  }).from(preventionTrainingCourses)
    .where(inArray(preventionTrainingCourses.code, COURSES.map((c) => c.code)))
  const byCode = new Map(existing.map((row) => [row.code, row]))

  let changes = await unlinkLegacyCourseActivity()
  for (const course of COURSES) {
    const numbers = [course.n]
    const found = byCode.get(course.code)

    if (found) {
      if (sameNumbers(found.numbers, numbers)) {
        console.log(`  · ${course.code}: ya declara la N°${course.n}.`)
        continue
      }
      if (!DRY_RUN) {
        await db.update(preventionTrainingCourses)
          .set({ pdtpActivityNumbers: numbers, updatedAt: new Date().toISOString() })
          .where(eq(preventionTrainingCourses.id, found.id))
      }
      console.log(`  ✓ ${course.code}: declara la N°${course.n} (antes ${JSON.stringify(found.numbers)}).`)
      changes++
      continue
    }

    if (!DRY_RUN) {
      await db.insert(preventionTrainingCourses).values({
        id: `trc-${nanoid()}`,
        code: course.code,
        name: course.name,
        kind: course.kind,
        minimumDurationMinutes: course.minutes,
        validityMonths: course.validityMonths ?? null,
        legalBasis: course.legalBasis ?? null,
        // Las charlas no rinden prueba; los cursos formales sí.
        requiresAssessment: course.kind !== "operational_talk",
        pdtpActivityNumbers: numbers,
        createdByUserId: actorUserId,
      }).onConflictDoNothing({ target: preventionTrainingCourses.code })
    }
    console.log(`  ✓ ${course.code}: creado para la N°${course.n} — ${course.name}`)
    changes++
  }
  return changes
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
          status: "draft",
          pdtpActivityNumbers: numbers,
          createdByUserId: actorUserId,
        }).onConflictDoNothing({ target: preventionCampaigns.code })
      }
      changes++
    }
  }
  console.log(`  ${changes === 0 ? "·" : "✓"} ${changes} campaña(s) creada(s) o corregida(s) en ${sites.length} faena(s), en estado borrador.`)
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

  const courses = await applyCourses(actorUserId)
  const plans = await applyDrillPlans()
  const campaigns = await applyCampaigns(actorUserId)
  const operated = await applyOperatedBy()

  console.log("")
  console.log(`Resumen: ${courses} curso(s), ${plans} plan(es), ${campaigns} campaña(s) y ${operated} responsable(s).`)
  // `plans` cuenta CAMBIOS, no planes: cero significa "nada que corregir", que
  // es el caso normal una vez que `seed-emergency-plans` los dejó declarados.
  // El aviso de faenas sin plan lo da `applyDrillPlans`, por nombre.
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
