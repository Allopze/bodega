/**
 * Inspección de área de trabajo — actividad PDTP n=40.
 *
 * Mismo patrón que `observacion_conductas`: no puntúa ítems, registra las
 * desviaciones encontradas desde el catálogo del instrumento
 * (`recordsDeviations`) y no lleva acta.
 *
 * Lo que cambia es el objeto: acá se levantan **condiciones** del lugar de
 * trabajo, no conductas de personas. Por eso el catálogo es propio y no
 * compartido — una desviación de área no es la misma que una de conducta.
 *
 * El área es la faena de la inspección: "en su área" se entiende como el ámbito
 * de atribuciones de cada jefe directo, que ya está acotado por el alcance de
 * faena del usuario.
 */
import type { ChecklistDefinition } from "../types"

export const INSPECCION_AREA: ChecklistDefinition = {
  code: 'INSP-AREA',
  version: '01',
  revisionDate: '2026-08-23',
  title: 'Inspección de área de trabajo',
  tipo: 'seguimiento',
  subtitle: 'Se registra la inspección y las desviaciones de condiciones encontradas.',
  legalFramework: [
    'DS 44 art. 22',
    'Ley 21.512 (ex DS 594)',
  ],
  applicableTo:
    'Supervisor y jefe de terreno, en las áreas de trabajo bajo su responsabilidad.',
  objective:
    'Corregir desviaciones en las condiciones de las áreas de trabajo.',
  frequencySuggested: 'Dos veces al mes, por cada jefe directo.',
  evaluationCriteria:
    'No se puntúa. Cada desviación se registra desde el catálogo del instrumento, y su gravedad —declarada en el catálogo— fija el plazo de la acción correctiva.',
  recordsDeviations: true,
  sections: [
    {
      id: 'contexto',
      title: 'Contexto de la inspección',
      items: [
        {
          id: 'observaciones_generales',
          label: 'Observaciones generales.',
          kind: 'textarea',
          placeholder: 'Opcional. Sector recorrido y lo que convenga dejar dicho.',
        },
      ],
    },
  ],
}
