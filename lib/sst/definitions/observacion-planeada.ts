import type { ChecklistDefinition } from '../types'
import { OBSERVACION_PLANEADA_SECTIONS } from './observacion-planeada-sections'
import { NORMALIZED_ONLY_SCORING } from '../scoring-policies'

/**
 * Observación Planeada — módulo 14 (Anexo 7, Rev. 01).
 *
 * v03 reemplaza la plantilla genérica provisional de la v01. Aquella se
 * redactó a ciegas —el Anexo 7 no estaba en `docx revisado/`— e inventó 17
 * ítems Cumple/No cumple/N/A repartidos en tres secciones de cumplimiento.
 * El formulario real no tiene ninguno: es un relato libre firmado por
 * observador y trabajador, más una tabla de acciones preventivas. Ver el
 * desglose campo por campo en `observacion-planeada-sections.ts`.
 *
 * La v01 nunca llegó a instalarse en ninguna actividad (la n=41 quedó con
 * OBSERVACION_MAQUINARIA), así que no hay instancias llenadas que migrar.
 *
 * Patrón B (single-sujeto): una instancia por faena/período.
 *
 * Actividad PDTP 2026: n=39, "Realizar Observación para corregir desviaciones
 * de conductas incorrectas sobre normas, procedimientos y/o estándares"
 * (Sup, JT — mensual, semana 2; "cada jefe directo en las distintas áreas de
 * trabajo"). Ver `lib/services/pdtp-adapters/inspection-templates-2026.ts`.
 *
 * No puntúa: sin ítems de estado, `porcentajeCumplimiento` queda en null. La
 * regla de puntaje cumple=1 / regular=0.5 / no cumple=0 no aplica aquí.
 */
export const OBSERVACION_PLANEADA: ChecklistDefinition = {
  code: 'observacion_planeada',
  version: '03',
  revisionDate: '2026-08-30',
  tipo: 'seguimiento',
  title: 'Observación Planeada',
  subtitle:
    'Anexo 7 (Rev. 01). Relato libre de una conducta observada en terreno; las acciones preventivas se levantan en el plan de acción de la ejecución.',
  legalFramework: [
    'Ley 16.744',
    'Ley 21.512 (ex DS 594)',
    'DS 40',
  ],
  applicableTo:
    'Jefe directo del área (supervisor / jefe de terreno) sobre la persona trabajadora observada.',
  objective:
    'Observar y registrar procedimientos, métodos o tareas que ameriten un cambio o una felicitación, corrigiendo desviaciones de conductas respecto de normas, procedimientos y estándares.',
  frequencySuggested: 'Mensual, por área y jefe directo.',
  evaluationCriteria:
    'El formulario no puntúa: es un registro narrativo. Cada acción preventiva acordada se levanta como acción del plan de acción PDTP, con responsable y fecha de control.',
  sections: OBSERVACION_PLANEADA_SECTIONS,
  scoringPolicy: NORMALIZED_ONLY_SCORING,
  recordsPreventiveActions: true,
  closingAct: {
    title: 'Cierre de la observación',
    resultOptions: [
      { value: 'felicitacion', label: 'Felicitación (conducta destacada)' },
      { value: 'requiere_cambio', label: 'Requiere cambio (se acuerdan acciones preventivas)' },
    ],
    hasRestrictions: false,
    // Anexo 7: "Nombre y Firma Observador" + "Nombre y Firma trabajador".
    // `jefe_area` = "Supervisor de faena/Jefe de terreno" en SIGNATURE_ROLE_LABELS,
    // que es el "jefe directo" que la actividad n=39 designa como observador.
    signatureRoles: ['jefe_area', 'trabajador'],
  },
}
