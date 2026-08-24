/**
 * Caminata de seguridad — actividad PDTP n=41.
 *
 * Recorrido conjunto del prevencionista con el administrador de contrato, del
 * que se levantan inspecciones y observaciones en terreno. No puntúa ítems:
 * registra las desviaciones encontradas desde su catálogo (`recordsDeviations`)
 * y no lleva acta.
 *
 * Su catálogo es propio aunque en la práctica se parezca al de la inspección de
 * área: son dos actividades distintas del programa, con responsables y cadencia
 * distintos, y la acreditación es por plantilla. El creador de desviaciones
 * ofrece copiar el catálogo de otro instrumento para no llenarlo dos veces.
 */
import type { ChecklistDefinition } from "../types"

export const CAMINATA_SEGURIDAD: ChecklistDefinition = {
  code: 'CAMINATA-SEG',
  version: '01',
  revisionDate: '2026-08-23',
  title: 'Caminata de seguridad',
  tipo: 'seguimiento',
  subtitle: 'Recorrido conjunto: se registran las desviaciones levantadas en terreno.',
  legalFramework: [
    'DS 44 art. 22',
    'Ley 16.744',
  ],
  applicableTo:
    'Prevencionista de faena junto al administrador de contrato, en las distintas áreas de trabajo.',
  objective:
    'Levantar inspecciones y observaciones en terreno mediante un recorrido conjunto de las áreas de trabajo.',
  frequencySuggested: 'Semanal.',
  evaluationCriteria:
    'No se puntúa. Cada desviación se registra desde el catálogo del instrumento, y su gravedad —declarada en el catálogo— fija el plazo de la acción correctiva.',
  recordsDeviations: true,
  sections: [
    {
      id: 'contexto',
      title: 'Contexto de la caminata',
      items: [
        {
          id: 'acompanantes',
          label: 'Quiénes recorrieron.',
          kind: 'text',
          placeholder: 'Ej: Prevencionista y administrador de contrato',
        },
        {
          id: 'observaciones_generales',
          label: 'Observaciones generales.',
          kind: 'textarea',
          placeholder: 'Opcional. Sectores recorridos y lo que convenga dejar dicho.',
        },
      ],
    },
  ],
}
