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
import { pdtpActivities, pdtpActivityWorksiteExclusions, pdtpActivityWorksiteParams, pdtpProgramWorksites, pdtpPrograms, roles, userRoles, worksites } from "@/db/schema"
import { retirePdtpActivity, updatePdtpActivity } from "@/lib/services/pdtp/activities"
import { assertPdtpProgramEditableState } from "@/lib/services/pdtp/helpers"
import { resolveProgramWorksiteIds, setPdtpActivityWorksiteAdjustment } from "@/lib/services/pdtp/worksites"

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
  // La N°2 salió de acá el 2026-09-23: vuelve al programa acreditada por toma de
  // conocimiento (ver REACTIVATIONS en `apply-pdtp-2026-mechanisms.ts`). Dejarla
  // haría que este script la retirara otra vez sobre la revisión que la reactiva.
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
const COVERAGE_ACTIVITIES = [16, 17, 18, 23, 24, 50, 54, 56]

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
  // La N°16 mide sobre quien acaba de pasar por la inducción, no sobre toda la
  // dotación: la prueba de evaluación es del trabajador nuevo. Es el mismo
  // denominador de flujo que ya usan la N°18 y la N°23, y es lo que la hace
  // medible sin necesidad de un compromiso por persona.
  { n: 16, source: "trabajadores_nuevos" },
  { n: 17, source: "dotacion" },
  { n: 18, source: "trabajadores_nuevos" },
  { n: 23, source: "trabajadores_nuevos" },
  { n: 24, source: "extintores" },
  { n: 50, source: "expuestos_ges" },
  // La N°54 mide sobre "los trabajadores" (su guía), así que barre la dotación
  // como la N°17. La N°56 mide sobre "conductores, operadores y quienes
  // conducen vehículos livianos" — un subconjunto sin fuente declarable en el
  // CHECK de `subject_source` (`equipos` cuenta vehículos, no personas) — así
  // que queda sin fuente derivada y su padrón cae a la cantidad planificada,
  // igual que hoy. Es un hueco de diseño anterior a T35, no creado por él.
  { n: 54, source: "dotacion" },
]

/**
 * D_ (T35): metas de cobertura que la propia guía del catálogo declara
 * explícitamente. La N°54 dice "…dos fechas para logras el 90% de los
 * trabajadores…"; la N°56, "…al 90% de los conductores, operadores…". Sin
 * esto, `compliance.ts` exige el padrón completo (100%), que es más estricto
 * que lo que el programa realmente promete.
 *
 * A diferencia de `COVERAGE_ACTIVITIES`/`SUBJECT_SOURCES` (columnas de
 * `pdtp_activities`), la meta vive **por faena** en
 * `pdtp_activity_worksite_params` — `updatePdtpActivity` no la toca.
 */
const COVERAGE_TARGETS: Array<{ n: number; percent: number }> = [
  { n: 54, percent: 90 },
  { n: 56, percent: 90 },
  // N°17 (RE-28). Su padrón es la dotación completa de la faena, y exigir el
  // 100 % cada mes convierte cualquier licencia, vacación o ausencia en un 0 %
  // del mes entero. El 95 % baja el umbral de acreditación sin encoger el
  // denominador, que es la semántica correcta acá.
  //
  // Queda pendiente una decisión que este script NO toma: la N°17 tiene **9
  // meses planificados** contra un padrón de stock, así que marcará 0 % los
  // meses en que nadie barre. El procedimiento DO-47 (punto 6.4) fija la
  // cadencia real: "actualización del registro cada 6 meses o cuando haya un
  // cambio en la condición", o sea dos barridos al año, no nueve. Alinear el
  // calendario con eso es cambiar lo que el programa promete —va con motivo y
  // change log— y por eso lo decide Prevención y no un script.
  { n: 17, percent: 95 },
]

/**
 * Evidencia mínima de las actividades `constancia` (Fase 4, 2026-09-02).
 *
 * La compuerta 81/81 (`assertPdtpFulfillmentCoverage`) exige que toda
 * actividad `constancia` declare qué hay que adjuntar — sin eso, "es
 * constancia" no dice qué prueba el cumplimiento. Ninguna la tenía: el
 * catálogo trae la guía de a qué atenerse, pero no un texto de evidencia
 * exigible. La N°19 no está en esta lista porque pasó a `enganche` (T47).
 */
const CONSTANCIA_EVIDENCE: Array<{ n: number; evidenceRequirement: string }> = [
  { n: 6, evidenceRequirement: "Acta de la reunión de revisión SG-SST, con los temas tratados y los asistentes." },
  { n: 20, evidenceRequirement: "Acta o correo de la reunión con la empresa mandante." },
  { n: 22, evidenceRequirement: "Registro de la revisión de la plataforma, con vencimientos y coordinaciones informadas." },
  { n: 28, evidenceRequirement: "Registro de la revisión semanal de inspecciones recibidas, con los hallazgos derivados a cierre." },
  { n: 30, evidenceRequirement: "Registro del alcotest realizado por el PRF en turno administrativo, según DO-48." },
  { n: 31, evidenceRequirement: "Registro del alcotest realizado por el Sup/JT en los turnos, según DO-48." },
  { n: 32, evidenceRequirement: "Correo de envío de los registros de alcotest del mes, según DO-48." },
  { n: 42, evidenceRequirement: "Informe de visitas de la empresa de sanitización y control de plagas." },
  { n: 44, evidenceRequirement: "Registro de la coordinación con el asesor de la mutual." },
  { n: 61, evidenceRequirement: "Certificados que acreditan la idoneidad de los EPP utilizados en la faena." },
  { n: 79, evidenceRequirement: "Acta de constitución del Comité de Gestión de Riesgos de Desastres, según el DS 44." },
  { n: 80, evidenceRequirement: "Matriz GRD con análisis histórico, amenazas, evaluación legal y plan de trabajo." },
  { n: 81, evidenceRequirement: "Acta de reunión del CGRD, según el DS 44." },
  { n: 82, evidenceRequirement: "Mapa de riesgo por área de la faena." },
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
  const orderedPrograms = [...programs].sort((a, b) => b.version - a.version)
  // Una revisión v+1 abierta es la única versión que este script puede
  // completar. La v1 activa queda como evidencia firmada; elegirla primero
  // haría que el deploy sólo informara el cambio y dejara la revisión nueva
  // incompleta.
  const program = orderedPrograms.find((item) => item.status === "draft")
    ?? orderedPrograms.find((item) => item.status === "active")
    ?? orderedPrograms[0]
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

  // Meta de cobertura: vive por faena (`pdtp_activity_worksite_params`), no en
  // `pdtp_activities`, así que aquí sí hace falta resolver a qué faenas
  // aplica el programa — misma regla que el resto del PDTP: sin membresía,
  // sólo las cubre todas si el programa declara alcance corporativo.
  if (COVERAGE_TARGETS.length > 0) {
    const [allWorksites, memberships] = await Promise.all([
      db.select({ id: worksites.id }).from(worksites).where(eq(worksites.isActive, true)),
      db.select({ worksiteId: pdtpProgramWorksites.worksiteId }).from(pdtpProgramWorksites)
        .where(and(eq(pdtpProgramWorksites.programId, program.id), eq(pdtpProgramWorksites.isActive, true))),
    ])
    const applicableWorksiteIds = resolveProgramWorksiteIds(
      memberships.map((m) => m.worksiteId), "all", allWorksites.map((w) => w.id),
      program.appliesToAllWorksites,
    )

    for (const item of COVERAGE_TARGETS) {
      const activity = byN.get(item.n)
      if (!activity) { console.warn(`  ? N°${item.n}: no existe en el programa, se omite.`); continue }
      if (activity.status === "retired") { console.log(`  · N°${item.n}: retirada, se omite.`); continue }

      let applied = 0
      for (const worksiteId of applicableWorksiteIds) {
        const [exclusion, params] = await Promise.all([
          db.select({ id: pdtpActivityWorksiteExclusions.id }).from(pdtpActivityWorksiteExclusions)
            .where(and(eq(pdtpActivityWorksiteExclusions.activityId, activity.id), eq(pdtpActivityWorksiteExclusions.worksiteId, worksiteId))).limit(1),
          db.select({ targetCoveragePercent: pdtpActivityWorksiteParams.targetCoveragePercent }).from(pdtpActivityWorksiteParams)
            .where(and(eq(pdtpActivityWorksiteParams.activityId, activity.id), eq(pdtpActivityWorksiteParams.worksiteId, worksiteId))).limit(1),
        ])
        if (Number(params[0]?.targetCoveragePercent) === item.percent) continue // ya aplicada, sin tocar la exclusión que hubiera.

        if (!planOnly) {
          await setPdtpActivityWorksiteAdjustment({
            activityId: activity.id,
            worksiteId,
            excluded: Boolean(exclusion[0]), // se preserva: este script no decide exclusiones.
            targetCoveragePercent: item.percent,
            reason: `Meta de cobertura ${item.percent}% declarada en la guía del catálogo (T35, 2026-09-02).`,
          }, actorUserId)
        }
        applied++
        changes++
      }
      if (applied === 0) console.log(`  · N°${item.n}: meta de cobertura ${item.percent}% ya aplicada en las ${applicableWorksiteIds.length} faena(s).`)
      else console.log(`  ✓ N°${item.n}: meta de cobertura ${item.percent}% aplicada en ${applied} de ${applicableWorksiteIds.length} faena(s).`)
    }
  }

  for (const item of CONSTANCIA_EVIDENCE) {
    const activity = byN.get(item.n)
    if (!activity) { console.warn(`  ? N°${item.n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${item.n}: retirada, se omite.`); continue }
    if (activity.evidenceRequirement?.trim()) { console.log(`  · N°${item.n}: ya declara evidencia mínima.`); continue }
    if (!planOnly) await updatePdtpActivity({ activityId: activity.id, evidenceRequirement: item.evidenceRequirement }, actorUserId)
    console.log(`  ✓ N°${item.n}: evidencia mínima declarada.`)
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
