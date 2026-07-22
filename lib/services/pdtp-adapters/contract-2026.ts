/**
 * Contrato de regresión del adaptador RE-36/SG-SST 2026.
 *
 * Estos valores describen el archivo fuente recibido. No son límites del
 * constructor general ni defaults obligatorios para nuevos programas.
 */
export const PDTP_2026_SOURCE = {
  filename: "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx",
  sha256: "a6adc0fa017a9972dde09e5abdddb399cfce23526332807a122e52bfd15690a4",
  sizeBytes: 4_513_110,
} as const

export const PDTP_2026_INVARIANTS = {
  objectiveCount: 8,
  activityCount: 89,
  viewCount: 8,
  horizonWeeks: 48,
  plannedCellCount: 843,
  plannedQuantityTotal: 1_035,
  maxPlannedCellQuantity: 5,
  noNumericPlanCount: 22,
  executedQuantityTotal: 6,
} as const

export const PDTP_2026_EXECUTED_CELLS = [
  { activityNumber: 1, month: 1, week: 4, quantity: 1, sourceCell: "M14" },
  { activityNumber: 2, month: 2, week: 1, quantity: 1, sourceCell: "O15" },
  { activityNumber: 6, month: 1, week: 1, quantity: 1, sourceCell: "G19" },
  { activityNumber: 6, month: 1, week: 2, quantity: 1, sourceCell: "I19" },
  { activityNumber: 6, month: 1, week: 3, quantity: 1, sourceCell: "K19" },
  { activityNumber: 6, month: 1, week: 4, quantity: 1, sourceCell: "M19" },
] as const

export const PDTP_2026_NO_NUMERIC_PLAN_ACTIVITY_IDS = [
  11, 12, 14, 15, 16, 18, 21, 52, 57, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
] as const

export const PDTP_2026_LONG_TEXT_ACTIVITY_IDS = [37, 38, 43, 51, 52] as const

export const PDTP_2026_VIEW_MEMBERSHIPS = {
  pdtp_general: Array.from({ length: 89 }, (_, index) => index + 1),
  cphs: [11, 12, 13, 14],
  prf_adm_contrato: [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28,
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
    sourceColumn: "C",
    domainField: "activityDescription",
    meaning: "Trabajo preventivo que se debe realizar; es la descripción principal de la actividad.",
  },
  ACTIVIDAD: {
    sourceColumn: "D",
    domainField: "executionGuidance",
    meaning: "Orientación práctica o mecanismo con que se ejecutará el trabajo preventivo.",
  },
  RESPONSABLE: {
    sourceColumn: "E",
    domainField: "responsibleRoles",
    meaning: "Roles responsables declarados en el documento, pendientes de reconciliación con identidades Chome.",
  },
  P: {
    domainField: "plannedQuantity",
    meaning: "Cantidad planificada para el período semanal representado por la pareja P/E.",
  },
  E: {
    domainField: "executedQuantity",
    meaning: "Cantidad ejecutada histórica; requiere mapeo explícito a una faena autorizada antes de aplicar.",
  },
} as const

export const PDTP_2026_ELEMENT_CLASSIFICATION = {
  domainConcepts: ["objetivo", "actividad preventiva", "responsables", "programación", "ejecución", "evidencia", "indicador", "aprobación", "control de cambios"],
  templateData: ["89 actividades", "8 objetivos", "roles declarados", "meta 90 %", "periodicidad mensual", "código RE-36"],
  derivedViews: ["PDTP GENERAL", "CPHS", "PRF y Administración de contrato", "Supervisión y Jefatura de turno", "PRF", "Administración de contrato", "Subgerencia", "Capacitación y campañas"],
  documentDecoration: ["logos", "colores", "anchos de columna", "celdas fusionadas", "bordes", "alturas de fila", "maquetación de firmas"],
} as const

