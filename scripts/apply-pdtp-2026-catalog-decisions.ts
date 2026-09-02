/**
 * scripts/apply-pdtp-2026-catalog-decisions.ts
 *
 * Aplica al programa PDTP 2026 las decisiones tomadas con la jefa de
 * prevención el 2026-08-12 (ver docs/superpowers/specs/2026-08-12-pdtp-
 * actividades-accionables-design.md, §5bis F y decisiones D5 / D8).
 *
 * Va como edición del programa, NO del catálogo: `db/seed/pdtp-catalog-2026.json`
 * es una copia notariada del XLSX del cliente y su test de contrato le fija el
 * SHA256, el tamaño y los totales del original. El catálogo dice qué trajo el
 * Excel; el programa dice qué decidió la jefa después. Son cosas distintas y
 * tienen que seguir siéndolo.
 *
 * Por eso las bajas usan `retirePdtpActivity` (retiro con motivo y fecha
 * efectiva, registrado en el change log) y no un DELETE: conservar el número
 * mantiene válido el mapeo de plantillas de inspección (N°24 sigue siendo la
 * N°24) y deja evidencia de quién sacó qué.
 *
 *   npm run pdtp:apply-catalog-decisions
 *   PDTP_DECISIONS_DRY_RUN=true npm run pdtp:apply-catalog-decisions
 *   PDTP_DECISIONS_ACTOR_USER_ID=<id> npm run pdtp:apply-catalog-decisions
 *   PDTP_DECISIONS_DEPLOY_MODE=true node scripts/apply-pdtp-catalog-decisions.mjs
 *
 * Idempotente: reejecutar no vuelve a retirar lo retirado ni reescribe lo que
 * ya quedó como corresponde. Por eso corre en cada deploy de producción
 * (`scripts/deploy-prod.sh`): las decisiones son del programa, no del código, y
 * un despliegue no debería dejarlas a medio aplicar esperando que alguien se
 * acuerde de correr el script a mano.
 *
 * `PDTP_DECISIONS_DEPLOY_MODE` lo vuelve tolerante a las tres condiciones que en
 * un deploy no son errores: que el programa del año todavía no exista (el
 * bootstrap del PDTP es un paso aparte), que no haya un administrador que firme
 * el cambio, o que el programa ya esté firmado y por tanto cerrado a ediciones.
 * En esos casos avisa y sale con 0 en vez de abortar el despliegue.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, roles, userRoles } from "@/db/schema"
import { retirePdtpActivity, updatePdtpActivity } from "@/lib/services/pdtp/activities"
import { assertPdtpProgramEditableState } from "@/lib/services/pdtp/helpers"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_DECISIONS_DRY_RUN === "true"
const DEPLOY_MODE = process.env.PDTP_DECISIONS_DEPLOY_MODE === "true"

/**
 * Corta la ejecución por una condición que en el deploy no es un error.
 *
 * Invocado a mano el script tiene que fallar fuerte: si pediste aplicar las
 * decisiones y no se pueden aplicar, quieres saberlo. Dentro del deploy la
 * misma situación es información, no una falla, y abortar dejaría la app
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

/** Actividades que salen del programa, con el motivo que queda en el change log. */
const RETIREMENTS: Array<{ n: number; reason: string }> = [
  { n: 2, reason: "Eliminada por decisión de la jefatura de prevención: la difusión a gerencias queda cubierta por la aprobación de Legal y RRHH del propio programa (actividad N°1)." },
  { n: 5, reason: "Eliminada por decisión de la jefatura de prevención: el control de cumplimiento de la línea de mando lo entrega el indicador del PDTP, no requiere una actividad propia." },
  { n: 12, reason: "Pasa al programa propio del Comité Paritario: la formación de sus integrantes se gestiona desde el submódulo de capacitaciones del CPHS." },
  { n: 13, reason: "Pasa al programa propio del Comité Paritario: la reunión mensual y su acta son actividades del comité, no de la empresa." },
  { n: 14, reason: "Pasa al programa propio del Comité Paritario: el plan de trabajo del comité es el programa del CPHS." },
  // D02. La N°21 ("Informes, cierres y seguimiento de accidentes e incidentes")
  // mide el mismo trabajo que las N°66 a 78, que desde 2026-08 se acreditan
  // solas desde el módulo de incidentes: dejarla contaría dos veces lo mismo.
  { n: 21, reason: "Eliminada por decisión de la jefatura de prevención: el seguimiento y cierre de accidentes e incidentes ya se acredita por las actividades N°66 a N°78, que se registran solas desde el módulo de incidentes. Mantenerla contaba dos veces el mismo trabajo." },
]

/** El CPHS deja de ser corresponsable acá: su parte se acciona desde su propio
 *  módulo, y sólo en Cholguán, que es la única faena con comité real. */
const CPHS_CORRESPONSIBLE_REMOVALS = [15, 73, 76]

/** Textos que quedaron nombrando al CPHS o mezclando dos actividades. */
const TEXT_FIXES: Array<{ n: number; field: "activity" | "program"; from: string; to: string }> = [
  {
    n: 3,
    field: "activity",
    from: "Difundir el Plan a todos los niveles de la organización en las faenas y CPHS",
    to: "Difundir el Plan a todos los niveles de la organización en las faenas",
  },
  {
    n: 23,
    field: "program",
    from: "Cada vez que ingresa un trabajador nuevo, por recambios, se debe mantener este registro",
    to: "Cada vez que ingresa un trabajador nuevo se debe mantener este registro",
  },
]

/**
 * D8: se miden por cobertura (cuántos de cuántos), no por evento realizado.
 *
 * La N°50 ("Controlar trabajadores expuestos a programa de vigilancia") entra
 * con el enganche de Higiene: su evidencia declarada es la "planilla de nómina
 * expuestos y en programa de vigilancia", que es exactamente un padrón.
 *
 * El denominador ya no se teclea: `SUBJECT_SOURCES` declara de qué registro sale
 * el padrón de cada una, y `compliance.ts` lo consulta. Sin fuente declarada ni
 * override manual, la actividad se mide por la cantidad planificada del mes.
 */
const COVERAGE_ACTIVITIES = [17, 18, 23, 24, 50]

/**
 * De qué registro sale el padrón de cada actividad de cobertura. Es la hermana
 * de `indicator_mode`: esa dice "cuántos de cuántos" y esta dice de cuántos.
 *
 * La N°17 barre la dotación ("todas las personas trabajadoras", dice su guía).
 * La N°24 cuenta extintores, no personas. La N°50 cuenta los expuestos de un
 * GES, que es un subconjunto. Y la N°18 y la N°23 cuentan **casos del mes**: se
 * miden sobre quien entró, y un trabajador es nuevo cuando se le hizo el acta de
 * trabajador nuevo — `workers` no tiene fecha de contratación y no se puede
 * saber de antemano cuándo entrará alguien.
 */
const SUBJECT_SOURCES: Array<{ n: number; source: string }> = [
  { n: 17, source: "dotacion" },
  { n: 18, source: "trabajadores_nuevos" },
  { n: 23, source: "trabajadores_nuevos" },
  { n: 24, source: "extintores" },
  { n: 50, source: "expuestos_ges" },
]

async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.PDTP_DECISIONS_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .limit(1)
  if (!row) throw new Error("No hay ningún usuario con rol `administrador`. Pasa PDTP_DECISIONS_ACTOR_USER_ID explícitamente.")
  return row.userId
}

/** Fecha efectiva del retiro: hoy si cae dentro del período, si no el inicio. */
function effectiveFromFor(periodStart: string, periodEnd: string) {
  const today = new Date().toISOString().slice(0, 10)
  return today >= periodStart && today <= periodEnd ? today : periodStart
}

async function main() {
  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const program = programs.find((item) => item.status === "active") ?? programs.at(-1)
  if (!program) bail(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  const actorUserId = await resolveActorUserId().catch((err: unknown) => {
    return bail(err instanceof Error ? err.message : String(err))
  })

  // El programa se cierra a ediciones en cuanto entra a revisión: el digest
  // firmado incluye el `indicatorMode` de cada actividad, así que cambiarlo
  // después dejaría la firma describiendo un contenido que ya no existe. Se
  // consulta al guard real en vez de repetir su condición acá, para que no se
  // desincronicen.
  let locked = false
  try {
    assertPdtpProgramEditableState(program)
  } catch {
    locked = true
  }
  // Con el programa cerrado se recorre igual, sin escribir: así el paso reporta
  // qué habría cambiado en vez de callarse.
  const planOnly = DRY_RUN || locked

  const periodStart = program.periodStart ?? `${program.year}-01-01`
  const periodEnd = program.periodEnd ?? `${program.year}-12-31`
  const effectiveFrom = effectiveFromFor(periodStart, periodEnd)

  const mode = DRY_RUN ? "[DRY RUN]" : locked ? "[SÓLO LECTURA: programa firmado]" : "escribiendo"
  console.log(`Decisiones de catálogo PDTP ${PROGRAM_YEAR} — ${mode}`)
  console.log(`  Programa: ${program.id} (status=${program.status}) · retiro efectivo desde ${effectiveFrom} · actor=${actorUserId}`)
  console.log("")

  const rows = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))
  const byN = new Map(rows.map((row) => [row.n, row]))
  let changes = 0

  for (const item of RETIREMENTS) {
    const activity = byN.get(item.n)
    if (!activity) { console.warn(`  ? N°${item.n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${item.n}: ya retirada.`); continue }
    if (!planOnly) await retirePdtpActivity({ activityId: activity.id, reason: item.reason, effectiveFrom }, actorUserId)
    console.log(`  ✓ N°${item.n} retirada: ${item.reason.slice(0, 70)}…`)
    changes++
  }

  for (const n of CPHS_CORRESPONSIBLE_REMOVALS) {
    const activity = byN.get(n)
    if (!activity) { console.warn(`  ? N°${n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${n}: retirada, se omite.`); continue }
    const slugs = (activity.responsibleSlugs as string[]).filter((slug) => slug !== "cphs")
    if (slugs.length === (activity.responsibleSlugs as string[]).length) {
      console.log(`  · N°${n}: el CPHS ya no figura como corresponsable.`)
      continue
    }
    const display = activity.responsibleDisplay
      .split(",").map((part) => part.trim())
      .filter((part) => !/comit[ée]\s+paritario/i.test(part))
      .join(", ")
    if (!planOnly) {
      await updatePdtpActivity({ activityId: activity.id, responsibleSlugs: slugs, responsibleDisplay: display }, actorUserId)
    }
    console.log(`  ✓ N°${n}: CPHS fuera de los responsables → ${display}`)
    changes++
  }

  for (const fix of TEXT_FIXES) {
    const activity = byN.get(fix.n)
    if (!activity) { console.warn(`  ? N°${fix.n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${fix.n}: retirada, se omite.`); continue }
    const current = activity[fix.field]
    if (current === fix.to) { console.log(`  · N°${fix.n}: el texto de \`${fix.field}\` ya está corregido.`); continue }
    if (current !== fix.from) {
      console.warn(`  ⚠ N°${fix.n}: el texto de \`${fix.field}\` no coincide con el esperado; se deja intacto.`)
      console.warn(`      esperado: ${fix.from}`)
      console.warn(`      actual:   ${current}`)
      continue
    }
    if (!planOnly) await updatePdtpActivity({ activityId: activity.id, [fix.field]: fix.to }, actorUserId)
    console.log(`  ✓ N°${fix.n}: \`${fix.field}\` corregido.`)
    changes++
  }

  for (const n of COVERAGE_ACTIVITIES) {
    const activity = byN.get(n)
    if (!activity) { console.warn(`  ? N°${n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${n}: retirada, se omite.`); continue }
    if (activity.indicatorMode === "coverage") { console.log(`  · N°${n}: ya se mide por cobertura.`); continue }
    if (!planOnly) await updatePdtpActivity({ activityId: activity.id, indicatorMode: "coverage" }, actorUserId)
    console.log(`  ✓ N°${n}: pasa a medirse por cobertura.`)
    changes++
  }

  for (const item of SUBJECT_SOURCES) {
    const activity = byN.get(item.n)
    if (!activity) { console.warn(`  ? N°${item.n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${item.n}: retirada, se omite.`); continue }
    if (activity.subjectSource === item.source) { console.log(`  · N°${item.n}: su padrón ya sale de \`${item.source}\`.`); continue }
    if (!planOnly) await updatePdtpActivity({ activityId: activity.id, subjectSource: item.source as never }, actorUserId)
    console.log(`  ✓ N°${item.n}: padrón derivado de \`${item.source}\`.`)
    changes++
  }

  const remaining = await db.select().from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, program.id), eq(pdtpActivities.status, "active")))
  console.log("")
  console.log(`Resumen: ${changes} cambio(s). Actividades activas: ${planOnly ? `${remaining.length} (sin tocar)` : remaining.length}.`)

  if (locked && changes > 0) {
    bail(
      `El programa ${program.id} ya entró a revisión (status=${program.status}) y quedan ${changes} decisión(es) `
      + "sin aplicar. Su contenido está firmado, así que aplicarlas exige una revisión nueva del programa.",
    )
  }

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
