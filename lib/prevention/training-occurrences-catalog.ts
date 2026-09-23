export const PREDEFINED_TRAINING_CATALOG_YEAR = 2026 as const
export const PREDEFINED_TRAINING_CATALOG_VERSION = "programa-capacitacion-2026-v1" as const

export type TrainingCatalogItemType = "course" | "campaign"

export interface TrainingCatalogSchedule {
  slotKey: string
  month: number | null
  week: number | null
}

export interface PredefinedTrainingCatalogItem {
  code: string
  title: string
  itemType: TrainingCatalogItemType
  audience: string
  sourceRow: number
  schedule: readonly TrainingCatalogSchedule[]
  pdtpActivityNumbers: readonly number[]
  sortOrder: number
}

export interface TrainingOccurrenceSeedRow {
  id: string
  catalogCode: string
  worksiteId: string
  year: number
  slotKey: string
  scheduledMonth: number | null
  scheduledWeek: number | null
  status: "pending"
  version: 1
}

function schedule(...slots: TrainingCatalogSchedule[]): readonly TrainingCatalogSchedule[] {
  return slots
}

const monthWeek = (month: number, week: number): TrainingCatalogSchedule => ({
  slotKey: `m${String(month).padStart(2, "0")}-w${week}`,
  month,
  week,
})

const annual: TrainingCatalogSchedule = { slotKey: "annual", month: null, week: null }

/**
 * Cronograma completo del PDTP 2026: las 4 semanas de los 12 meses (48
 * celdas). Task 16 (2026-09-23) lo extrae porque N°53 (CAP-21) y las 5
 * réplicas de N°38 (CAP-22..26) comparten exactamente esta grilla — ver el
 * comentario junto a CAP-21 más abajo para el porqué de cada bloque.
 */
const allWeeksOfYear: readonly TrainingCatalogSchedule[] = schedule(
  monthWeek(1, 1), monthWeek(1, 2), monthWeek(1, 3), monthWeek(1, 4),
  monthWeek(2, 1), monthWeek(2, 2), monthWeek(2, 3), monthWeek(2, 4),
  monthWeek(3, 1), monthWeek(3, 2), monthWeek(3, 3), monthWeek(3, 4),
  monthWeek(4, 1), monthWeek(4, 2), monthWeek(4, 3), monthWeek(4, 4),
  monthWeek(5, 1), monthWeek(5, 2), monthWeek(5, 3), monthWeek(5, 4),
  monthWeek(6, 1), monthWeek(6, 2), monthWeek(6, 3), monthWeek(6, 4),
  monthWeek(7, 1), monthWeek(7, 2), monthWeek(7, 3), monthWeek(7, 4),
  monthWeek(8, 1), monthWeek(8, 2), monthWeek(8, 3), monthWeek(8, 4),
  monthWeek(9, 1), monthWeek(9, 2), monthWeek(9, 3), monthWeek(9, 4),
  monthWeek(10, 1), monthWeek(10, 2), monthWeek(10, 3), monthWeek(10, 4),
  monthWeek(11, 1), monthWeek(11, 2), monthWeek(11, 3), monthWeek(11, 4),
  monthWeek(12, 1), monthWeek(12, 2), monthWeek(12, 3), monthWeek(12, 4),
)

/**
 * Fuente controlada: Programa anual de Capacitaciones 2026.xlsx,
 * hoja "Cronograma Anual". No se ofrece alta libre en la aplicación: una
 * nueva versión anual debe ser revisada y agregada explícitamente aquí.
 */
export const PREDEFINED_TRAINING_CATALOG = [
  {
    code: "CAP-01",
    title: "Inducción DS 44, art. 15 y procedimiento de trabajo seguro",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 9,
    schedule: schedule(annual),
    pdtpActivityNumbers: [],
    sortOrder: 1,
  },
  {
    code: "CAP-02",
    title: "Uso y manejo de extintor portátil",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 10,
    schedule: schedule(monthWeek(9, 4), monthWeek(10, 4)),
    pdtpActivityNumbers: [54],
    sortOrder: 2,
  },
  {
    code: "CAP-03",
    title: "Uso, mantención y sustitución de EPP",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 11,
    schedule: schedule(
      monthWeek(2, 3),
      monthWeek(5, 2),
      monthWeek(8, 2),
      monthWeek(9, 2),
      monthWeek(12, 2),
    ),
    pdtpActivityNumbers: [63],
    sortOrder: 3,
  },
  {
    code: "CAP-04",
    title: "Conducción defensiva",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 12,
    schedule: schedule(
      monthWeek(2, 4),
      monthWeek(3, 4),
      monthWeek(4, 4),
      monthWeek(5, 4),
      monthWeek(6, 4),
      monthWeek(7, 4),
      monthWeek(8, 4),
      monthWeek(9, 4),
      monthWeek(10, 4),
      monthWeek(11, 4),
    ),
    pdtpActivityNumbers: [56],
    sortOrder: 4,
  },
  {
    code: "CAP-05",
    title: "Capacitación de límites de velocidad",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 13,
    schedule: schedule(monthWeek(3, 3)),
    pdtpActivityNumbers: [],
    sortOrder: 5,
  },
  {
    code: "CAP-06",
    title: "Capacitación y difusión de política integrada",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 14,
    schedule: schedule(monthWeek(4, 2)),
    pdtpActivityNumbers: [],
    sortOrder: 6,
  },
  {
    code: "CAP-07",
    title: "Primeros auxilios",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 15,
    schedule: schedule(monthWeek(5, 3), monthWeek(5, 4)),
    pdtpActivityNumbers: [55],
    sortOrder: 7,
  },
  {
    code: "CAP-08",
    title: "Control de riesgos para personas trabajadoras",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 16,
    schedule: schedule(monthWeek(4, 1)),
    pdtpActivityNumbers: [],
    sortOrder: 8,
  },
  {
    code: "CAP-09",
    title: "Prevención de riesgos en caídas en altura",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 17,
    schedule: schedule(monthWeek(6, 2)),
    pdtpActivityNumbers: [],
    sortOrder: 9,
  },
  {
    code: "CAP-10",
    title: "Riesgos de altas temperaturas y radiación solar",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 18,
    schedule: schedule(monthWeek(9, 2)),
    pdtpActivityNumbers: [],
    sortOrder: 10,
  },
  {
    code: "CAP-11",
    title: "Gestión del riesgo de desastres",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 19,
    schedule: schedule(monthWeek(2, 4), monthWeek(3, 1)),
    pdtpActivityNumbers: [58],
    sortOrder: 11,
  },
  {
    code: "CAP-12",
    title: "Matriz de identificación de peligros y evaluación de riesgos (MIPER)",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 20,
    schedule: schedule(monthWeek(5, 2), monthWeek(7, 2)),
    pdtpActivityNumbers: [],
    sortOrder: 12,
  },
  {
    code: "CAP-13",
    title: "Capacitación de violencia y acoso 21.643",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 21,
    schedule: schedule(monthWeek(8, 2)),
    pdtpActivityNumbers: [],
    sortOrder: 13,
  },
  {
    code: "CAP-14",
    title: "Sistema de gestión de seguridad y salud en el trabajo (SG-SST) y programa de gestión",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 22,
    schedule: schedule(monthWeek(10, 2)),
    pdtpActivityNumbers: [],
    sortOrder: 14,
  },
  {
    code: "CAM-01",
    title: "Programa de módulos saludables",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 24,
    // N°85 del PDTP 2026 es un solo programa de 4 repeticiones semanales, todas
    // en m02 (m02-w1..w4). Se reparten entre CAM-01/CAM-02/CAM-06 preservando
    // la proporción 1/2/1 que ya tenían entre sí (ver informe de Task 5): este
    // ítem es "Programa de módulos saludables", el que da nombre a la N°85, y
    // conserva su semana inicial.
    schedule: schedule(monthWeek(2, 1)),
    pdtpActivityNumbers: [85],
    sortOrder: 15,
  },
  {
    code: "CAM-02",
    title: "Promoción de la salud",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 25,
    // Ya tenía 2 repeticiones (la mayor cuota de las 3); conserva esa
    // proporción con las 2 semanas centrales de la N°85.
    schedule: schedule(monthWeek(2, 2), monthWeek(2, 3)),
    pdtpActivityNumbers: [85],
    sortOrder: 16,
  },
  {
    code: "CAM-03",
    title: "Manejo del estrés",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 26,
    schedule: schedule(
      monthWeek(3, 1),
      monthWeek(3, 2),
      monthWeek(3, 3),
      monthWeek(3, 4),
      monthWeek(4, 1),
    ),
    pdtpActivityNumbers: [86],
    sortOrder: 17,
  },
  {
    code: "CAM-04",
    title: "Ojo con los puntos ciegos de los camiones y equipos",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 27,
    schedule: schedule(
      monthWeek(10, 1),
      monthWeek(10, 2),
      monthWeek(10, 3),
      monthWeek(10, 4),
      monthWeek(11, 1),
      monthWeek(11, 2),
      monthWeek(11, 3),
      monthWeek(11, 4),
    ),
    pdtpActivityNumbers: [89],
    sortOrder: 18,
  },
  {
    code: "CAM-05",
    title: "Prevención de factores de riesgos asociados al consumo de alcohol y drogas en el lugar de trabajo",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 28,
    schedule: schedule(monthWeek(8, 1), monthWeek(8, 2), monthWeek(8, 3), monthWeek(8, 4)),
    pdtpActivityNumbers: [87],
    sortOrder: 19,
  },
  {
    code: "CAM-06",
    title: "Promoción de vida sana y prevención de enfermedades crónicas",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 29,
    schedule: schedule(monthWeek(2, 4)),
    pdtpActivityNumbers: [85],
    sortOrder: 20,
  },
  /**
   * Task 8 (2026-09-22): las N°16, 37, 51, 57, 59 y 60 del PDTP 2026 quedaron
   * sin ningún instrumento vivo que las acredite desde que la migración 0310
   * borró el modelo de cursos por persona (`onTrainingSessionClosed` ya no
   * tiene llamadores). Las N°38 y N°53 quedan fuera a propósito: son charlas
   * de alta frecuencia (48 celdas/año) y la N°38 exige cantidad 5 por celda,
   * algo que el modelo de ocurrencia binaria de este catálogo no puede
   * representar sin subestimar el cumplimiento — decisión pendiente para
   * Prevención (`mechanism: 'constancia'`), fuera del alcance de esta tarea.
   *
   * `sourceRow` 30-35: estos 6 ítems no existían en "Programa anual de
   * Capacitaciones 2026.xlsx" (hoja "Cronograma Anual") — se agregan acá para
   * cerrar una brecha detectada desde el PDTP, no desde esa planilla. Se
   * continúa la numeración secuencial del archivo (el máximo usado era 29)
   * como marcador de que son altas nuevas sin fila de origen real en esa
   * hoja; no reutilizan ninguna fila de un curso existente.
   */
  {
    code: "CAP-15",
    title: "Realizar Prueba de evaluación capacitación IRL",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 30,
    /**
     * N°16 es `on_demand` en el PDTP: "Todo trabajador nuevo debe realizar la
     * evaluación", sin celdas de mes/semana en el cronograma maestro
     * (`db/seed/pdtp-catalog-2026.json`, `schedule: []`). Un `schedule()`
     * vacío aquí no generaría ninguna fila en `preventionTrainingOccurrences`
     * (`occurrenceSeedRows` mapea sobre `item.schedule`): el ítem existiría en
     * el catálogo pero no aparecería jamás en `/prevencion/capacitacion`, no
     * habría nada que un operador pudiera marcar hecho, y el barrido de
     * `occurrence-gap-connector.ts` no tendría ninguna ocurrencia que vencer
     * — exactamente el defecto ("sin instrumento vivo") que esta tarea
     * corrige, sólo que disimulado en vez de resuelto.
     *
     * Se usa el centinela `annual` — la misma representación que CAP-01 ya
     * usa para "sin cronograma específico, una vez al año por faena"—: una
     * ocurrencia por faena y año, sin mes/semana, que un operador puede
     * marcar hecha en cualquier momento y que `isOverdue`/`isDemandedByProgram`
     * (`occurrence-gap-connector.ts`) tratan como vencida recién al terminar
     * el año si nadie la marca.
     */
    schedule: schedule(annual),
    pdtpActivityNumbers: [16],
    sortOrder: 21,
  },
  {
    code: "CAP-16",
    title: "Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espacio de diálogo entre la jefatura y el personal, que también permiten reforzar de manera permanente el concepto de seguridad en las personas.(Consulta y participación)",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 31,
    schedule: schedule(
      monthWeek(1, 2), monthWeek(1, 4),
      monthWeek(2, 2), monthWeek(2, 4),
      monthWeek(3, 2), monthWeek(3, 4),
      monthWeek(4, 2), monthWeek(4, 4),
      monthWeek(5, 2), monthWeek(5, 4),
      monthWeek(6, 2), monthWeek(6, 4),
      monthWeek(7, 2), monthWeek(7, 4),
      monthWeek(8, 2), monthWeek(8, 4),
      monthWeek(9, 2), monthWeek(9, 4),
      monthWeek(10, 2), monthWeek(10, 4),
      monthWeek(11, 2), monthWeek(11, 4),
      monthWeek(12, 2), monthWeek(12, 4),
    ),
    pdtpActivityNumbers: [37],
    sortOrder: 22,
  },
  {
    code: "CAP-17",
    title: "Capacitaciòn del personal, estas en función de la evaluación de necesidades de capacitación . En base a: (miper, psicosocial (Protocolos minsal), accidentes e incidentes, procedimienos de trabajo y de acuerdo al cargo)",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 32,
    schedule: schedule(
      monthWeek(1, 4),
      monthWeek(2, 2),
      monthWeek(3, 2),
      monthWeek(4, 2),
      monthWeek(5, 2),
      monthWeek(6, 2),
      monthWeek(7, 2),
      monthWeek(8, 2),
      monthWeek(9, 2),
      monthWeek(10, 2),
      monthWeek(11, 2),
      monthWeek(12, 2),
    ),
    pdtpActivityNumbers: [51],
    sortOrder: 23,
  },
  {
    code: "CAP-18",
    title: "Capacitación investigación accidente árbol causal.",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 33,
    schedule: schedule(monthWeek(3, 3), monthWeek(3, 4)),
    pdtpActivityNumbers: [59],
    sortOrder: 24,
  },
  {
    code: "CAP-19",
    title: "Liderazgo para Linea de Mando",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 34,
    schedule: schedule(monthWeek(6, 2), monthWeek(6, 3)),
    pdtpActivityNumbers: [60],
    sortOrder: 25,
  },
  {
    code: "CAP-20",
    title: "Comunicación Efectiva",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 35,
    // Mismo tratamiento y mismo motivo que CAP-15 (N°16): on_demand sin
    // celdas en el PDTP — ver el comentario extenso de CAP-15.
    schedule: schedule(annual),
    pdtpActivityNumbers: [57],
    sortOrder: 26,
  },
  /**
   * Task 13 (2026-09-23): la N°88 (Seguridad vial) es una de las 5 campañas
   * del programa anual (N°85-89). A diferencia de las otras 4 — ya cubiertas
   * por CAM-01/02/03/04/05/06 —, sólo se podía acreditar desde
   * `/prevencion/campanas`, la ruta histórica de campañas que ya no está en
   * la navegación (ver el comentario en `modules/prevention/manifest.ts`)
   * pero que hasta esta tarea seguía aceptando campañas nuevas: dos caminos
   * vivos para la misma actividad, con el riesgo de doble conteo que la
   * auditoría dejó abierto en la práctica, no sólo en la navegación. CAM-07
   * cierra ese hueco y, junto con el cambio en
   * `app/(app)/prevencion/campanas` que retira la alta de campañas nuevas,
   * deja a las CAM-* de este catálogo como la única vía viva para acreditar
   * 85-89.
   *
   * `sourceRow: 36` no viene de "Programa anual de Capacitaciones 2026.xlsx"
   * — mismo criterio que CAP-15..CAP-20 (Task 8): continúa la numeración
   * secuencial del archivo (el máximo usado era 35) como marcador de alta
   * nueva sin fila de origen real en esa hoja.
   */
  {
    code: "CAM-07",
    title: "Seguridad vial",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 36,
    schedule: schedule(
      monthWeek(6, 1),
      monthWeek(6, 2),
      monthWeek(6, 3),
      monthWeek(6, 4),
      monthWeek(7, 1),
      monthWeek(7, 2),
      monthWeek(7, 3),
      monthWeek(7, 4),
    ),
    pdtpActivityNumbers: [88],
    sortOrder: 27,
  },
  /**
   * Task 16 (2026-09-23): la N°38 y la N°53 quedaron fuera de Task 8 porque
   * ambas tienen 48 celdas/año (semanas 1-4 de los 12 meses) — ver
   * `db/seed/pdtp-catalog-2026.json`, `activities` con `n: 38` / `n: 53`. La
   * N°53 (`plannedQuantity: 1` en cada celda) encaja sin fricción en el
   * modelo de ocurrencia binaria de este catálogo, igual que CAP-16 (N°37):
   * no necesita ningún tratamiento especial, sólo el ítem que faltaba.
   *
   * `sourceRow: 37` continúa la numeración secuencial de altas sin fila real
   * en "Programa anual de Capacitaciones 2026.xlsx" que ya usan CAP-15..20
   * (Task 8, filas 30-35) y CAM-07 (Task 13, fila 36): el máximo usado era 36.
   */
  {
    code: "CAP-21",
    title: "Charla diaria de seguridad y salud en el trabajo",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 37,
    schedule: allWeeksOfYear,
    pdtpActivityNumbers: [53],
    sortOrder: 28,
  },
  /**
   * Task 16 (2026-09-23): la N°38 exige `plannedQuantity: 5` en cada una de
   * sus 48 celdas (`db/seed/pdtp-catalog-2026.json`, `n: 38`) — el modelo de
   * ocurrencia de este catálogo es binario (una fila = un hecho por
   * `slotKey`), así que una sola fila por celda subestimaría el cumplimiento:
   * nunca se podría distinguir "0 de 5 hechas" de "4 de 5 hechas". Decisión
   * explícita del usuario/negocio: modelar la N°38 como 5 ítems idénticos del
   * catálogo (no como una fila con cantidad exigida) — el mismo patrón de
   * "varios ítems acreditando la misma actividad" que ya usa la N°85
   * (CAM-01/CAM-02/CAM-06, Task 5). La diferencia es que ahí los ítems SE
   * REPARTEN las semanas entre sí (sin repetirse) y acá los 5 comparten
   * exactamente el mismo cronograma completo: cada uno representa una de las
   * 5 charlas que deben ocurrir en la MISMA celda, no una celda distinta cada
   * uno. `pdtpActivityNumbers` ya soporta muchos-a-uno (ver la N°85), así que
   * cualquiera de los 5 acredita la misma actividad PDTP sin tocar
   * `compliance.ts` ni el motor de conteo compartido.
   *
   * El título de cada ítem repite el texto real del catálogo
   * (`activities[n=38].activity`, idéntico —por dato de origen— al de CAP-16/
   * N°37) y agrega un sufijo "(charla N de 5)": sin él, un operador vería 5
   * filas con el mismo texto exacto en `/prevencion/capacitacion` y no podría
   * saber cuál de las 5 charlas del día ya marcó hecha.
   *
   * `sourceRow` 38-42: continúa la numeración secuencial tras el 37 de
   * CAP-21 (mismo criterio: no hay fila real de origen en "Programa anual de
   * Capacitaciones 2026.xlsx" para estas altas).
   */
  {
    code: "CAP-22",
    title: "Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espacio de diálogo entre la jefatura y el personal, que también permiten reforzar de manera permanente el concepto de seguridad en las personas.(Consulta y participación) (charla 1 de 5)",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 38,
    schedule: allWeeksOfYear,
    pdtpActivityNumbers: [38],
    sortOrder: 29,
  },
  {
    code: "CAP-23",
    title: "Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espacio de diálogo entre la jefatura y el personal, que también permiten reforzar de manera permanente el concepto de seguridad en las personas.(Consulta y participación) (charla 2 de 5)",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 39,
    schedule: allWeeksOfYear,
    pdtpActivityNumbers: [38],
    sortOrder: 30,
  },
  {
    code: "CAP-24",
    title: "Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espacio de diálogo entre la jefatura y el personal, que también permiten reforzar de manera permanente el concepto de seguridad en las personas.(Consulta y participación) (charla 3 de 5)",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 40,
    schedule: allWeeksOfYear,
    pdtpActivityNumbers: [38],
    sortOrder: 31,
  },
  {
    code: "CAP-25",
    title: "Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espacio de diálogo entre la jefatura y el personal, que también permiten reforzar de manera permanente el concepto de seguridad en las personas.(Consulta y participación) (charla 4 de 5)",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 41,
    schedule: allWeeksOfYear,
    pdtpActivityNumbers: [38],
    sortOrder: 32,
  },
  {
    code: "CAP-26",
    title: "Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espacio de diálogo entre la jefatura y el personal, que también permiten reforzar de manera permanente el concepto de seguridad en las personas.(Consulta y participación) (charla 5 de 5)",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 42,
    schedule: allWeeksOfYear,
    pdtpActivityNumbers: [38],
    sortOrder: 33,
  },
] satisfies readonly PredefinedTrainingCatalogItem[]

export function trainingCatalogItemId(year: number, code: string): string {
  return `training-catalog-${year}-${code.toLowerCase()}`
}

/**
 * El flujo operativo sólo expone el programa que fue revisado y cargado. La
 * función centraliza la normalización para que una URL manipulada no termine
 * creando ocurrencias de un año que en realidad apuntan al catálogo 2026.
 */
export function resolvePredefinedTrainingCatalogYear(_value: unknown): typeof PREDEFINED_TRAINING_CATALOG_YEAR {
  return PREDEFINED_TRAINING_CATALOG_YEAR
}

export function isPredefinedTrainingCatalogYear(value: unknown): value is typeof PREDEFINED_TRAINING_CATALOG_YEAR {
  return value === PREDEFINED_TRAINING_CATALOG_YEAR
}

export function assertPredefinedTrainingCatalogYear(year: number): asserts year is typeof PREDEFINED_TRAINING_CATALOG_YEAR {
  if (!isPredefinedTrainingCatalogYear(year)) {
    throw new Error(`No existe un catálogo de capacitación operativo para el año ${year}.`)
  }
}

export function occurrenceSeedRows(
  item: PredefinedTrainingCatalogItem,
  worksiteId: string,
  year: number,
): TrainingOccurrenceSeedRow[] {
  assertPredefinedTrainingCatalogYear(year)
  return item.schedule.map((slot) => ({
    id: `training-occurrence-${year}-${worksiteId}-${item.code.toLowerCase()}-${slot.slotKey}`,
    catalogCode: item.code,
    worksiteId,
    year,
    slotKey: slot.slotKey,
    scheduledMonth: slot.month,
    scheduledWeek: slot.week,
    status: "pending",
    version: 1,
  }))
}
