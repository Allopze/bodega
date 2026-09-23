/**
 * scripts/apply-pdtp-2026-mechanisms.ts
 *
 * Persiste en `pdtp_activities.mechanism` la clasificación de los 7 bloques del
 * diseño 2026-08-12 (§5 del documento). Hasta ahora vivía sólo en el markdown y
 * el código no podía consultarla: el submódulo Constancias necesita saber qué
 * actividades le corresponden, y el motor de acreditación qué actividades
 * espera un evento externo.
 *
 * Los números son los del catálogo 2026. Las actividades retiradas por G12 (N°2,
 * 5, 12, 13, 14 y 21) no aparecen a propósito.
 *
 *   npm run pdtp:apply-mechanisms
 *   PDTP_MECHANISMS_DRY_RUN=true npm run pdtp:apply-mechanisms
 *
 * Idempotente: reejecutar no cambia nada si ya está aplicado.
 *
 * `PDTP_MECHANISMS_DEPLOY_MODE` lo vuelve tolerante a que el programa del año
 * todavía no exista —el bootstrap del PDTP es un paso aparte—, que en un deploy
 * es información y no una falla. Corre después de las decisiones de catálogo,
 * porque clasifica sólo las actividades que siguen activas.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms } from "@/db/schema"
import { assertPdtpProgramEditableState } from "@/lib/services/pdtp/helpers"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_MECHANISMS_DRY_RUN === "true"
const DEPLOY_MODE = process.env.PDTP_MECHANISMS_DEPLOY_MODE === "true"

/**
 * Corta la ejecución por una condición que en el deploy no es un error.
 *
 * Invocado a mano el script tiene que fallar fuerte. Dentro del deploy abortar
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

type Mechanism = "enganche" | "constancia" | "formulario" | "compuesta"

/**
 * 🔗 Enganche — un registro que ya existe en otro módulo cierra la actividad.
 * Incluye las 7 de inspección cuya plantilla ya quedó instalada y cableada
 * (D10), las de capacitación, campañas, emergencia, MIPER, CPHS e incidentes.
 */
const ENGANCHE = [
  1,           // aprobación de Legal y RRHH sobre el propio programa
  7,           // ingreso de indicadores de la faena
  9,           // revisión por la dirección
  11,          // constituir el comité paritario
  16,          // prueba de evaluación IRL → sesión del curso PDTP-16 aprobada
  17,          // RE-28 de personas sensibles → acta `identificacion_sensibles`
  19,          // carpeta de requisitos legales → Documentación SST
  // Verificación de condiciones ambientales DS 594: sin anexo/formulario
  // fuente, así que el checklist se escribió directo desde la ley (D11,
  // 2026-09-02). `PDTP_2026_INSPECTION_SPECS` ya la declara.
  10,
  // Alcotest (G14, 2026-09-02): `alcohol_tests` recuperada y
  // `prevention-alcotest.ts` cablea el control (N°30 PRF, N°31 Sup/JT según
  // rol de quien registra) y el envío mensual de registros (N°32).
  30, 31, 32,
  // CGRD del DS 44 (G15, 2026-09-02): `prevention-cgrd.ts` cablea la
  // constitución del comité, la publicación de la matriz GRD y el acta cerrada.
  79, 80, 81,
  // Task 12 (M2.5, 2026-09-23): la reunión con la empresa mandante ya la
  // registra "Visitas y coordinación" (`prevention_external_engagements`,
  // kind='coordinacion' + counterpartyType='mandante') sin tocar el PDTP.
  // Declararla aparte en Constancias era el mismo hecho cargado dos veces por
  // dos caminos distintos; ahora cierra la N°20 el propio cierre de la
  // interacción (`external-engagement-accreditation-connector.ts`). Estuvo en
  // CONSTANCIA hasta esta tarea.
  20,
  // La N°21 salió del programa por la D02: medía lo mismo que las N°66–78.
  24, 27, 29, 33, 34, 39, 40, 41, 64, 65,  // inspecciones y observaciones
  // El report de uso diario y su revisión: la plantilla `reporte_equipos` los
  // declara juntos (`PDTP_2026_INSPECTION_SPECS`), así que transcribir el
  // reporte acredita ambos. Estaban en FORMULARIO por la decisión A7, que se
  // cerró el 2026-08-23.
  25, 26,
  35, 36,      // MIPER: matriz y su difusión
  37, 38,      // charlas de seguridad
  43,          // procedimientos de trabajo seguro → Documentación SST
  45,          // evaluación cuantitativa por mutual → medición de exposición
  46, 47, 48, 49,  // protocolos MINSAL (PREXOR, TMERT, PSICOSOCIAL, UV)
  50,          // trabajadores en programa de vigilancia
  51,          // capacitación según detección de necesidades
  53, 54, 55, 56, 57, 58, 59, 60, 63,  // charlas y capacitaciones
  62,          // registro de entrega de EPP
  83, 84,      // plan de emergencia y simulacros
  85, 86, 87, 88, 89,  // campañas
  // Bloque 6: los 13 pasos del flujo de accidentes (RE-20). Doce pasan por
  // obligación desde la Fase 3 (2026-09-02, `incident-accreditation-
  // connector.ts`) y se miden por `closed_on_time`; la N°76 (seguimiento
  // quincenal) sigue acreditando directo porque puede repetirse un número no
  // acotado de veces por incidente.
  66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
] as const

/**
 * ✍️ Constancia — se hizo o no se hizo, con evidencia u observación.
 *
 * ⚠️ Al agregar un número acá, declara también su **evidencia mínima** en
 * `CONSTANCIA_EVIDENCE` de `apply-pdtp-2026-demand-slas.ts`: la compuerta 81/81
 * rechaza una constancia sin evidencia declarada, y sin ella el programa no se
 * puede enviar a revisión.
 */
const CONSTANCIA = [
  3,           // difusión del plan en faenas
  6,           // reunión de revisión SG-SST
  // La N°20 salió de acá por la Task 12 (M2.5, 2026-09-23): ver ENGANCHE.
  22,          // control de plataformas de la empresa y del mandante
  // Revisar y cerrar las inspecciones de equipos. Manual por decisión de
  // jefatura (2026-08-21) y no por falta de mecanismo: es un acto semanal sobre
  // el CONJUNTO de inspecciones recibidas, no sobre un run, así que acreditarla
  // por inspección haría que una semana con doce reportara doce cumplimientos
  // de una actividad planificada como uno. `PDTP_2026_INSPECTION_SPECS` ya la
  // excluye con la misma explicación.
  28,
  42,          // control documental de sanitización y plagas
  // Evaluación cualitativa por mutual. No hay evento cualitativo que enganchar:
  // `prevention_exposure_measurements.value` es numérico obligatorio en las tres
  // capas —schema (`db/schema/prevention/hygiene.ts`), Zod
  // (`lib/validation/prevention-module/hygiene.ts`) y el formulario—, así que
  // registrarla como medición obligaría a inventar un número que la evaluación
  // no tiene. Su hermana cuantitativa (N°45) sí engancha.
  44,
  61,          // certificados de idoneidad de EPP
  82,          // mapa de riesgo por área
] as const

/**
 * 🧩 Compuesta — se cumple cuando sus componentes están completos.
 *
 * La **N°16** salió de acá el 2026-09-03: la acredita el cierre de una sesión
 * del curso `PDTP-16`, con la evaluación aprobada, así que es un enganche
 * corriente y no una composición de otras actividades. Ver `ENGANCHE`.
 *
 * La **N°17** también, por el camino contrario: tiene instrumento propio desde
 * que se escribió el RE-28 (`identificacion_sensibles`), y lo acredita cerrar
 * su acta.
 */
const COMPUESTA = [
  15, 18, 23,  // registros de Habilitación del trabajador
  52,          // la inducción completa: se cierra con sus componentes
] as const

/**
 * 📝 Formulario propio — ninguna actividad lo usa hoy.
 *
 * Sus dos únicas ocupantes (N°25 y N°26) pasaron a `enganche` cuando la
 * decisión A7 se cerró el 2026-08-23. El mecanismo se conserva en el vocabulario
 * porque sigue siendo una opción válida del diseño: una actividad cuyo registro
 * hay que crear dentro del PDTP porque ningún módulo lo produce.
 */
const FORMULARIO = [] as const

const ASSIGNMENTS: Array<{ mechanism: Mechanism; numbers: readonly number[] }> = [
  { mechanism: "enganche", numbers: ENGANCHE },
  { mechanism: "constancia", numbers: CONSTANCIA },
  { mechanism: "compuesta", numbers: COMPUESTA },
  { mechanism: "formulario", numbers: FORMULARIO },
]

async function main() {
  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const orderedPrograms = [...programs].sort((a, b) => b.version - a.version)
  // Clasificar es una edición del contenido del programa. Si existe una
  // revisión borrador se completa allí; el activo firmado sólo se consulta.
  const program = orderedPrograms.find((item) => item.status === "draft")
    ?? orderedPrograms.find((item) => item.status === "active")
    ?? orderedPrograms[0]
  if (!program) bail(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  let locked = false
  try {
    assertPdtpProgramEditableState(program)
  } catch {
    locked = true
  }
  const planOnly = DRY_RUN || locked

  console.log(`Mecanismos PDTP ${PROGRAM_YEAR} — ${DRY_RUN ? "[DRY RUN]" : locked ? "[SÓLO LECTURA: programa firmado]" : "escribiendo"}`)
  console.log(`  Programa: ${program.id} (status=${program.status})`)
  console.log("")

  // Un número en dos listas sería un error de clasificación silencioso.
  const seen = new Map<number, Mechanism>()
  for (const { mechanism, numbers } of ASSIGNMENTS) {
    for (const n of numbers) {
      const previo = seen.get(n)
      if (previo) throw new Error(`La actividad N°${n} está clasificada dos veces: ${previo} y ${mechanism}.`)
      seen.set(n, mechanism)
    }
  }

  const activas = await db.select({ n: pdtpActivities.n, mechanism: pdtpActivities.mechanism })
    .from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, program.id), eq(pdtpActivities.status, "active")))

  let changed = 0
  for (const { mechanism, numbers } of ASSIGNMENTS) {
    const pendientes = activas
      .filter((row) => numbers.includes(row.n) && row.mechanism !== mechanism)
      .map((row) => row.n)
    if (pendientes.length === 0) {
      console.log(`  · ${mechanism}: sin cambios (${numbers.length} declaradas).`)
      continue
    }
    if (!planOnly) {
      await db.update(pdtpActivities).set({ mechanism, updatedAt: new Date().toISOString() })
        .where(and(
          eq(pdtpActivities.programId, program.id),
          eq(pdtpActivities.status, "active"),
          inArray(pdtpActivities.n, pendientes),
        ))
    }
    console.log(`  ✓ ${mechanism}: ${pendientes.length} actividad(es) → ${pendientes.join(", ")}`)
    changed += pendientes.length
  }

  const declaradas = new Set(seen.keys())
  const sinClasificar = activas.filter((row) => !declaradas.has(row.n)).map((row) => row.n)
  const inexistentes = [...declaradas].filter((n) => !activas.some((row) => row.n === n))

  console.log("")
  console.log(`Resumen: ${changed} actividad(es) actualizada(s) sobre ${activas.length} activas.`)
  if (sinClasificar.length > 0) console.warn(`⚠ Sin clasificar: ${sinClasificar.join(", ")}`)
  if (inexistentes.length > 0) console.warn(`⚠ Declaradas pero no están activas en el programa: ${inexistentes.join(", ")}`)
  if (locked && changed > 0) {
    bail(`El programa ${program.id} está bloqueado; se detectaron ${changed} clasificación(es) que requieren una revisión v+1.`)
  }
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
