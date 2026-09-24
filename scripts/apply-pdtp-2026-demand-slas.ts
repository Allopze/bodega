/**
 * scripts/apply-pdtp-2026-demand-slas.ts
 *
 * Declara el SLA (`dueDays`/`dueHours`) y la evidencia mínima de las 19
 * actividades `on_demand` del programa PDTP 2026, confirma su clasificación
 * de calendario (`scheduleClassificationStatus`), y declara la evidencia
 * mínima de las nueve `constancia`, que no tienen plazo pero sí la exigen.
 *
 * Sin ese dato, `pdtpSubmitReviewBlockers` (ver `lib/services/pdtp/lifecycle.ts`)
 * impide incluso ENVIAR el programa a revisión — no es una decisión operativa
 * pendiente, es un bloqueo de dato. Trece de las diecinueve son del RE-20
 * (N°66-78): sus plazos ya están documentados en
 * `lib/services/pdtp-adapters/incident-accreditation-connector.ts`, que es la
 * fuente ya revisada — este script los cita de ahí, no los inventa. Las cinco
 * restantes (N°11, 15, 16, 52, 57) no tienen un plazo normativo verificable en
 * el catálogo: quedan con un valor propuesto, marcado como tal en `notes`, y
 * editable desde la ficha de la actividad antes de enviar a revisión.
 *
 * Las nueve `constancia` (N°3, 6, 20, 22, 28, 42, 44, 61, 82) son el otro
 * bloqueo de dato: la compuerta 81/81 exige que una constancia declare qué
 * evidencia pide —si no, "se hizo" no es verificable— y nada la sembraba. El
 * texto se deriva de la guía de ejecución del propio catálogo, que describe
 * cómo se realiza cada una, y se marca como propuesto en `notes`. Quién decide
 * que una actividad es constancia es `apply-pdtp-2026-mechanisms.ts`; su
 * evidencia se declara acá.
 *
 *   npm run pdtp:apply-demand-slas
 *   PDTP_DEMAND_SLAS_DRY_RUN=true npm run pdtp:apply-demand-slas
 *   PDTP_DEMAND_SLAS_ACTOR_USER_ID=<id> npm run pdtp:apply-demand-slas
 *   PDTP_DEMAND_SLAS_DEPLOY_MODE=true node scripts/apply-pdtp-demand-slas.mjs
 *
 * Idempotente: reejecutar no reescribe lo que ya coincide. Corre en cada
 * deploy de producción, después de las decisiones de catálogo (que deciden qué
 * actividades siguen vivas) y de la clasificación por mecanismo.
 *
 * `PDTP_DEMAND_SLAS_DEPLOY_MODE` lo vuelve tolerante a que el programa del año
 * todavía no exista, a que no haya administrador que firme, o a que el
 * programa ya esté firmado y por tanto cerrado a ediciones — mismas tres
 * condiciones que `apply-pdtp-2026-catalog-decisions.ts`.
 */

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, roles, userRoles } from "@/db/schema"
import { updatePdtpActivity } from "@/lib/services/pdtp/activities"
import { assertPdtpProgramEditableState } from "@/lib/services/pdtp/helpers"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_DEMAND_SLAS_DRY_RUN === "true"
const DEPLOY_MODE = process.env.PDTP_DEMAND_SLAS_DEPLOY_MODE === "true"

function bail(reason: string): never {
  if (DEPLOY_MODE) {
    console.warn(`  ⚠ ${reason}`)
    console.warn("    Modo deploy: se omite el paso sin abortar el despliegue.")
    process.exit(0)
  }
  throw new Error(reason)
}

type DemandSla = {
  n: number
  dueDays?: number
  dueHours?: number
  evidenceRequirement: string
  /** `false` = plazo normativo verificado; `true` = valor propuesto a confirmar. */
  proposed: boolean
  basis: string
}

/**
 * Trece actividades del RE-20 (N°66-78), con los plazos ya documentados en el
 * conector de incidentes. Seis quedan sin plazo explícito en el propio
 * procedimiento (66, 67, 71, 74, 77) o sin ventana verificable (11, 15, 16, 52,
 * 57): esas se marcan `proposed: true`.
 */
const DEMAND_SLAS: DemandSla[] = [
  {
    n: 11, dueDays: 30, proposed: true,
    evidenceRequirement: "Acta de constitución del comité o, si no procede por dotación, el registro del delegado SST.",
    basis: "Sin plazo explícito en el catálogo ni en el DS 44 citado; plazo administrativo propuesto.",
  },
  {
    n: 15, dueDays: 0, proposed: true,
    evidenceRequirement: "Registro de la charla de inducción IRL en el acta de trabajador nuevo.",
    basis: "El catálogo no fija un número, pero el DS 44 exige la inducción antes de iniciar funciones.",
  },
  {
    n: 16, dueDays: 1, proposed: true,
    evidenceRequirement: "Resultado de la prueba de evaluación IRL en el acta de trabajador nuevo.",
    basis: "Sigue a la charla de inducción (N°15); sin plazo propio en el catálogo.",
  },
  {
    n: 18, dueDays: 0, proposed: true,
    evidenceRequirement: "Entrega del RIOHS registrada en el acta de trabajador nuevo.",
    basis: "El catálogo dice \"al momento de la incorporación\": plazo cero.",
  },
  {
    n: 52, dueDays: 0, proposed: true,
    evidenceRequirement: "Acta de habilitación operacional cerrada, con todos sus componentes conformes.",
    basis: "El catálogo dice \"antes que ingrese la persona trabajadora\": plazo cero.",
  },
  {
    n: 57, dueDays: 30, proposed: true,
    evidenceRequirement: "Registro de la coordinación con el asesor de la mutual.",
    basis: "El catálogo no describe un disparador ni un plazo; valor administrativo propuesto.",
  },
  {
    n: 66, dueHours: 4, proposed: true,
    evidenceRequirement: "Registro del aviso al administrador de contrato y al PRF (llamado, correo o WhatsApp).",
    basis: "El RE-20 pide \"informar inmediatamente\" sin ventana numérica; propuesto para el mismo turno.",
  },
  {
    n: 67, dueHours: 4, proposed: true,
    evidenceRequirement: "Registro del aviso a la Jefa del Departamento de Prevención de Riesgos.",
    basis: "El RE-20 pide \"informar inmediatamente\" sin ventana numérica; propuesto para el mismo turno.",
  },
  {
    n: 68, dueHours: 3, proposed: false,
    evidenceRequirement: "Informe preliminar enviado al administrador de contrato y al PRF (RE-20, DO-36).",
    basis: "El propio catálogo cita el plazo: \"3 horas de ocurrido el accidente e incidente\".",
  },
  {
    n: 69, dueHours: 24, proposed: false,
    evidenceRequirement: "Encuesta o declaración firmada de la persona accidentada o involucrada (DO-36).",
    basis: "RE-20, según lo documentado en incident-accreditation-connector.ts.",
  },
  {
    n: 70, dueHours: 3, proposed: false,
    evidenceRequirement: "Informe preliminar enviado a la Jefa del Departamento de Prevención y al Subgerente de "
      + "Operaciones, con copia a las gerencias de Operaciones y Legal (RE-20, DO-36).",
    basis: "El propio catálogo cita el plazo: \"3 horas de ocurrido el accidente e incidente\".",
  },
  {
    n: 71, dueHours: 8, proposed: true,
    evidenceRequirement: "Registro de asistencia de la difusión del incidente en los demás turnos.",
    basis: "El catálogo dice \"es inmediata\" sin ventana numérica; propuesto para el cambio de turno siguiente.",
  },
  {
    n: 72, dueHours: 24, proposed: false,
    evidenceRequirement: "DIAT emitida, con derivación a la mutual cuando corresponda.",
    basis: "RE-20, según lo documentado en incident-accreditation-connector.ts.",
  },
  {
    n: 73, dueHours: 72, proposed: false,
    evidenceRequirement: "Informe de investigación con análisis de causas y medidas correctivas implementadas.",
    basis: "El propio catálogo cita el plazo: \"72 horas después de ocurrido el accidente e incidente\".",
  },
  {
    n: 74, dueDays: 5, proposed: true,
    evidenceRequirement: "Informe definitivo de investigación enviado a la Jefa del Departamento de Prevención y "
      + "al Subgerente de Operaciones, con copia a las gerencias de Operaciones y Legal.",
    basis: "Sigue a la investigación (N°73, 72h); el RE-20 no fija su propia ventana. Margen propuesto para redactar y enviar.",
  },
  {
    n: 75, dueHours: 48, proposed: false,
    evidenceRequirement: "Difusión de las medidas preventivas a todas las personas trabajadoras de la faena.",
    basis: "RE-20, según lo documentado en incident-accreditation-connector.ts.",
  },
  {
    n: 76, dueDays: 15, proposed: false,
    evidenceRequirement: "Registro del seguimiento quincenal de las medidas correctivas y recomendaciones.",
    basis: "RE-20, según lo documentado en incident-accreditation-connector.ts (\"seguimiento quincenal\").",
  },
  {
    n: 77, dueDays: 7, proposed: true,
    evidenceRequirement: "Expediente del accidente/incidente archivado (informe preliminar, DIAT, investigación, difusión).",
    basis: "El RE-20 no fija plazo propio para archivar; propuesto tras el cierre del expediente.",
  },
  {
    n: 78, dueHours: 24, proposed: false,
    evidenceRequirement: "ONE PAGE RE-20-06 difundido tras recepcionar el informe preliminar.",
    basis: "RE-20, según lo documentado en incident-accreditation-connector.ts.",
  },
]

type ConstanciaEvidence = {
  n: number
  evidenceRequirement: string
  /** Guía de ejecución del catálogo de la que se deriva el texto. */
  basis: string
}

/**
 * Las nueve `constancia` del programa. No llevan plazo —son calendarizadas, no
 * a demanda— pero sí evidencia: una constancia sin evidencia declarada es
 * "alguien dijo que se hizo", que no se sostiene ante un fiscalizador, y por
 * eso la compuerta 81/81 la rechaza.
 *
 * Cada texto se deriva de la guía de ejecución que el propio catálogo trae
 * (columna "Guía de ejecución", que viaja en `pdtp_activities.program`), no de
 * un criterio inventado acá. Aun así van marcadas como propuestas: la guía
 * dice cómo se hace la actividad, no necesariamente qué documento queda.
 */
const CONSTANCIA_EVIDENCE: ConstanciaEvidence[] = [
  {
    n: 6,
    evidenceRequirement: "Acta de la reunión de revisión del SG-SST, con los temas tratados y los asistentes.",
    basis: "Guía del catálogo: «Reunión en la faena».",
  },
  {
    n: 20,
    evidenceRequirement: "Acta o minuta de la reunión con la empresa mandante, con el programa de trabajo acordado.",
    basis: "Guía del catálogo: «De acuerdo a lo solicitado en cada faena por partes interesadas».",
  },
  {
    n: 22,
    evidenceRequirement: "Registro de la revisión de la plataforma: vencimientos informados y coordinaciones realizadas.",
    basis: "Guía del catálogo: «Revisión de la plataforma e informar vencimientos, coordinaciones para evitar personal bloqueado».",
  },
  {
    n: 28,
    evidenceRequirement: "Registro de la revisión semanal de las inspecciones recibidas, indicando qué hallazgos quedaron cerrados.",
    basis: "Guía del catálogo: «Revisar las inspecciones una vez sean recibidas... en reunión semanal».",
  },
  {
    n: 42,
    evidenceRequirement: "Informe de visitas de la empresa que realiza el control de sanitización y plagas.",
    basis: "Guía del catálogo: «Solicitar informe de visitas».",
  },
  {
    n: 44,
    evidenceRequirement: "Correo de coordinación de la evaluación cualitativa con el asesor de la mutual, con copia a la jefatura.",
    basis: "Guía del catálogo: «Prevencionista debe coordinar actividades con el asesor Mutual, por medio de correos y copiar a su jefatura».",
  },
  {
    n: 61,
    evidenceRequirement: "Certificados de idoneidad de los EPP en uso en la faena, solicitados a Adquisiciones.",
    basis: "Guía del catálogo: «Solicitar a adquisiciones, de acuerdo a los EPP que se utilizan en la faena».",
  },
  {
    n: 82,
    evidenceRequirement: "Mapa de riesgo por área, con los riesgos identificados de cada una.",
    basis: "Guía del catálogo: «Realizar por cada área y riesgos del área».",
  },
]

async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.PDTP_DEMAND_SLAS_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .limit(1)
  if (!row) throw new Error("No hay ningún usuario con rol `administrador`. Pasa PDTP_DEMAND_SLAS_ACTOR_USER_ID explícitamente.")
  return row.userId
}

async function main() {
  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const orderedPrograms = [...programs].sort((a, b) => b.version - a.version)
  // Si hay una v+1 borrador, sus SLA forman parte del contenido que todavía
  // se puede completar. Nunca se debe preferir la v1 activa y firmada.
  const program = orderedPrograms.find((item) => item.status === "draft")
    ?? orderedPrograms.find((item) => item.status === "active")
    ?? orderedPrograms[0]
  if (!program) bail(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  const actorUserId = await resolveActorUserId().catch((err: unknown) => {
    return bail(err instanceof Error ? err.message : String(err))
  })

  let locked = false
  try {
    assertPdtpProgramEditableState(program)
  } catch {
    locked = true
  }
  const planOnly = DRY_RUN || locked

  const mode = DRY_RUN ? "[DRY RUN]" : locked ? "[SÓLO LECTURA: programa firmado]" : "escribiendo"
  console.log(`SLA de las actividades a demanda del PDTP ${PROGRAM_YEAR} — ${mode}`)
  console.log(`  Programa: ${program.id} (status=${program.status}) · actor=${actorUserId}`)
  console.log("")

  const rows = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))
  const byN = new Map(rows.map((row) => [row.n, row]))
  let changes = 0

  for (const item of DEMAND_SLAS) {
    const activity = byN.get(item.n)
    if (!activity) { console.warn(`  ? N°${item.n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${item.n}: retirada, se omite.`); continue }

    const proposedNotes = `Plazo propuesto, confirmar con Prevención. ${item.basis}`
    const wired = activity.dueDays === (item.dueDays ?? null)
      && activity.dueHours === (item.dueHours ?? null)
      && activity.evidenceRequirement === item.evidenceRequirement
      && activity.scheduleClassificationStatus === "confirmed"
      && (!item.proposed || activity.notes === proposedNotes)
    if (wired) { console.log(`  · N°${item.n}: ya tiene su SLA aplicado.`); continue }

    if (!planOnly) {
      await updatePdtpActivity({
        activityId: activity.id,
        dueDays: item.dueDays ?? null,
        dueHours: item.dueHours ?? null,
        evidenceRequirement: item.evidenceRequirement,
        scheduleClassificationStatus: "confirmed",
        ...(item.proposed ? { notes: proposedNotes } : {}),
      }, actorUserId)
    }
    const plazo = item.dueHours !== undefined ? `${item.dueHours} h` : `${item.dueDays} d`
    console.log(`  ✓ N°${item.n}: plazo ${plazo}${item.proposed ? " (propuesto)" : ""}, evidencia y clasificación confirmada.`)
    changes++
  }

  console.log("")
  console.log("Evidencia mínima de las constancias")
  let evidenceChanges = 0
  for (const item of CONSTANCIA_EVIDENCE) {
    const activity = byN.get(item.n)
    if (!activity) { console.warn(`  ? N°${item.n}: no existe en el programa, se omite.`); continue }
    if (activity.status === "retired") { console.log(`  · N°${item.n}: retirada, se omite.`); continue }
    // Si dejó de ser constancia (la reclasificó otro script), su evidencia ya
    // no la exige la compuerta y forzarla sería escribir sobre una decisión
    // que este archivo no tomó.
    if (activity.mechanism !== "constancia") {
      console.log(`  · N°${item.n}: ya no es constancia (${activity.mechanism}), se omite.`)
      continue
    }

    const proposedNotes = `Evidencia propuesta, confirmar con Prevención. ${item.basis}`
    if (activity.evidenceRequirement === item.evidenceRequirement && activity.notes === proposedNotes) {
      console.log(`  · N°${item.n}: ya tiene su evidencia declarada.`)
      continue
    }

    if (!planOnly) {
      await updatePdtpActivity({
        activityId: activity.id,
        evidenceRequirement: item.evidenceRequirement,
        notes: proposedNotes,
      }, actorUserId)
    }
    console.log(`  ✓ N°${item.n}: evidencia declarada (propuesta).`)
    evidenceChanges++
  }

  console.log("")
  console.log(`Resumen: ${changes} actividad(es) con SLA sobre ${DEMAND_SLAS.length} declaradas, `
    + `${evidenceChanges} constancia(s) con evidencia sobre ${CONSTANCIA_EVIDENCE.length}.`)

  if (locked && changes > 0) {
    bail(
      `El programa ${program.id} ya entró a revisión (status=${program.status}) y quedan ${changes} SLA sin `
      + "aplicar. Su contenido está firmado, así que aplicarlos exige una revisión nueva del programa.",
    )
  }

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
