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
 * El programa elegido es el draft abierto del año, o si no hay ninguno, el
 * activo. Si ese programa está bloqueado (`assertPdtpProgramEditableState`:
 * contenido ya firmado) y hay clasificaciones pendientes, el script YA NO se
 * limita a advertir: abre —o reutiliza, si ya existe— una revisión v+1 con
 * `createPdtpRevision` (mismo camino que el botón "Crear revisión" de la UI, y
 * como él, idempotente) y aplica ahí los cambios, sobre las actividades
 * clonadas del programa activo (mismo `status` y `mechanism` de origen, porque
 * son un clon). La revisión queda en `draft`, a la espera de su propio proceso
 * de firma; este script nunca la firma ni la activa, y nunca escribe sobre el
 * programa activo/firmado.
 *
 * `createPdtpRevision` puede REUTILIZAR una revisión v+1 que ya existía —
 * abierta por un humano, y que ese humano ya haya sometido formalmente a
 * revisión (`reviewStartedAt` seteado) o tenga alguna aprobación parcial
 * (`approvedByJdprUserId`/`approvedByLegalUserId`), aunque su `status` siga
 * figurando `draft`. Escribirle encima mutaría en silencio un borrador que un
 * humano ya está evaluando para firmar. Por eso, antes de tocar la revisión
 * reutilizada, se corre el mismo `assertPdtpProgramEditableState` que decide
 * si el programa elegido está bloqueado: si esa revisión ya no es un simple
 * draft recién abierto, el script hace `bail()` sin escribir nada sobre ella.
 *
 * El comportamiento es el mismo en modo manual y en
 * `PDTP_MECHANISMS_DEPLOY_MODE`: ambos abren la revisión cuando hace falta. La
 * única diferencia sigue siendo abortar (manual) vs. advertir y continuar sin
 * escribir (deploy) ante un fallo real —por ejemplo, no hay actor a quien
 * atribuir la revisión y tampoco viene declarado por env var, o no existe
 * ningún programa activo del año desde el cual abrir una revisión—, nunca "abrir
 * vs. no abrir la revisión".
 *
 * `PDTP_MECHANISMS_DEPLOY_MODE` además vuelve tolerante que el programa del año
 * todavía no exista —el bootstrap del PDTP es un paso aparte—, que en un deploy
 * es información y no una falla. Corre después de las decisiones de catálogo,
 * porque clasifica sólo las actividades que siguen activas.
 *
 * `PDTP_MECHANISMS_ACTOR_USER_ID` fija a quién se atribuye la revisión nueva; si
 * falta, se usa el primer usuario con rol `administrador` (mismo patrón que
 * `PDTP_PROGRAM_DATA_ACTOR_USER_ID`/`resolveActorUserId()` en
 * `apply-pdtp-2026-program-data.ts` — no se inventa un mecanismo distinto). Se
 * resuelve sólo cuando de verdad hace falta abrir una revisión: una corrida
 * normal, sobre un draft editable, no exige que exista ningún administrador.
 *
 * `PDTP_MECHANISMS_DRY_RUN` sigue siendo estrictamente de lectura: ni escribe
 * mecanismos ni abre una revisión, incluso si detecta que el programa está
 * bloqueado y con cambios pendientes — sólo informa que haría falta una.
 */

import { pathToFileURL } from "node:url"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, roles, userRoles } from "@/db/schema"
import { assertPdtpProgramEditableState } from "@/lib/services/pdtp/helpers"
import { createPdtpRevision } from "@/lib/services/pdtp/programs"

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

/** Lanza si un número quedó declarado en dos listas: sería un error de clasificación silencioso. */
export function assertNoDuplicateClassification(): void {
  const seen = new Map<number, Mechanism>()
  for (const { mechanism, numbers } of ASSIGNMENTS) {
    for (const n of numbers) {
      const previo = seen.get(n)
      if (previo) throw new Error(`La actividad N°${n} está clasificada dos veces: ${previo} y ${mechanism}.`)
      seen.set(n, mechanism)
    }
  }
}

export type ActiveActivityMechanismRow = { n: number; mechanism: string | null }
export type MechanismChange = { n: number; mechanism: Mechanism }

/** Actividades activas cuyo mecanismo declarado no coincide con el catálogo. Función pura. */
export function planMechanismChanges(activeActivities: ActiveActivityMechanismRow[]): MechanismChange[] {
  const changes: MechanismChange[] = []
  for (const { mechanism, numbers } of ASSIGNMENTS) {
    for (const row of activeActivities) {
      if (numbers.includes(row.n) && row.mechanism !== mechanism) changes.push({ n: row.n, mechanism })
    }
  }
  return changes
}

/** Números activos que ninguna lista del catálogo declara. */
export function unclassifiedActiveNumbers(activeActivities: ActiveActivityMechanismRow[]): number[] {
  const declared = new Set(ASSIGNMENTS.flatMap((a) => a.numbers))
  return activeActivities.filter((row) => !declared.has(row.n)).map((row) => row.n)
}

/** Números declarados en el catálogo que no existen como actividad activa del programa. */
export function declaredButInactiveNumbers(activeActivities: ActiveActivityMechanismRow[]): number[] {
  const declared = new Set(ASSIGNMENTS.flatMap((a) => a.numbers))
  return [...declared].filter((n) => !activeActivities.some((row) => row.n === n))
}

export async function loadActiveActivityMechanisms(programId: string): Promise<ActiveActivityMechanismRow[]> {
  return db.select({ n: pdtpActivities.n, mechanism: pdtpActivities.mechanism })
    .from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, programId), eq(pdtpActivities.status, "active")))
}

/** Escribe los cambios agrupados por mecanismo destino. Devuelve cuántas actividades cambiaron. */
export async function applyMechanismChanges(programId: string, changes: MechanismChange[]): Promise<number> {
  if (changes.length === 0) return 0
  const numbersByMechanism = new Map<Mechanism, number[]>()
  for (const change of changes) {
    const list = numbersByMechanism.get(change.mechanism) ?? []
    list.push(change.n)
    numbersByMechanism.set(change.mechanism, list)
  }
  const now = new Date().toISOString()
  for (const [mechanism, numbers] of numbersByMechanism) {
    await db.update(pdtpActivities).set({ mechanism, updatedAt: now })
      .where(and(
        eq(pdtpActivities.programId, programId),
        eq(pdtpActivities.status, "active"),
        inArray(pdtpActivities.n, numbers),
      ))
  }
  return changes.length
}

/**
 * Resuelve a quién atribuir la revisión nueva. Mismo orden que
 * `resolveActorUserId()` en `apply-pdtp-2026-program-data.ts`: env var
 * primero, luego el primer usuario con rol `administrador`, y si no hay
 * ninguno, `bail()` — tolerante en modo deploy, error fuerte en modo manual.
 */
async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.PDTP_MECHANISMS_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .limit(1)
  if (!row) bail("No hay ningún usuario con rol `administrador`. Pasa PDTP_MECHANISMS_ACTOR_USER_ID.")
  return row.userId
}

/**
 * Abre (o reutiliza) la revisión v+1 del programa activo y aplica ahí los
 * cambios de mecanismo pendientes. Nunca toca el programa activo:
 * `createPdtpRevision` clona sus `pdtpActivities` con `status` y `mechanism`
 * de origen intactos (es un clon), así que la revisión arranca con el mismo
 * mecanismo desactualizado y el filtro `status = "active"` sigue siendo
 * válido sobre las filas clonadas.
 *
 * `createPdtpRevision` reutiliza CUALQUIER revisión ya abierta para el mismo
 * programa origen cuyo `status` esté en `["draft", "in_review"]` — incluida
 * una que un humano ya sometió formalmente a revisión o que ya tiene alguna
 * aprobación parcial, aunque su `status` siga siendo `draft` hasta que la
 * aprobación se complete. Escribir ahí sin comprobar nada mutaría en silencio
 * el contenido de un borrador que un humano ya está evaluando para firmar. Por
 * eso, apenas se resuelve la revisión (nueva o reutilizada), se la somete al
 * mismo chequeo que decide si un programa está bloqueado
 * (`assertPdtpProgramEditableState`): si ya no es un draft recién abierto, se
 * aborta con `bail()` sin escribir nada sobre ella.
 */
export async function applyPendingChangesInNewRevision(
  activeProgram: { id: string },
): Promise<{ programId: string; applied: number }> {
  const actorUserId = await resolveActorUserId()
  const revision = await createPdtpRevision({ sourceProgramId: activeProgram.id, userId: actorUserId })
  try {
    assertPdtpProgramEditableState(revision.program)
  } catch {
    bail(
      `La revisión v+1 ${revision.programId} del programa ${activeProgram.id} ya está en proceso de revisión ` +
      "formal; no se aplican cambios automáticos sobre un borrador que un humano ya está evaluando. Aplica la " +
      "reclasificación a mano o espera a que se resuelva esa revisión.",
    )
  }
  const revisionActivities = await loadActiveActivityMechanisms(revision.programId)
  const revisionChanges = planMechanismChanges(revisionActivities)
  const applied = await applyMechanismChanges(revision.programId, revisionChanges)
  return { programId: revision.programId, applied }
}

export type MechanismsPassResult =
  | { kind: "dry_run"; changes: MechanismChange[]; locked: boolean }
  | { kind: "applied_directly"; programId: string; applied: number }
  | { kind: "locked_no_pending_changes"; programId: string }
  | { kind: "applied_in_revision"; sourceProgramId: string; revisionProgramId: string; applied: number }

/**
 * Orquesta una corrida completa: elige el programa del año, decide si está
 * bloqueado, calcula los cambios pendientes y los aplica donde corresponda
 * (directo si el programa es editable, en una revisión v+1 si está firmado).
 * No llama a `process.exit`: lo hace `main()`, que es lo único que impide
 * probar el flujo completo del script dentro de un test.
 */
export async function runMechanismsPass(): Promise<MechanismsPassResult> {
  assertNoDuplicateClassification()

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

  console.log(`Mecanismos PDTP ${PROGRAM_YEAR} — ${DRY_RUN ? "[DRY RUN]" : locked ? "[PROGRAMA FIRMADO: se aplicará en una revisión v+1]" : "escribiendo"}`)
  console.log(`  Programa: ${program.id} (status=${program.status})`)
  console.log("")

  const activeActivities = await loadActiveActivityMechanisms(program.id)
  const changes = planMechanismChanges(activeActivities)

  for (const { mechanism, numbers } of ASSIGNMENTS) {
    const pendientes = changes.filter((change) => change.mechanism === mechanism).map((change) => change.n)
    if (pendientes.length === 0) {
      console.log(`  · ${mechanism}: sin cambios (${numbers.length} declaradas).`)
    } else {
      console.log(`  ${DRY_RUN ? "◦ se marcarían" : "✓"} ${mechanism}: ${pendientes.length} actividad(es) → ${pendientes.join(", ")}`)
    }
  }

  const sinClasificar = unclassifiedActiveNumbers(activeActivities)
  const inexistentes = declaredButInactiveNumbers(activeActivities)
  console.log("")
  if (sinClasificar.length > 0) console.warn(`⚠ Sin clasificar: ${sinClasificar.join(", ")}`)
  if (inexistentes.length > 0) console.warn(`⚠ Declaradas pero no están activas en el programa: ${inexistentes.join(", ")}`)

  // Estrictamente de lectura: ni escribe mecanismos ni abre una revisión, así
  // el programa esté bloqueado y con cambios pendientes — sólo lo informa.
  if (DRY_RUN) {
    if (locked && changes.length > 0) {
      console.log(`[DRY RUN] ${changes.length} actividad(es) cambiarían de mecanismo, pero el programa está bloqueado: correrlo de verdad abriría (o reutilizaría) una revisión v+1. No se escribió nada.`)
    } else {
      console.log(`[DRY RUN] ${changes.length} actividad(es) cambiarían de mecanismo. No se escribió nada.`)
    }
    return { kind: "dry_run", changes, locked }
  }

  if (!locked) {
    const applied = await applyMechanismChanges(program.id, changes)
    console.log(`Resumen: ${applied} actividad(es) actualizada(s) sobre ${activeActivities.length} activas.`)
    return { kind: "applied_directly", programId: program.id, applied }
  }

  if (changes.length === 0) {
    console.log(`Resumen: el programa ${program.id} está bloqueado, pero no hay clasificaciones pendientes.`)
    return { kind: "locked_no_pending_changes", programId: program.id }
  }

  const activeProgram = orderedPrograms.find((item) => item.status === "active")
  if (!activeProgram) {
    bail(`El programa ${program.id} está bloqueado y no existe un programa activo del año ${PROGRAM_YEAR} desde el cual abrir una revisión.`)
  }

  console.log(`  → El programa ${program.id} está bloqueado; abriendo (o reutilizando) una revisión v+1 de ${activeProgram.id} para aplicar ${changes.length} cambio(s).`)
  let revisionResult: { programId: string; applied: number }
  try {
    revisionResult = await applyPendingChangesInNewRevision(activeProgram)
  } catch (error) {
    bail(`No se pudo abrir/aplicar la revisión v+1 de ${activeProgram.id}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (revisionResult.applied === 0) {
    console.log(`Resumen: la revisión ${revisionResult.programId} ya tenía la clasificación aplicada (de una corrida anterior). El programa activo ${activeProgram.id} no se modificó.`)
  } else {
    console.log(`Resumen: ${revisionResult.applied} actividad(es) actualizada(s) en la revisión ${revisionResult.programId} (draft, sin firmar). El programa activo ${activeProgram.id} no se modificó.`)
  }
  return { kind: "applied_in_revision", sourceProgramId: activeProgram.id, revisionProgramId: revisionResult.programId, applied: revisionResult.applied }
}

async function main() {
  await runMechanismsPass()
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
