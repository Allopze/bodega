import type { ChecklistDefinition } from '../types'
import { IDENTIFICACION_SENSIBLES_SECTIONS } from './identificacion-sensibles-sections'

/**
 * RE-28 — Identificación de personas trabajadoras especialmente sensibles.
 *
 * Actividad N°17 del programa 2026. Hasta ahora era la única `compuesta` sin
 * ningún componente que la acreditara: la decisión D06 estableció
 * explícitamente que **no** se acredita desde el acta de trabajador nuevo —la
 * "declaración de salud" de esa acta no es el RE-28 ni tiene su criterio— y su
 * formulario propio no existía. Quedaba marcable a mano y midiéndose por
 * cobertura contra la dotación, o sea un 0 % estructural.
 *
 * **Por qué vive en el motor de evaluaciones y no en el de inspecciones**, que
 * es donde fue a parar el checklist del DS 594 (N°10):
 *
 * - una inspección no tiene persona. Su sujeto es un recurso, un vehículo o un
 *   contenedor, y la N°17 se mide por cobertura sobre la dotación: necesita
 *   **una ejecución por trabajador**. Meterla ahí exigiría una columna de
 *   sujeto-trabajador y todo lo que cuelga de ella;
 * - `sst_evaluations` ya es por trabajador y por faena, y su acta cerrada es
 *   inmutable por DS 44, que es justo lo que el motor de acreditación pide;
 * - y la razón decisiva: **esto registra datos de salud**. Cualquiera con
 *   `prevention:inspections:view` lista todas las plantillas y todos los runs;
 *   el motor de inspecciones no tiene clasificación de datos ni auditoría de
 *   acceso sensible. El de evaluaciones sí, y `requiresPermission` por sección
 *   ya existe.
 */
export const IDENTIFICACION_SENSIBLES: ChecklistDefinition = {
  code: 'identificacion_sensibles',
  version: '01',
  revisionDate: '2026-09-03',
  tipo: 'seguimiento',
  title: 'RE-28: Identificación de Personas Trabajadoras Especialmente Sensibles (PTES)',
  subtitle: 'Declaración voluntaria, con reserva de identificación',
  legalFramework: [
    'DS N°44/2024 del Ministerio del Trabajo y Previsión Social',
    'Ley N°16.744 sobre Accidentes del Trabajo y Enfermedades Profesionales',
    'Código del Trabajo, Art. 184',
  ],
  applicableTo:
    'Todo el personal, cualquiera sea su contrato (plazo fijo, indefinido, subcontratado u honorarios), en todos los '
    + 'centros de trabajo. La identificación llega por examen médico ocupacional, por declaración voluntaria de la persona '
    + 'trabajadora o por derivación del organismo administrador (DO-47, punto 6.1).',
  objective:
    'Identificar a las personas trabajadoras especialmente sensibles y dejar registro de la adecuación de su puesto, '
    + 'las restricciones informadas y la fecha de reevaluación acordada.',
  frequencySuggested:
    'Actualización del registro cada 6 meses, o cuando cambie la condición de la persona trabajadora (DO-47, punto 6.4).',
  evaluationCriteria:
    'El instrumento no puntúa: no tiene escala de cumplimiento en ninguna sección. Ambas son obligatorias de responder, y el '
    + 'resultado del acta lo determina si el puesto exige reubicar, ajustar o limitar tareas. Lo que se mide a nivel de programa '
    + 'es la cobertura: cuántas personas de la dotación tienen su registro hecho.',

  sections: IDENTIFICACION_SENSIBLES_SECTIONS,

  // Es un registro de una sola vez, no un seguimiento con hitos: la
  // reevaluación se acuerda dentro del propio formulario, con su fecha.
  schedulesFollowups: false,

  closingAct: {
    title: '3. Acta de cierre del registro',
    resultOptions: [
      { value: 'habilitado_autonomo', label: 'SIN NECESIDAD DE REUBICAR, AJUSTAR O LIMITAR TAREAS' },
      { value: 'habilitado_restricciones', label: 'CON REUBICACIÓN, AJUSTE DE FUNCIONES O LIMITACIÓN DE TAREAS' },
      { value: 'no_habilitado', label: 'REQUIERE PRONUNCIAMIENTO DEL ORGANISMO ADMINISTRADOR ANTES DE OPERAR' },
    ],
    hasRestrictions: true,
    // Las dos firmas del formulario: asesor en prevención y persona trabajadora.
    signatureRoles: ['trabajador', 'prevencionista'],
  },
}
