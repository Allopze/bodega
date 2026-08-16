import type { ChecklistDefinition } from '../types'
import { AUDITORIA_SGSST_SECTIONS } from './auditoria-sgsst-sections'

/**
 * Auditoría interna del Sistema de Gestión de Seguridad y Salud en el Trabajo.
 *
 * Cierra la brecha B-01 de `BRECHAS_COBERTURA_PREVENCION_2026-08-15.md`: el
 * DS 44 art. 22 n°4 exige "la evaluación o auditoría periódica del desempeño
 * del Sistema de Gestión", y no había forma de registrarla.
 *
 * No requiere motor propio. Se importa como plantilla del motor de
 * inspecciones con `kind: 'audit'` —valor que `importInspectionTemplate` ya
 * acepta— y hereda gratis todo el ciclo: aprobación con segregación
 * autor≠aprobador, programación anual, corrida con evidencia, hallazgos con
 * criticidad derivada de `danoPotencial`, CAPA automática y revisión que exige
 * ejecutante≠revisor con toda criticidad alta enganchada.
 *
 * Patrón B (single-sujeto): una instancia por faena y período.
 *
 * ⚠️ Contenido normativo, no código. Antes de sembrarlo en producción debe
 * revisarlo un prevencionista: los ítems son la interpretación operativa de
 * los cinco elementos del art. 22 y las cláusulas de ISO 45001, y de esa
 * lectura depende qué se declara conforme ante un fiscalizador.
 */
export const AUDITORIA_SGSST: ChecklistDefinition = {
  code: 'auditoria_sgsst',
  version: '01',
  revisionDate: '2026-08-15',
  tipo: 'seguimiento',
  title: 'Auditoría interna del Sistema de Gestión de SST',
  subtitle: 'Evaluación periódica del desempeño del Sistema de Gestión, exigida por el DS 44 art. 22 n°4.',
  legalFramework: [
    'Ley 16.744',
    'DS 44/2024 art. 14 (evaluación del programa)',
    'DS 44/2024 art. 22 n°4 y n°5 (auditoría del sistema y mejora continua)',
    'ISO 45001:2018 §9.2 (auditoría interna)',
    'ISO 45001:2018 §9.3 (revisión por la dirección)',
  ],
  applicableTo:
    'Auditor interno o experto en prevención distinto de quien ejecuta la gestión auditada. Aplicable a cada faena con Sistema de Gestión exigible.',
  objective:
    'Verificar que los cinco elementos del Sistema de Gestión que exige el DS 44 art. 22 están implementados, vigentes y son eficaces, levantando hallazgos con acción correctiva y responsable.',
  frequencySuggested: 'Anual, o antes ante cambio mayor de proceso, dotación o siniestro grave.',
  evaluationCriteria:
    'Cada ítem se evalúa Cumple / No cumple / N/A. El cumplimiento parcial se registra como No cumple con el detalle en la observación, siguiendo la normalización del resto de los anexos. El N/A exige justificación: se usa cuando el elemento no es exigible por dotación (Departamento de Prevención sobre 100 trabajadores, comité paritario sobre 25) o porque la faena no comparte centro de trabajo con otras empresas. Los ítems No cumple generan acción correctiva; los marcados con daño potencial grave o fatal derivan hallazgo de criticidad alta, que la revisión exige cerrar con CAPA.',
  sections: AUDITORIA_SGSST_SECTIONS,
  closingAct: {
    title: 'Cierre de auditoría',
    resultOptions: [
      { value: 'conforme', label: 'Conforme' },
      { value: 'conforme_observaciones', label: 'Conforme con observaciones' },
      { value: 'no_conforme', label: 'No conforme' },
    ],
    hasRestrictions: false,
    signatureRoles: ['auditor', 'representante_legal'],
  },
}
