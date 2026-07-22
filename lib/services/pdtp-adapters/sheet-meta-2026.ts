/**
 * Vocabulario fijo de la plantilla de referencia 2026: sus ocho hojas, los
 * nombres de hoja para exportación XLSX y la traducción de abreviaturas de
 * rol del archivo (`jdpr`, `prf`, `sup`…) a roles RBAC. Describe el caso 2026,
 * no el modelo general — el constructor y las vistas de un programa cualquiera
 * leen `pdtpSheets` (label/area/defaultScopeRoles por fila), no este archivo.
 */
import type { PdtpSheetCode } from "@/lib/services/prevention-pdtp-catalog"

export const SHEET_META: Record<PdtpSheetCode, { label: string; area: string; defaultScopeRoles: string[] }> = {
  pdtp_general: { label: "Programa preventivo general", area: "prevencion", defaultScopeRoles: ["prevencionista", "administrador"] },
  cphs: { label: "Comité Paritario de Higiene y Seguridad", area: "prevencion", defaultScopeRoles: ["cphs", "prevencionista", "admin_contrato"] },
  prf_adm_contrato: { label: "Prevencionista de faena y administración de contrato", area: "prevencion", defaultScopeRoles: ["prevencionista_faena", "admin_contrato"] },
  sup_jt: { label: "Supervisión y jefatura de terreno", area: "prevencion", defaultScopeRoles: ["jefe_terreno"] },
  prf: { label: "Prevencionista de riesgos en faena", area: "prevencion", defaultScopeRoles: ["prevencionista_faena"] },
  adm_contrato: { label: "Administración de contrato", area: "prevencion", defaultScopeRoles: ["admin_contrato"] },
  subgerente: { label: "Subgerencia de operaciones y mantenimiento", area: "subgerencia", defaultScopeRoles: ["jefa_chome"] },
  capacitacion: { label: "Capacitación y campañas", area: "capacitacion", defaultScopeRoles: ["prevencionista_faena"] },
}

export const SHEET_EXPORT_NAMES: Record<PdtpSheetCode, string> = {
  pdtp_general: "Programa preventivo",
  cphs: "Comité Paritario Higiene SST",
  prf_adm_contrato: "Prevención y contrato",
  sup_jt: "Supervisión y terreno",
  prf: "Prevención faena",
  adm_contrato: "Administración contrato",
  subgerente: "Subgerencia operaciones",
  capacitacion: "Capacitación y campañas",
}

export const ROLE_RESPONSIBLE_SLUGS = new Map<string, string>([
  ["admin_contrato", "admin_contrato"],
  ["cphs", "cphs"],
  ["gerente_legal_rrhh", "jefa_chome"],
  ["jdpr", "prevencionista"],
  ["jm", "jefe_mantencion"],
  ["jt", "jefe_terreno"],
  ["prf", "prevencionista_faena"],
  ["subgerente_operaciones", "jefa_chome"],
  ["sup", "jefe_terreno"],
])
