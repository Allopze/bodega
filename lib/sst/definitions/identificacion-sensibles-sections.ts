import type { ChecklistSection } from '../types'

/**
 * RE-28 — Identificación de Personas Trabajadoras Especialmente Sensibles
 * (PTES). Transcripción del formulario de Chome, no una reconstrucción desde
 * la norma: las ocho categorías y las tres preguntas de evaluación del puesto
 * son literalmente las del papel.
 *
 * Dos rarezas del instrumento, y ninguna es un descuido:
 *
 * 1. **Nada de esto puntúa** (`countsForCompliance: false` en las dos
 *    secciones). El RE-28 no tiene columna "cumple / no cumple" en ningún lado:
 *    declara una condición y registra qué se hizo con ella. Declarar un
 *    embarazo no es un incumplimiento, y responder "Sí" a "¿existe exposición
 *    relevante para su condición?" tampoco es cumplir — con la escala Sí/No
 *    puntuaría al revés.
 *
 *    Marcarlas puntuables tenía además un efecto concreto y absurdo: "No" es un
 *    estado negativo, así que el gate de cierre exigía una observación escrita
 *    por cada categoría respondida "No" — once justificaciones para decir que
 *    la persona no está embarazada, no es menor de edad y no tiene alergias.
 *
 *    Es el mismo molde que la observación planeada del Anexo 7, que el catálogo
 *    ya reconoce como instrumento sin ítems puntuables. Lo que la actividad N°17
 *    mide no es el contenido del acta sino cuántas personas de la dotación la
 *    tienen hecha.
 *
 *    "No puntúa" no es lo mismo que "no hace falta responder": ambas secciones
 *    llevan `requiresCompletion: true`, así que `closeEvaluation` sigue
 *    exigiendo una respuesta por ítem aunque ninguno cuente para el % de
 *    cumplimiento. Sin ese campo el RE-28 se cerraba en blanco y acreditaba
 *    igual la N°17 — el efecto colateral no buscado de que
 *    `countsForCompliance: false` también vaciaba la lista de "ítems que
 *    faltan por responder".
 *
 * 2. **No lleva `requiresPermission`** pese a contener datos de salud. Ese campo
 *    hoy significa "sección del Punto 3 del conductor líder":
 *    `sectionAppliesToEvaluatorRole` devuelve `!section.requiresPermission` para
 *    cualquier otro evaluador, así que marcarla la sacaría del formulario para
 *    todos. La protección efectiva está en el archivo: el acta cerrada queda
 *    clasificada `sensible` / `sensitive_preventive`, bajo la auditoría de
 *    acceso de `prevention-sensitive-files.ts`.
 */
export const IDENTIFICACION_SENSIBLES_SECTIONS: ChecklistSection[] = [
  {
    id: 'categorias_sensibilidad',
    title: '1. Categorías de sensibilidad',
    description:
      'Declaración voluntaria, con reserva de identificación. Un "Sí" no es un incumplimiento: es lo que activa '
      + 'la obligación de evaluar el puesto. Contiene datos de salud y el acta archivada queda clasificada como sensible.',
    countsForCompliance: false,
    // No puntúa, pero el acta no puede cerrarse sin declarar cada categoría:
    // sin esto, `closeEvaluation` no exigía ninguna respuesta acá y el RE-28
    // se cerraba vacío acreditando igual la N°17.
    requiresCompletion: true,
    items: [
      { id: 'embarazo_lactancia',        label: 'Mujer embarazada o en periodo de lactancia.', kind: 'si_no_obs' },
      { id: 'menor_edad',                label: 'Menor de edad (menor de 18 años).', kind: 'si_no_obs' },
      { id: 'enfermedad_cronica',        label: 'Persona con enfermedad crónica (respiratoria, cardiovascular, metabólica, etc.).', kind: 'si_no_obs' },
      { id: 'inmunocomprometida',        label: 'Persona inmunocomprometida.', kind: 'si_no_obs' },
      { id: 'discapacidad',              label: 'Persona con discapacidad física o sensorial.', kind: 'si_no_obs' },
      { id: 'tratamiento_farmacologico', label: 'Persona con tratamiento farmacológico continuo.', kind: 'si_no_obs' },
      { id: 'alergias',                  label: 'Persona con alergias, y medicamento que usa.', kind: 'si_no_obs' },
      { id: 'otra_condicion',            label: 'Otra condición relevante.', kind: 'si_no_obs' },
      { id: 'detalle_otra_condicion',    label: 'Especifique la otra condición relevante.', kind: 'textarea' },
    ],
  },
  {
    id: 'evaluacion_puesto',
    title: '2. Evaluación del puesto de trabajo',
    description:
      'Las tres preguntas del formulario. Sus respuestas no puntúan: un "Sí" describe la realidad del puesto, '
      + 'no una falta.',
    countsForCompliance: false,
    requiresCompletion: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'exposicion_agentes', label: '¿Existe exposición a agentes físicos, químicos o biológicos relevantes para su condición?', kind: 'si_no_obs' },
      { id: 'exposicion_detalle', label: 'Detalles de la exposición.', kind: 'textarea' },
      { id: 'requiere_ajuste',    label: '¿Es necesario reubicar, ajustar funciones o limitar tareas?', kind: 'si_no_obs' },
      { id: 'ajuste_recomendaciones', label: 'Recomendaciones de reubicación o ajuste.', kind: 'textarea' },
      { id: 'monitoreo_medico',   label: '¿Requiere monitoreo médico adicional?', kind: 'si_no_obs' },
      { id: 'monitoreo_periodicidad', label: 'Periodicidad del monitoreo médico.', kind: 'textarea' },
    ],
  },
]
