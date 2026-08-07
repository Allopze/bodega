import type { ChecklistDefinition } from '../types'
import { NUEVO_SECTIONS } from './trabajador-nuevo-sections'

/**
 * Checklist Definition — Trabajadores Nuevos
 * Extracted from: "Listas Chequeo Trabajadores Nuevos OK.docx"
 * Revisión 01 — 25/02/2026
 *
 * Conductores Camión Ampliroll, Batea y Operadores de Maquinaria Pesada
 */
export const TRABAJADOR_NUEVO: ChecklistDefinition = {
  code: 'trabajador_nuevo',
  version: '01',
  revisionDate: '2026-02-25',
  tipo: 'nuevo',
  title: 'Lista de Chequeo: Trabajador Nuevo',
  subtitle: 'Conductores Camión Ampliroll, Batea y Operadores de Maquinaria Pesada',
  legalFramework: ['DS N°44', 'DS N°594', 'ISO 45001'],
  applicableTo: 'Personal nuevo, reubicado o con cambio de función.',

  sections: NUEVO_SECTIONS,

  closingAct: {
    title: '4. Acta de Cierre: Habilitación Operacional',
    resultOptions: [
      { value: 'habilitado_autonomo', label: 'CUMPLE' },
      { value: 'no_habilitado', label: 'NO CUMPLE' },
    ],
    hasRestrictions: false,
    signatureRoles: ['supervisor', 'prevencionista'],
  },
}
