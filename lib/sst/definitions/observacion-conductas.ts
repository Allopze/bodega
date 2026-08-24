/**
 * Observación de conductas en terreno — actividad PDTP n=39.
 *
 * NO es un checklist: se registra que la observación se hizo y qué desviaciones
 * de conducta se encontraron, tomadas del catálogo de desviaciones del
 * instrumento (`recordsDeviations`). No hay lista fija de preguntas que puntuar,
 * así que `compliancePercent` queda nulo por construcción.
 *
 * Tampoco lleva acta: el formulario en papel —con la firma del observador y del
 * trabajador observado— sigue siendo el respaldo, por decisión de Prevención
 * (2026-08-23). El sistema registra la actividad y levanta las desviaciones como
 * hallazgos con su plazo de acción correctiva.
 *
 * Distinta del Anexo 7 (`observacion_planeada`), que quedó fuera del motor: esa
 * exigía tipear el relato libre completo.
 */
import type { ChecklistDefinition } from "../types"

export const OBSERVACION_CONDUCTAS: ChecklistDefinition = {
  code: 'OBS-CONDUCTAS',
  version: '01',
  revisionDate: '2026-08-23',
  title: 'Observación de conductas en terreno',
  tipo: 'seguimiento',
  subtitle: 'Se registra la observación y las desviaciones de conducta encontradas.',
  legalFramework: [
    'DS 44 art. 22',
    'Ley 16.744',
  ],
  applicableTo:
    'Supervisor y jefe de terreno, en las áreas de trabajo bajo su responsabilidad.',
  objective:
    'Corregir desviaciones de conducta respecto de normas, procedimientos y estándares de trabajo seguro.',
  frequencySuggested: 'Mensual, por cada jefe directo.',
  evaluationCriteria:
    'No se puntúa. Cada desviación observada se registra desde el catálogo del instrumento, y su gravedad —declarada en el catálogo— fija el plazo de la acción correctiva.',
  recordsDeviations: true,
  sections: [
    {
      id: 'contexto',
      title: 'Contexto de la observación',
      items: [
        {
          id: 'observaciones_generales',
          label: 'Observaciones generales.',
          kind: 'textarea',
          placeholder: 'Opcional. Lo que convenga dejar dicho más allá de las desviaciones.',
        },
      ],
    },
  ],
}
