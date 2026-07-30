/**
 * Contrato de regresión del adaptador RE-36/SG-SST 2026.
 *
 * La Base 2026 definitiva elimina por completo los ocho objetivos y las
 * actividades 4 y 8. El libro físico conserva seis celdas E históricas, pero
 * el adaptador de base nunca las materializa como ejecuciones.
 *
 * No son límites del constructor general ni defaults obligatorios para nuevos
 * programas.
 */
export const PDTP_2026_SOURCE = {
  filename: "PROGRAMA_ACTIVIDADES_DEFINITIVO.xlsx",
  sha256: "8ad52fe16ba12a1514d6af2bb6601bb44627f4020bb95907b33e6a162ad46fd2",
  sizeBytes: 4_509_309,
} as const

/** Métricas normalizadas de la Base 2026 definitiva. */
export const PDTP_2026_SOURCE_INVARIANTS = {
  objectiveCount: 0,
  activityCount: 87,
  viewCount: 8,
  horizonWeeks: 48,
  plannedCellCount: 821,
  plannedQuantityTotal: 1_013,
  maxPlannedCellQuantity: 5,
  noNumericPlanCount: 22,
  executedQuantityTotal: 0,
} as const

/**
 * Actividades eliminadas de la base. Sus números no se reutilizan.
 */
export const PDTP_2026_REMOVED_ACTIVITIES = [4, 8] as const

/** Fuente física congelada de la primera revisión de Base 2026. */
export const PDTP_2026_PROGRAM_SOURCE = {
  ...PDTP_2026_SOURCE,
} as const

/** Métricas que deben firmar todas las revisiones iniciales de esta base. */
export const PDTP_2026_INVARIANTS = {
  objectiveCount: 0,
  activityCount: 87,
  viewCount: 8,
  horizonWeeks: 48,
  plannedCellCount: 821,
  plannedQuantityTotal: 1_013,
  maxPlannedCellQuantity: 5,
  noNumericPlanCount: 22,
  executedQuantityTotal: 0,
} as const

export const PDTP_2026_EXECUTED_CELLS = [
  { activityNumber: 1, month: 1, week: 4, quantity: 1, sourceCell: "L14" },
  { activityNumber: 2, month: 2, week: 1, quantity: 1, sourceCell: "N15" },
  { activityNumber: 6, month: 1, week: 1, quantity: 1, sourceCell: "F18" },
  { activityNumber: 6, month: 1, week: 2, quantity: 1, sourceCell: "H18" },
  { activityNumber: 6, month: 1, week: 3, quantity: 1, sourceCell: "J18" },
  { activityNumber: 6, month: 1, week: 4, quantity: 1, sourceCell: "L18" },
] as const

export const PDTP_2026_NO_NUMERIC_PLAN_ACTIVITY_IDS = [
  11, 12, 14, 15, 16, 18, 21, 52, 57, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
] as const

export const PDTP_2026_LONG_TEXT_ACTIVITY_IDS = [37, 38, 43, 51, 52] as const

export const PDTP_2026_VIEW_MEMBERSHIPS = {
  pdtp_general: Array.from({ length: 89 }, (_, index) => index + 1).filter((n) => n !== 4 && n !== 8),
  cphs: [11, 12, 13, 14],
  prf_adm_contrato: [
    1, 2, 3, 5, 6, 7, 9, 10, 13, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28,
    29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
    53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 75, 77, 78, 79,
    80, 81, 82, 83, 84, 85, 88, 89,
  ],
  sup_jt: [15, 24, 26, 29, 31, 34, 38, 39, 40, 52, 64, 66, 68, 69, 71, 73, 75, 76],
  prf: [3, 7, 10, 16, 17, 18, 19, 23, 24, 27, 30, 32, 33, 35, 36, 37, 44, 45, 46, 47, 48, 49, 50, 51, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 65, 67, 77, 85, 86, 88, 89],
  adm_contrato: [28, 72],
  subgerente: [5],
  capacitacion: [54, 55, 56, 57, 58, 59, 60, 85, 86, 87, 88, 89],
} as const

export const PDTP_2026_COLUMN_DICTIONARY = {
  PROGRAMA: {
    sourceColumn: "B",
    domainField: "activityDescription",
    meaning: "Trabajo preventivo que se debe realizar; es la descripción principal de la actividad.",
  },
  ACTIVIDAD: {
    sourceColumn: "C",
    domainField: "executionGuidance",
    meaning: "Orientación práctica o mecanismo con que se ejecutará el trabajo preventivo.",
  },
  RESPONSABLE: {
    sourceColumn: "D",
    domainField: "responsibleRoles",
    meaning: "Roles responsables declarados en el documento, pendientes de reconciliación con identidades Chome.",
  },
  P: {
    domainField: "plannedQuantity",
    meaning: "Cantidad planificada para el período semanal representado por la pareja P/E.",
  },
  E: {
    domainField: "executedQuantity",
    meaning: "Dato histórico conservado solo como evidencia de origen; la Base 2026 normalizada no lo importa.",
  },
} as const

export const PDTP_2026_ELEMENT_CLASSIFICATION = {
  domainConcepts: ["actividad preventiva", "responsables", "programación", "ejecución", "evidencia", "indicador", "aprobación", "control de cambios"],
  templateData: ["87 actividades", "roles declarados", "meta 90 %", "periodicidad mensual", "código RE-36"],
  derivedViews: ["PDTP GENERAL", "CPHS", "PRF y Administración de contrato", "Supervisión y Jefatura de turno", "PRF", "Administración de contrato", "Subgerencia", "Capacitación y campañas"],
  documentDecoration: ["logos", "colores", "anchos de columna", "celdas fusionadas", "bordes", "alturas de fila", "maquetación de firmas"],
} as const
