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
 *
 * Idempotente: reejecutar no vuelve a retirar lo retirado ni reescribe lo que
 * ya quedó como corresponde.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, roles, userRoles } from "@/db/schema"
import { retirePdtpActivity, updatePdtpActivity } from "@/lib/services/pdtp/activities"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_DECISIONS_DRY_RUN === "true"

/** Actividades que salen del programa, con el motivo que queda en el change log. */
const RETIREMENTS: Array<{ n: number; reason: string }> = [
  { n: 2, reason: "Eliminada por decisión de la jefatura de prevención: la difusión a gerencias queda cubierta por la aprobación de Legal y RRHH del propio programa (actividad N°1)." },
  { n: 5, reason: "Eliminada por decisión de la jefatura de prevención: el control de cumplimiento de la línea de mando lo entrega el indicador del PDTP, no requiere una actividad propia." },
  { n: 12, reason: "Pasa al programa propio del Comité Paritario: la formación de sus integrantes se gestiona desde el submódulo de capacitaciones del CPHS." },
  { n: 13, reason: "Pasa al programa propio del Comité Paritario: la reunión mensual y su acta son actividades del comité, no de la empresa." },
  { n: 14, reason: "Pasa al programa propio del Comité Paritario: el plan de trabajo del comité es el programa del CPHS." },
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

/** D8: se miden por cobertura (cuántos de cuántos), no por evento realizado. */
const COVERAGE_ACTIVITIES = [17, 18, 23, 24]

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
  const actorUserId = await resolveActorUserId()

  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const program = programs.find((item) => item.status === "active") ?? programs.at(-1)
  if (!program) throw new Error(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  const periodStart = program.periodStart ?? `${program.year}-01-01`
  const periodEnd = program.periodEnd ?? `${program.year}-12-31`
  const effectiveFrom = effectiveFromFor(periodStart, periodEnd)

  console.log(`Decisiones de catálogo PDTP ${PROGRAM_YEAR} — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"}`)
  console.log(`  Programa: ${program.id} (status=${program.status}) · retiro efectivo desde ${effectiveFrom} · actor=${actorUserId}`)
  console.log("")

  const rows = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))
  const byN = new Map(rows.map((row) => [row.n, row]))
  let changes = 0

  for (const item of RETIREMENTS) {
    const activity = byN.get(item.n)
    if (!activity) { console.warn(`  ? N°${item.n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${item.n}: ya retirada.`); continue }
    if (!DRY_RUN) await retirePdtpActivity({ activityId: activity.id, reason: item.reason, effectiveFrom }, actorUserId)
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
    if (!DRY_RUN) {
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
    if (!DRY_RUN) await updatePdtpActivity({ activityId: activity.id, [fix.field]: fix.to }, actorUserId)
    console.log(`  ✓ N°${fix.n}: \`${fix.field}\` corregido.`)
    changes++
  }

  for (const n of COVERAGE_ACTIVITIES) {
    const activity = byN.get(n)
    if (!activity) { console.warn(`  ? N°${n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${n}: retirada, se omite.`); continue }
    if (activity.indicatorMode === "coverage") { console.log(`  · N°${n}: ya se mide por cobertura.`); continue }
    if (!DRY_RUN) await updatePdtpActivity({ activityId: activity.id, indicatorMode: "coverage" }, actorUserId)
    console.log(`  ✓ N°${n}: pasa a medirse por cobertura.`)
    changes++
  }

  const remaining = await db.select().from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, program.id), eq(pdtpActivities.status, "active")))
  console.log("")
  console.log(`Resumen: ${changes} cambio(s). Actividades activas: ${DRY_RUN ? `${remaining.length} (sin tocar)` : remaining.length}.`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
