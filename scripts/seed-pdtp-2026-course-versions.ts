/**
 * scripts/seed-pdtp-2026-course-versions.ts
 *
 * Carga en BORRADOR la versión de los cursos del programa 2026 cuyo temario
 * está documentado.
 *
 *   SEED_VERSIONS_ACTOR_USER_ID=<id> npm run pdtp:seed-course-versions
 *   SEED_VERSIONS_DRY_RUN=true SEED_VERSIONS_ACTOR_USER_ID=<id> npm run pdtp:seed-course-versions
 *
 * Los trece cursos del programa existen como ficha pero sin ninguna versión, y
 * sin versión publicada `createTrainingSession` no deja programar la sesión: la
 * actividad del PDTP queda planificada y sin forma de cumplirse. Esto cubre los
 * trece.
 *
 * **En borrador, y hasta ahí llega el script.** Publicar exige recorrer
 * `draft → in_review → approved → published`, y `transitionTrainingCourseVersion`
 * prohíbe que quien redactó el contenido lo apruebe. Automatizar la aprobación
 * sería saltarse el segundo par de ojos que la norma pide, así que el guion
 * deja el contenido cargado y la firma la pone una persona.
 *
 * Procedencia de cada temario, que es lo que se responde si alguien pregunta de
 * dónde salió:
 *
 *   N°16, 37, 38, 51, 53, 57, 63  Dictamen técnico de Prevención sobre el cierre
 *                                 de temarios del programa 2026.
 *   N°54                          Ficha Mutual "Manejo de Extintores" (4 módulos,
 *                                 120 min), con la duración y la modalidad del
 *                                 certificado del 24/04/2026 —presencial en el
 *                                 taller, no la variante streaming del catálogo—.
 *   N°58                          Ficha Mutual "Gestión del Riesgo de Desastres
 *                                 en Centros de Trabajo" (3 módulos, 240 min),
 *                                 el curso que el diploma de la Coordinadora
 *                                 acredita.
 *
 * En las fichas de Mutual la distribución de minutos por módulo es una
 * adaptación declarada: Mutual publica el contenido y la duración total, no el
 * reparto. Se anota en el detalle del módulo para que no se lea como dato
 * oficial que no es.
 */

import { createHash } from "node:crypto"
import { eq, or } from "drizzle-orm"
import { db } from "@/db"
import {
  permissions as permissionsTable,
  preventionTrainingCourses,
  preventionTrainingCourseVersions,
  preventionTrainingHistory,
  rolePermissions,
  roles,
  userPermissions,
  userRoles,
  users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { TRAINING_MODALITIES } from "@/lib/validation/prevention-module/training"

const DRY_RUN = process.env.SEED_VERSIONS_DRY_RUN === "true"

const OTEC_MINUTES_NOTE =
  "La ficha del OTEC publica los módulos y la duración total del curso, no el reparto de minutos por "
  + "módulo: esta distribución es una adaptación interna para programación."

const MUTUAL_MINUTES_NOTE =
  "Mutual publica el contenido y la duración total del curso, no el reparto de minutos por módulo: "
  + "esta distribución es una adaptación interna para programación."

export type CourseVersionSeed = {
  code: string
  versionLabel: string
  /** Módulos con su duración. La suma no puede exceder `durationMinutes`. */
  contentOutline: Array<{ title: string; minutes: number; detail?: string }>
  durationMinutes: number
  modality: (typeof TRAINING_MODALITIES)[number]
  assessmentType: "none" | "theoretical" | "practical" | "both"
  passingScore: number
  /** De dónde sale el temario. Queda en el historial. */
  source: string
}

export const PDTP_2026_COURSE_VERSIONS: readonly CourseVersionSeed[] = [
  {
    code: "PDTP-53",
    versionLabel: "01",
    durationMinutes: 15,
    modality: "presencial",
    // Una charla de quince minutos no rinde prueba; su valor está en ser breve,
    // específica y quedar registrada. La "confirmación" del último módulo es
    // comprobación operacional, no examen.
    assessmentType: "none",
    passingScore: 70,
    source: "Dictamen técnico de Prevención, cierre de temarios del programa 2026.",
    contentOutline: [
      { title: "Contexto de la jornada y riesgo prioritario", minutes: 5, detail: "Identificación de los trabajos del día, cambios de condiciones, riesgos críticos o alertas relevantes." },
      { title: "Controles y conducta segura", minutes: 7, detail: "Medidas preventivas, controles críticos, procedimiento aplicable y EPP requerido." },
      { title: "Confirmación y compromisos", minutes: 3, detail: "Dudas, observaciones de las personas trabajadoras y confirmación de controles antes de iniciar." },
    ],
  },
  {
    code: "PDTP-37",
    versionLabel: "01",
    durationMinutes: 30,
    modality: "presencial",
    assessmentType: "none",
    passingScore: 70,
    source: "Dictamen técnico de Prevención, cierre de temarios del programa 2026.",
    contentOutline: [
      { title: "Estado preventivo de la faena", minutes: 5, detail: "Alertas, hallazgos, cambios y lecciones relevantes." },
      { title: "Peligros críticos de las tareas", minutes: 10, detail: "Exposiciones y actividades de mayor criticidad de la jornada." },
      { title: "Controles operacionales y respuesta", minutes: 10, detail: "Procedimientos, controles críticos, EPP, interferencias y respuesta ante desviaciones o emergencias." },
      { title: "Verificación de comprensión y compromisos", minutes: 5, detail: "Preguntas, aclaraciones y compromisos de control. El registro de la sesión debe indicar qué riesgo, tarea crítica o hallazgo se trató efectivamente." },
    ],
  },
  {
    code: "PDTP-38",
    versionLabel: "01",
    durationMinutes: 30,
    modality: "presencial",
    assessmentType: "none",
    passingScore: 70,
    source: "Dictamen técnico de Prevención, cierre de temarios del programa 2026.",
    contentOutline: [
      { title: "Condiciones y cambios del turno", minutes: 5, detail: "Estado del área, equipos, personal y novedades del turno anterior." },
      { title: "Plan de trabajo, peligros e interferencias", minutes: 10, detail: "Actividades críticas, simultaneidad y riesgos de la jornada." },
      { title: "Controles, roles y coordinación", minutes: 10, detail: "Responsables, controles críticos, comunicaciones y criterios de detención o escalamiento." },
      { title: "Confirmación del equipo", minutes: 5, detail: "Preguntas, retroalimentación y cierre de compromisos. El registro de la sesión debe indicar qué riesgo o cambio se trató efectivamente." },
    ],
  },
  {
    code: "PDTP-16",
    versionLabel: "01",
    durationMinutes: 60,
    modality: "elearning",
    assessmentType: "theoretical",
    passingScore: 70,
    // La prueba no sustituye la IRL: es comprobación posterior. La obligación
    // principal sigue siendo que la persona reciba la información preventiva
    // antes de iniciar labores (DS 44 art. 15).
    source: "Dictamen técnico de Prevención, cierre de temarios del programa 2026, sobre el deber de información del art. 15 del DS 44.",
    contentOutline: [
      { title: "Instrucciones y criterios de evaluación", minutes: 5, detail: "Alcance de la prueba, forma de respuesta y criterios de aprobación." },
      { title: "Evaluación de condiciones, peligros y medidas preventivas", minutes: 20, detail: "Puesto y lugar de trabajo, riesgos asociados y controles." },
      { title: "Evaluación de procedimientos, equipos, sustancias, EPP y emergencias", minutes: 20, detail: "Procedimientos seguros, condiciones de operación, información de sustancias y respuesta inicial." },
      { title: "Casos aplicados de IRL", minutes: 10, detail: "Resolución de situaciones de trabajo y elección del control apropiado." },
      { title: "Revisión y cierre", minutes: 5, detail: "Retroalimentación general y registro de resultado." },
    ],
  },
  {
    code: "PDTP-51",
    versionLabel: "01",
    durationMinutes: 240,
    modality: "mixta",
    assessmentType: "both",
    passingScore: 70,
    source: "Dictamen técnico de Prevención, cierre de temarios del programa 2026.",
    contentOutline: [
      { title: "Necesidad detectada y objetivo de aprendizaje", minutes: 20, detail: "Brecha identificada, población expuesta y conducta o competencia esperada. El contenido específico de cada ejecución se define conforme a la necesidad documentada que la origina: el registro de la sesión debe identificar la brecha, su fuente, los contenidos impartidos y la evidencia de evaluación." },
      { title: "Contenido técnico asociado a la necesidad", minutes: 60, detail: "Desarrollo de conceptos y requisitos aplicables a la brecha detectada." },
      { title: "Peligros, controles y procedimiento aplicable", minutes: 60, detail: "Riesgos relacionados y controles requeridos." },
      { title: "Aplicación práctica o caso de trabajo", minutes: 70, detail: "Ejercicios, demostración, resolución de caso o práctica según la materia." },
      { title: "Evaluación y retroalimentación", minutes: 30, detail: "Comprobación del aprendizaje, corrección de brechas y cierre." },
    ],
  },
  {
    code: "PDTP-57",
    versionLabel: "01",
    durationMinutes: 240,
    modality: "presencial",
    assessmentType: "both",
    passingScore: 70,
    source: "Dictamen técnico de Prevención, cierre de temarios del programa 2026.",
    contentOutline: [
      { title: "Fundamentos y barreras de la comunicación", minutes: 40, detail: "Proceso comunicacional, distorsiones y factores que afectan la comprensión." },
      { title: "Escucha activa y técnicas de indagación", minutes: 50, detail: "Escucha, preguntas abiertas y cerradas, parafraseo y comprobación de entendimiento." },
      { title: "Asertividad, retroalimentación y conversaciones difíciles", minutes: 55, detail: "Comunicación respetuosa, retroalimentación conductual y manejo de diferencias." },
      { title: "Comunicación operacional y preventiva", minutes: 55, detail: "Coordinación de tareas, entrega de turno, instrucciones, mensajes críticos y confirmación de comunicaciones." },
      { title: "Taller aplicado y evaluación", minutes: 40, detail: "Juego de roles, análisis de situaciones laborales y evaluación final." },
    ],
  },
  {
    code: "PDTP-54",
    versionLabel: "01",
    // 120 minutos y presencial salen del certificado del 24/04/2026 —16:00 a
    // 18:00, en el taller, con relator y práctica—, no del descriptor streaming
    // del catálogo de Mutual, que declara la misma duración pero a distancia.
    durationMinutes: 120,
    modality: "presencial",
    assessmentType: "both",
    passingScore: 70,
    source: "Ficha Mutual de Seguridad CChC \"Manejo de Extintores\"; duración y modalidad tomadas del certificado del 24/04/2026 (2 horas, presencial en el taller de Cabrero, 15 participantes evaluados).",
    contentOutline: [
      { title: "Fundamentos del fuego y uso de extintores", minutes: 25, detail: `Qué es un extintor y definiciones básicas. Situaciones en que corresponde utilizarlo. Reconocimiento de la fase inicial del fuego. Clases de fuego y métodos de extinción. ${MUTUAL_MINUTES_NOTE}` },
      { title: "Tipos de extintores y agentes extintores", minutes: 30, detail: "Componentes generales. Forma de extinción de los distintos agentes. Polvo químico seco, dióxido de carbono, espuma y agua, acetato de potasio y polvos especiales. Selección del agente según la clase de fuego." },
      { title: "Uso correcto y seguro del extintor", minutes: 40, detail: "Importancia del uso correcto y seguro. Procedimiento paso a paso. Traslado y posicionamiento del equipo. Aplicación del agente sobre la base del fuego. Uso seguro según el agente disponible y el tipo de fuego." },
      { title: "Inspección y legislación asociada", minutes: 25, detail: "Procedimientos de inspección de extintores. Revisión general de las condiciones del equipo. Disponibilidad frente a una emergencia. Legislación asociada al uso y disposición." },
    ],
  },
  {
    code: "PDTP-58",
    versionLabel: "01",
    durationMinutes: 240,
    // `teorica` y no `elearning`: la modalidad describe la forma de la actividad
    // —expositiva— y no el canal por el que se transmite.
    modality: "teorica",
    assessmentType: "theoretical",
    passingScore: 70,
    source: "Ficha Mutual de Seguridad CChC \"Gestión del Riesgo de Desastres en Centros de Trabajo\", 4 horas; es el curso que acredita el diploma de la Coordinadora GRD del 26/12/2025.",
    contentOutline: [
      { title: "Marco normativo y conceptual", minutes: 60, detail: `Marco de Sendai 2015-2030. Referencia normativa nacional y aspectos legales de la gestión del riesgo. Conceptos de centro de trabajo, amenaza, vulnerabilidad, riesgo, mitigación y preparación. ${MUTUAL_MINUTES_NOTE}` },
      { title: "Diagnóstico de riesgos y recursos", minutes: 100, detail: "Qué es el COGRID y sus requisitos. Organización por centro de trabajo. Rol del Coordinador GRD, responsabilidades y programa de trabajo. Uso de la Matriz GRD. Análisis histórico. Identificación del riesgo de desastres, medidas de tratamiento y plan de reducción." },
      { title: "Planificación de la respuesta", minutes: 80, detail: "Alerta y alarma. Comunicación e información. Coordinaciones. Evaluación primaria, decisiones, evaluación secundaria y readecuación. Simulaciones y simulacros." },
    ],
  },
  {
    code: "PDTP-55",
    versionLabel: "01",
    durationMinutes: 480,
    modality: "presencial",
    assessmentType: "both",
    passingScore: 70,
    source: "Ficha OTEC Capacítame \"Técnicas de Primeros Auxilios\" (8 horas): https://capacita-me.cl/tpa8/",
    contentOutline: [
      { title: "Introducción a los primeros auxilios", minutes: 60, detail: `Conceptos y principios generales. Rol del auxiliador. Seguridad antes de intervenir. Evaluación inicial de una emergencia. ${OTEC_MINUTES_NOTE}` },
      { title: "Manejo en caso de emergencias", minutes: 180, detail: "Actuación frente a situaciones de emergencia. Evaluación del accidentado. Heridas y hemorragias. Quemaduras. Lesiones traumáticas. Fracturas, luxaciones y esguinces. Obstrucción de vía aérea." },
      { title: "Uso y manejo del DEA", minutes: 120, detail: "Conceptos básicos de reanimación. Cadena de supervivencia. Reanimación cardiopulmonar. Reconocimiento de un paro cardiorrespiratorio. Funcionamiento y utilización segura del desfibrilador externo automático." },
      { title: "Atención primaria del accidentado", minutes: 120, detail: "Evaluación primaria. Estado de conciencia. Respiración y circulación. Posición de seguridad. Activación de servicios de emergencia. Atención inicial mientras llega ayuda especializada." },
    ],
  },
  {
    code: "PDTP-56",
    versionLabel: "01",
    durationMinutes: 480,
    modality: "presencial",
    assessmentType: "both",
    passingScore: 70,
    source: "Ficha OTEC GoCursos \"Manejo a la Defensiva\" (8 horas): https://www.gocursos.cl/cursos/manejo_a_la_defensiva/",
    contentOutline: [
      { title: "Introducción al manejo defensivo", minutes: 60, detail: `Conceptos básicos. Importancia de la atención y concentración. Factores de riesgo durante la conducción. Evaluación del entorno vial. Observación y anticipación de peligros. ${OTEC_MINUTES_NOTE}` },
      { title: "Técnicas de conducción segura", minutes: 90, detail: "Distancia segura de seguimiento. Uso de espejos retrovisores. Maniobras de emergencia y evasión. Control del vehículo en condiciones adversas. Conducción según el tipo de vía." },
      { title: "Psicología del conductor", minutes: 70, detail: "Factores psicológicos asociados a la conducción. Emociones y estrés al volante. Fatiga. Alcohol y drogas. Toma de decisiones bajo presión." },
      { title: "Normativa vial y señalización", minutes: 70, detail: "Señales de tránsito. Normas de circulación. Señales preventivas y de advertencia. Prioridades y derechos de paso. Cumplimiento de la normativa de tránsito." },
      { title: "Factores ambientales", minutes: 70, detail: "Condiciones climáticas adversas. Cambios de iluminación. Adherencia y condiciones de la calzada. Conducción urbana y rural. Vías resbaladizas." },
      { title: "Mantenimiento preventivo del vehículo", minutes: 70, detail: "Importancia del mantenimiento. Revisión de neumáticos y frenos. Líquidos y sistemas del vehículo. Identificación de fallas. Revisiones periódicas." },
      { title: "Evaluación y mejora continua", minutes: 50, detail: "Autoevaluación de la conducción. Identificación de oportunidades de mejora. Incorporación de hábitos seguros. Actualización de conocimientos. Compromiso con una conducción preventiva." },
    ],
  },
  {
    code: "PDTP-59",
    versionLabel: "01",
    durationMinutes: 480,
    modality: "presencial",
    assessmentType: "both",
    passingScore: 70,
    source: "Ficha OTEC Capacítame \"Técnicas de Investigación de Accidentes / Árbol de Causa\" (8 horas): https://capacita-me.cl/arboldecausa/",
    contentOutline: [
      { title: "Fundamentos de la investigación de accidentes", minutes: 60, detail: `Conceptos de accidente e incidente. Objetivos de una investigación. Importancia de determinar las causas. Investigación orientada a la prevención y no a la búsqueda de culpables. ${OTEC_MINUTES_NOTE}` },
      { title: "Marco normativo", minutes: 60, detail: "Normativa chilena aplicable a accidentes del trabajo. Responsabilidades en la investigación. Registros y antecedentes necesarios." },
      { title: "Recolección de información mediante Árbol de Causas", minutes: 150, detail: "Levantamiento de antecedentes. Identificación de hechos. Entrevistas y recopilación de información. Diferenciación entre hechos comprobados y opiniones. Reconstrucción del accidente." },
      { title: "Construcción y análisis del Árbol de Causas", minutes: 210, detail: "Organización de los hechos. Relaciones lógicas entre antecedentes. Representación gráfica del accidente. Identificación de causas. Análisis del árbol. Determinación de medidas correctivas y preventivas." },
    ],
  },
  {
    code: "PDTP-60",
    versionLabel: "01",
    durationMinutes: 480,
    modality: "presencial",
    assessmentType: "both",
    passingScore: 70,
    // Temario propio, no una ficha de catálogo: la referencia OTEC que se
    // revisó declara 16 horas y el programa trabaja con 8. En vez de recortar
    // el curso ajeno, se orienta a la función preventiva del supervisor. La
    // comunicación queda como herramienta transversal; su desarrollo vive en
    // la N°57 y no se duplica acá.
    source: "Informe de cierre de datos faltantes, Servicios Chome, 12/09/2026: temario propio de 8 horas orientado a la función preventiva de supervisores y jefaturas.",
    contentOutline: [
      { title: "Rol preventivo de la línea de mando", minutes: 60, detail: "Responsabilidad del supervisor en seguridad y salud. Integración de la prevención en la operación. Conocimiento y uso de la matriz de riesgos. Ejemplo conductual y cumplimiento de controles." },
      { title: "Liderazgo situacional y cultura preventiva", minutes: 90, detail: "Estilos de liderazgo. Adaptación al nivel de autonomía del equipo. Liderazgo visible. Refuerzo de conductas seguras. Intervención frente a desviaciones." },
      { title: "Planificación, organización, delegación y control", minutes: 90, detail: "Planificación segura de tareas. Asignación clara de responsabilidades. Verificación previa. Seguimiento de controles. Coordinación entre áreas y turnos." },
      { title: "Motivación y trabajo en equipo", minutes: 90, detail: "Motivación aplicada al cumplimiento preventivo. Compromiso. Participación de las personas trabajadoras. Coordinación. Reconocimiento de buenas prácticas." },
      { title: "Toma de decisiones y resolución de problemas", minutes: 90, detail: "Priorización según riesgo. Detención o ajuste de tareas ante condiciones inseguras. Análisis de situaciones. Resolución de problemas y conflictos operativos." },
      { title: "Retroalimentación, seguimiento y mejora continua", minutes: 60, detail: "Retroalimentación breve y específica. Seguimiento de compromisos. Aprendizaje de incidentes y observaciones. Uso de indicadores. Plan personal de mejora del supervisor." },
    ],
  },
  {
    code: "PDTP-63",
    versionLabel: "01",
    durationMinutes: 120,
    modality: "practica",
    assessmentType: "both",
    passingScore: 70,
    source: "Dictamen técnico de Prevención sobre el programa de capacitación en uso y mantención de EPP que regula SUSESO, y el DS 594 art. 53.",
    contentOutline: [
      { title: "Función, selección y limitaciones del EPP", minutes: 20, detail: "Relación peligro–riesgo–EPP, función de protección, limitaciones y necesidad de utilizar el elemento definido para la exposición." },
      { title: "Componentes, compatibilidad y ajuste", minutes: 20, detail: "Partes del equipo, talla y ajuste, compatibilidad cuando se utilizan varios EPP simultáneamente." },
      { title: "Colocación, uso correcto y retiro", minutes: 30, detail: "Demostración y práctica de colocación, verificación de ajuste, uso durante la exposición y retiro seguro." },
      { title: "Mantención, limpieza y almacenamiento", minutes: 20, detail: "Cuidados del elemento, limpieza conforme a las instrucciones aplicables, conservación y almacenamiento." },
      { title: "Inspección, reposición, eliminación y evaluación", minutes: 30, detail: "Revisión previa o diaria, criterios de daño o deterioro, cuándo retirar de servicio, reposición, disposición según el tipo de elemento y evaluación teórico-práctica." },
    ],
  },
]

export type SeedOutcome =
  | { kind: "create" }
  /** Ya existe una versión con ese `versionLabel`. */
  | { kind: "already_done" }
  /** El curso no está en la base. */
  | { kind: "missing_course" }
  /** El curso ya tiene otra versión: decidir a mano es más seguro que adivinar. */
  | { kind: "has_other_versions"; labels: string[] }

/**
 * Qué hacer con una entrada. Pura y exportada: decidir sin base de datos es lo
 * que la hace testeable.
 */
export function decideOutcome(
  seed: CourseVersionSeed,
  course: { id: string } | undefined,
  existingLabels: readonly string[],
): SeedOutcome {
  if (!course) return { kind: "missing_course" }
  if (existingLabels.includes(seed.versionLabel)) return { kind: "already_done" }
  if (existingLabels.length > 0) return { kind: "has_other_versions", labels: [...existingLabels] }
  return { kind: "create" }
}

/**
 * Misma huella que calcula `createTrainingCourseVersion`: sha256 sobre temario,
 * duración y modalidad. Se replica en vez de importarla porque la función es
 * privada del servicio, y tiene que coincidir — el esquema exige 64 caracteres
 * y la huella es lo que después permite detectar que el contenido cambió.
 */
export function contentHashFor(seed: Pick<CourseVersionSeed, "contentOutline" | "durationMinutes" | "modality">): string {
  return createHash("sha256")
    .update(JSON.stringify({ outline: seed.contentOutline, duration: seed.durationMinutes, modality: seed.modality }))
    .digest("hex")
}

/** La suma del temario no puede exceder la duración total; el servicio lo exige. */
export function outlineMinutes(seed: CourseVersionSeed): number {
  return seed.contentOutline.reduce((total, item) => total + item.minutes, 0)
}

async function resolvePermissions(userId: string): Promise<string[]> {
  const fromRoles = await db.select({ name: permissionsTable.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId))

  const direct = await db.select({ name: permissionsTable.name })
    .from(userPermissions)
    .innerJoin(permissionsTable, eq(permissionsTable.id, userPermissions.permissionId))
    .where(eq(userPermissions.userId, userId))

  return [...new Set([...fromRoles, ...direct].map((row) => row.name))].sort()
}

async function resolveActor(): Promise<string> {
  const userId = process.env.SEED_VERSIONS_ACTOR_USER_ID?.trim()
  if (!userId) {
    throw new Error(
      "Falta SEED_VERSIONS_ACTOR_USER_ID. Queda como autor del contenido, y quien figure "
      + "como autor no podrá aprobarlo después: la segregación lo impide. Elegilo a conciencia.",
    )
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error(`El usuario ${userId} no existe.`)

  const permissions = await resolvePermissions(userId)
  if (!permissions.includes("prevention:training:manage")) {
    throw new Error(
      `El usuario ${userId} no tiene 'prevention:training:manage'. `
      + "El script no puede concederse un permiso que la persona no tiene.",
    )
  }
  return userId
}

async function main() {
  const actorUserId = await resolveActor()

  console.log(`Versiones de curso PDTP 2026 — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"} · autor=${actorUserId}`)
  console.log("")

  const courses = await db.select({
    id: preventionTrainingCourses.id,
    code: preventionTrainingCourses.code,
    name: preventionTrainingCourses.name,
  }).from(preventionTrainingCourses).where(or(
    ...PDTP_2026_COURSE_VERSIONS.map((seed) => eq(preventionTrainingCourses.code, seed.code)),
  ))
  const byCode = new Map(courses.map((row) => [row.code, row]))

  const versions = courses.length === 0 ? [] : await db.select({
    courseId: preventionTrainingCourseVersions.courseId,
    versionLabel: preventionTrainingCourseVersions.versionLabel,
  }).from(preventionTrainingCourseVersions)
  const labelsByCourseId = new Map<string, string[]>()
  for (const row of versions) {
    labelsByCourseId.set(row.courseId, [...(labelsByCourseId.get(row.courseId) ?? []), row.versionLabel])
  }

  let created = 0
  let skipped = 0
  const problems: string[] = []

  for (const seed of PDTP_2026_COURSE_VERSIONS) {
    const course = byCode.get(seed.code)
    const labels = course ? labelsByCourseId.get(course.id) ?? [] : []
    const outcome = decideOutcome(seed, course, labels)

    if (outcome.kind === "already_done") {
      console.log(`  · ${seed.code}: ya tiene la versión ${seed.versionLabel}, omitido.`)
      skipped++
      continue
    }
    if (outcome.kind === "missing_course") {
      const message = `${seed.code}: el curso no existe. ¿Corrió apply-pdtp-program-data?`
      console.log(`  ✗ ${message}`)
      problems.push(message)
      continue
    }
    if (outcome.kind === "has_other_versions") {
      const message = `${seed.code}: ya tiene versiones (${outcome.labels.join(", ")}). No se agrega otra sin decidirlo a mano.`
      console.log(`  ✗ ${message}`)
      problems.push(message)
      continue
    }

    const total = outlineMinutes(seed)
    if (DRY_RUN) {
      console.log(`  → ${seed.code} (${course!.name}): versión ${seed.versionLabel}, ${seed.contentOutline.length} módulos, ${total}/${seed.durationMinutes} min, ${seed.modality}, evaluación ${seed.assessmentType}.`)
      created++
      continue
    }

    const versionId = `trver-${nanoid()}`
    await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(preventionTrainingCourseVersions).values({
        id: versionId,
        courseId: course!.id,
        versionLabel: seed.versionLabel,
        status: "draft",
        contentOutline: seed.contentOutline,
        durationMinutes: seed.durationMinutes,
        modality: seed.modality,
        contentHash: contentHashFor(seed),
        assessmentType: seed.assessmentType,
        passingScore: seed.passingScore,
        authorUserId: actorUserId,
      }).returning()
      if (!inserted) throw new Error(`No se pudo crear la versión de ${seed.code}.`)

      await tx.insert(preventionTrainingHistory).values({
        id: `ptrh-${nanoid()}`,
        entityType: "course_version",
        entityId: versionId,
        changeType: "created",
        reason: `Versión ${seed.versionLabel} en borrador, cargada desde el temario documentado. Fuente: ${seed.source}`,
        afterState: inserted as unknown as Record<string, unknown>,
        actorUserId,
      })
    })
    console.log(`  ✓ ${seed.code} (${course!.name}): versión ${seed.versionLabel} en borrador, ${total} min en ${seed.contentOutline.length} módulos.`)
    created++
  }

  console.log("")
  console.log(`Resumen: ${created} ${DRY_RUN ? "por crear" : "creadas"}, ${skipped} sin cambios, ${problems.length} con problema.`)
  if (problems.length > 0) {
    console.log("")
    console.log("Revisa lo anterior antes de reintentar; el script no adivina qué quisiste.")
    process.exit(1)
  }
  console.log("Quedan en BORRADOR. Para publicarlas: revisión, aprobación y publicación desde")
  console.log("/prevencion/capacitacion, con alguien distinto de quien figura como autor.")
  console.log("Faltan por temario externo: N°55, N°56, N°59 y N°60.")
  process.exit(0)
}

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
