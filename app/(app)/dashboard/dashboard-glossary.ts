/**
 * Nombre completo de las siglas del tablero (A6: una abreviatura de dominio
 * lleva su nombre completo en un `title`/`glossary`, o se renombra).
 *
 * Un solo lugar para que "PDTP" no se explique de tres maneras distintas en
 * tres pantallas. Los tiles lo pasan a `KpiCard.glossary`; los textos sueltos,
 * a un `<abbr title>`.
 */
export const DASHBOARD_GLOSSARY = {
  PDTP: "PDTP: Programa de Trabajo Preventivo del año, con su avance acreditado frente a lo planificado.",
  CAPA: "CAPA: acciones correctivas y preventivas que nacen de incidentes, hallazgos y auditorías.",
  MIPER: "MIPER: matriz de identificación de peligros y evaluación de riesgos.",
  PPA: "PPA: Para, Piensa y Actúa. Detención de una tarea ante una condición insegura.",
  TAE: "TAE: tarjeta Copec de abastecimiento. Su registro de litros se concilia contra lo facturado.",
  NC: "NC: nota de crédito emitida por el proveedor de combustible y todavía no aplicada.",
  pp: "pp: puntos porcentuales de diferencia frente al avance esperado.",
  S: "S: semana del año en curso.",
} as const
