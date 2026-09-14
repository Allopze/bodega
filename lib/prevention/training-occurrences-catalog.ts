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
    schedule: schedule(monthWeek(3, 2), monthWeek(4, 3)),
    pdtpActivityNumbers: [54],
    sortOrder: 2,
  },
  {
    code: "CAP-03",
    title: "Uso, mantención y sustitución de EPP",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 11,
    schedule: schedule(monthWeek(2, 1), monthWeek(3, 3)),
    pdtpActivityNumbers: [63],
    sortOrder: 3,
  },
  {
    code: "CAP-04",
    title: "Conducción defensiva",
    itemType: "course",
    audience: "Dirigido a todo el personal.",
    sourceRow: 12,
    schedule: schedule(monthWeek(1, 4)),
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
    schedule: schedule(monthWeek(5, 2)),
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
    schedule: schedule(monthWeek(3, 4)),
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
    schedule: schedule(monthWeek(3, 2)),
    pdtpActivityNumbers: [85],
    sortOrder: 15,
  },
  {
    code: "CAM-02",
    title: "Promoción de la salud",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 25,
    schedule: schedule(monthWeek(1, 1), monthWeek(4, 2)),
    pdtpActivityNumbers: [85],
    sortOrder: 16,
  },
  {
    code: "CAM-03",
    title: "Manejo del estrés",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 26,
    schedule: schedule(monthWeek(5, 1)),
    pdtpActivityNumbers: [86],
    sortOrder: 17,
  },
  {
    code: "CAM-04",
    title: "Ojo con los puntos ciegos de los camiones y equipos",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 27,
    schedule: schedule(monthWeek(11, 2)),
    pdtpActivityNumbers: [89],
    sortOrder: 18,
  },
  {
    code: "CAM-05",
    title: "Prevención de factores de riesgos asociados al consumo de alcohol y drogas en el lugar de trabajo",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 28,
    schedule: schedule(annual),
    pdtpActivityNumbers: [87],
    sortOrder: 19,
  },
  {
    code: "CAM-06",
    title: "Promoción de vida sana y prevención de enfermedades crónicas",
    itemType: "campaign",
    audience: "Dirigido a todo el personal.",
    sourceRow: 29,
    schedule: schedule(monthWeek(10, 2)),
    pdtpActivityNumbers: [85],
    sortOrder: 20,
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
