/**
 * scripts/apply-pdtp-2026-worksite-scope.ts
 *
 * Declara qué faenas operan el programa PDTP 2026 y, dentro de las que sí lo
 * operan, qué actividades no les aplican.
 *
 * Hoy `pdtp_program_worksites` está vacío, y la regla del motor es "sin
 * membresía declarada, todas las faenas activas" (ver
 * `lib/services/pdtp/worksites.ts`). Eso deja las 81 actividades activas
 * exigibles en las 7 faenas, incluida Oficina Central (8 personas): inspección
 * de maquinaria pesada, checklist de contenedores, report de uso diario de
 * equipos, campañas de conducción, el CGRD y los simulacros de emergencia
 * quedan planificados en una oficina que no opera nada de eso. Es la fuente
 * más probable de incumplimiento estructural desde el primer mes, y además,
 * tras `apply-pdtp-2026-catalog-decisions.ts`, un bloqueo de activación: la
 * compuerta de cobertura ahora descuenta las exclusiones por faena de su
 * denominador, pero necesita esta membresía para saber qué faena descontar.
 *
 * Dos tablas de datos, que son la decisión y no una heurística:
 * `PROGRAM_WORKSITE_NAMES` (qué faenas operan el programa; las que no están
 * ahí no reciben ninguna actividad) y `ACTIVITY_EXCLUSIONS` (actividades que
 * no aplican en una faena que sí opera el programa, con motivo). La segunda
 * puede quedar vacía y la tarea sigue completa: sacar Oficina Central de la
 * membresía es lo que resuelve el bloqueo de la compuerta; las exclusiones
 * finas dentro de una faena que sí opera el programa son un ajuste que la
 * jefatura puede declarar después, en cualquier momento mientras el programa
 * siga en borrador, re-ejecutando este mismo script.
 *
 *   npm run pdtp:apply-worksite-scope
 *   PDTP_WORKSITE_SCOPE_DRY_RUN=true npm run pdtp:apply-worksite-scope
 *   PDTP_WORKSITE_SCOPE_ACTOR_USER_ID=<id> npm run pdtp:apply-worksite-scope
 *
 * Idempotente: reejecutar no vuelve a escribir la membresía si ya coincide con
 * `PROGRAM_WORKSITE_NAMES`, ni reaplica una exclusión ya presente con el mismo
 * motivo.
 *
 * `PDTP_WORKSITE_SCOPE_DEPLOY_MODE` lo vuelve tolerante a las mismas
 * condiciones que el resto de los pasos de datos del PDTP: que el programa del
 * año todavía no exista, que no haya un administrador que firme el cambio, o
 * que el programa ya esté firmado y por tanto cerrado a ediciones. En esos
 * casos avisa y sale con 0 en vez de abortar el despliegue. Un nombre de faena
 * mal escrito en las tablas de arriba usa el mismo `bail()`: fallar es
 * preferible a excluir en silencio la faena equivocada.
 *
 * Va, en `scripts/apply-pdtp-data.sh` y en `scripts/deploy-prod.sh`, después de
 * `pdtp:apply-catalog-decisions` (necesita saber qué actividades siguen
 * activas para no intentar excluir una ya retirada) y antes de
 * `db:preflight-pdtp-wiring` (el diagnóstico debe reportar sobre la membresía
 * ya declarada, no sobre la anterior).
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, roles, userRoles, worksites } from "@/db/schema"
import { assertPdtpProgramEditableState } from "@/lib/services/pdtp/helpers"
import {
  listPdtpActivityWorksiteExclusions,
  listPdtpProgramWorksites,
  setPdtpActivityWorksiteAdjustment,
  setPdtpProgramWorksites,
} from "@/lib/services/pdtp/worksites"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_WORKSITE_SCOPE_DRY_RUN === "true"
const DEPLOY_MODE = process.env.PDTP_WORKSITE_SCOPE_DEPLOY_MODE === "true"

/**
 * Corta la ejecución por una condición que en el deploy no es un error.
 *
 * Invocado a mano el script tiene que fallar fuerte: si pediste aplicar el
 * alcance por faena y no se puede aplicar, quieres saberlo. Dentro del deploy
 * la misma situación es información, no una falla, y abortar dejaría la app
 * anterior en pie por un dato que no bloquea el arranque.
 */
function bail(reason: string): never {
  if (DEPLOY_MODE) {
    console.warn(`  ⚠ ${reason}`)
    console.warn("    Modo deploy: se omite el paso sin abortar el despliegue.")
    process.exit(0)
  }
  throw new Error(reason)
}

/**
 * Faenas que operan el programa. Las que no están acá no reciben ninguna
 * actividad: no es una exclusión actividad por actividad sino "esta faena no
 * ejecuta el programa de terreno".
 */
const PROGRAM_WORKSITE_NAMES = [
  "Biodiversa", "Cholguan - Arauco", "Horcones", "Masisa", "Santa Fe - Grúas", "Teno - Arauco",
] as const

/**
 * Actividades que no aplican en una faena que SÍ opera el programa, con el
 * motivo que queda en el registro de cambios. `reason` exige 10 caracteres.
 */
const ACTIVITY_EXCLUSIONS: Array<{ n: number; worksiteName: string; reason: string }> = [
  // Ejemplo del formato, no un dato aprobado:
  // { n: 33, worksiteName: "Teno - Arauco", reason: "La faena no opera maquinaria pesada propia." },
]

async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.PDTP_WORKSITE_SCOPE_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .limit(1)
  if (!row) throw new Error("No hay ningún usuario con rol `administrador`. Pasa PDTP_WORKSITE_SCOPE_ACTOR_USER_ID explícitamente.")
  return row.userId
}

async function main() {
  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const program = programs.find((item) => item.status === "active") ?? programs.at(-1)
  if (!program) bail(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  const actorUserId = await resolveActorUserId().catch((err: unknown) => {
    return bail(err instanceof Error ? err.message : String(err))
  })

  // El programa se cierra a ediciones en cuanto entra a revisión: la membresía
  // de faenas y las exclusiones son parte del contenido firmado. Se consulta
  // al guard real en vez de repetir su condición acá, para que no se
  // desincronicen.
  let locked = false
  try {
    assertPdtpProgramEditableState(program)
  } catch {
    locked = true
  }
  // Con el programa cerrado se recorre igual, sin escribir: así el paso
  // reporta qué habría cambiado en vez de callarse.
  const planOnly = DRY_RUN || locked

  // Resolución de faenas por nombre: fallar por un nombre mal escrito es
  // preferible a excluir la faena equivocada en silencio.
  const activeWorksites = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(eq(worksites.isActive, true))
  const worksiteIdByName = new Map(activeWorksites.map((w) => [w.name, w.id]))
  const worksiteNameById = new Map(activeWorksites.map((w) => [w.id, w.name]))

  const missingProgramNames = PROGRAM_WORKSITE_NAMES.filter((name) => !worksiteIdByName.has(name))
  if (missingProgramNames.length > 0) {
    bail(`Faena(s) activa(s) no encontrada(s) por nombre para la membresía del programa: ${missingProgramNames.join(", ")}.`)
  }
  const missingExclusionNames = [...new Set(
    ACTIVITY_EXCLUSIONS.filter((item) => !worksiteIdByName.has(item.worksiteName)).map((item) => item.worksiteName),
  )]
  if (missingExclusionNames.length > 0) {
    bail(`Faena(s) activa(s) no encontrada(s) por nombre para exclusiones por actividad: ${missingExclusionNames.join(", ")}.`)
  }

  const targetWorksiteIds = PROGRAM_WORKSITE_NAMES.map((name) => worksiteIdByName.get(name)!)

  const mode = DRY_RUN ? "[DRY RUN]" : locked ? "[SÓLO LECTURA: programa firmado]" : "escribiendo"
  console.log(`Alcance por faena del PDTP ${PROGRAM_YEAR} — ${mode}`)
  console.log(`  Programa: ${program.id} (status=${program.status}) · actor=${actorUserId}`)
  console.log("")

  // 1) Membresía del programa.
  const currentMembers = await listPdtpProgramWorksites(program.id)
  const currentIds = new Set(currentMembers.map((m) => m.worksiteId))
  const targetIds = new Set(targetWorksiteIds)
  const entering = targetWorksiteIds.filter((id) => !currentIds.has(id))
  const leaving = [...currentIds].filter((id) => !targetIds.has(id))
  const nameOf = (id: string) => worksiteNameById.get(id) ?? id

  let membershipChanged = false
  if (entering.length === 0 && leaving.length === 0 && currentIds.size === targetIds.size) {
    console.log(`  · Membresía de faenas ya declarada: ${targetWorksiteIds.map(nameOf).join(", ")}.`)
  } else {
    console.log(`  Entran: ${entering.length > 0 ? entering.map(nameOf).join(", ") : "(ninguna)"}`)
    console.log(`  Salen:  ${leaving.length > 0 ? leaving.map(nameOf).join(", ") : "(ninguna)"}`)
    if (!planOnly) await setPdtpProgramWorksites(program.id, targetWorksiteIds, actorUserId, "all")
    membershipChanged = true
  }

  // 2) Exclusiones por actividad, dentro de las faenas que sí operan el programa.
  const activityRows = await db.select({ id: pdtpActivities.id, n: pdtpActivities.n, status: pdtpActivities.status })
    .from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))
  const activityByN = new Map(activityRows.map((row) => [row.n, row]))
  const existingExclusions = await listPdtpActivityWorksiteExclusions(program.id)
  const existingByKey = new Map(existingExclusions.map((e) => [`${e.activityId}:${e.worksiteId}`, e]))

  let exclusionsApplied = 0
  let exclusionsAlreadyPresent = 0
  console.log("")
  if (ACTIVITY_EXCLUSIONS.length === 0) {
    console.log("  Sin exclusiones por actividad declaradas (arreglo vacío).")
  }
  for (const item of ACTIVITY_EXCLUSIONS) {
    const activity = activityByN.get(item.n)
    if (!activity) { console.warn(`  ? N°${item.n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${item.n}: retirada, se omite.`); continue }
    const worksiteId = worksiteIdByName.get(item.worksiteName)!
    const existing = existingByKey.get(`${activity.id}:${worksiteId}`)
    if (existing && existing.reason === item.reason.trim()) {
      console.log(`  · N°${item.n}: ya excluida en ${item.worksiteName}.`)
      exclusionsAlreadyPresent++
      continue
    }
    if (!planOnly) {
      await setPdtpActivityWorksiteAdjustment(
        { activityId: activity.id, worksiteId, excluded: true, reason: item.reason },
        actorUserId,
        "all",
      )
    }
    console.log(`  ✓ N°${item.n} excluida en ${item.worksiteName}: ${item.reason}`)
    exclusionsApplied++
  }

  console.log("")
  console.log(
    `Resumen: ${targetWorksiteIds.length} faena(s) en el programa${planOnly ? " (objetivo, sin escribir)" : ""}. `
    + `Exclusiones aplicadas: ${exclusionsApplied}. Ya presentes: ${exclusionsAlreadyPresent}.`,
  )

  if (locked && (membershipChanged || exclusionsApplied > 0)) {
    bail(
      `El programa ${program.id} ya entró a revisión (status=${program.status}) y quedan cambio(s) de alcance por faena `
      + "sin aplicar. Su contenido está firmado, así que aplicarlos exige una revisión nueva del programa.",
    )
  }

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
