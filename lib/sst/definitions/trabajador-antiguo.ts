import type { ChecklistDefinition } from '../types'
import { ANTIGUO_SECTIONS } from './trabajador-antiguo-sections'

/**
 * Checklist Definition — Control de Seguimiento / Post-Incidente
 * Extracted from: "Lista Chequeo Control Seguimiento Trabajadores Antiguos Post Incidente.docx"
 * Revisión 01 — 05/06/2026
 *
 * Conductores Camión Sistema Ampliroll, Batea y Operadores de Maquinaria Pesada
 */
export const TRABAJADOR_ANTIGUO: ChecklistDefinition = {
  code: 'trabajador_antiguo',
  version: '01',
  revisionDate: '2026-06-05',
  tipo: 'seguimiento',
  title: 'Lista de Chequeo: Control de Seguimiento',
  subtitle: 'Conductores Camión Sistema Ampliroll, Batea y Operadores de Maquinaria Pesada',
  legalFramework: [
    'Ley N°16.744',
    'DS N°44/2024',
    'DS N°594',
    'Ley N°19.300 cuando exista daño ambiental',
    'ISO 45001:2018',
    'Referencia ISO 14001 cuando aplique al SGI',
  ],
  applicableTo:
    'Trabajadores antiguos, trabajadores reincidentes en desviaciones, trabajadores involucrados en incidentes con daño a personas, daño material, daño ambiental, cuasi accidente, incidente de alto potencial, cambio de procedimiento, reincorporación o reforzamiento operacional.',
  objective:
    'Verificar en terreno la eficacia de los procedimientos, capacitaciones y controles definidos para el cargo, confirmando que el trabajador mantiene conductas seguras y cumple los estándares operacionales aplicables.',
  frequencySuggested:
    'Post incidente: evaluación inicial, verificación a 7 días, 15 días y 30 días. Trabajador antiguo sin incidente: evaluación semestral o anual según criticidad, desempeño y matriz de riesgos.',
  evaluationCriteria:
    'Marcar Cumple, No cumple o N/A. Registrar evidencia objetiva. Resultado: Eficaz ≥90% de cumplimiento aplicable y sin desviaciones críticas; Parcialmente eficaz 70%-89%; No eficaz <70% o existencia de desviación crítica/reincidencia.',

  sections: ANTIGUO_SECTIONS,

  closingAct: {
    title: '10. Acta de Cierre del Seguimiento',
    resultOptions: [
      { value: 'habilitado_autonomo', label: 'HABILITADO PARA CONTINUAR OPERANDO EN FORMA AUTÓNOMA' },
      { value: 'habilitado_restricciones', label: 'HABILITADO CON RESTRICCIONES' },
      { value: 'requiere_reforzamiento', label: 'REQUIERE REFORZAMIENTO ADICIONAL' },
      { value: 'no_habilitado', label: 'NO HABILITADO TEMPORALMENTE PARA OPERAR' },
    ],
    hasRestrictions: true,
    signatureRoles: ['trabajador', 'supervisor', 'prevencionista', 'jefe_area'],
  },
}
