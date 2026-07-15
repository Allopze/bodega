import type { ChecklistSection } from '../types'

/**
 * Observación Planeada de Seguridad — módulo 14 (genérica).
 *
 * ⚠️ FUENTE FALTANTE: el markdown `14-observaciones-planeadas.md` no existe
 * en `docx revisado/` (referenciado en el índice como "Anexo 7 Observaciones
 * Planeadas.XLS"). Esta es una plantilla GENÉRICA provisional redactada para
 * habilitar el flujo; confirmar los ítems reales con el cliente antes de
 * considerar cerrada la definición. Ver PLAN_INTEGRACION §5.6 y §14 #4.
 *
 * Actividad PDTP 2026: n=41 ("Caminatas de seguridad, levantamiento de
 * inspecciones y observaciones en terreno").
 *
 * Patrón B (single-sujeto): una instancia por faena/período.
 *
 * Estructura: 3 secciones de cumplimiento (condiciones / comportamientos /
 * equipos e instalaciones) + 1 sección de observación libre. Todos los
 * ítems de cumplimiento usan `cumple_nocumple_na_obs` y generan acciones
 * correctivas en línea (`hasActionCorrectiva: true`).
 */
export const OBSERVACION_PLANEADA_SECTIONS: ChecklistSection[] = [
  // ============================================================
  // 1. Condiciones generales del lugar de trabajo
  // ============================================================
  {
    id: 'condiciones_lugar_trabajo',
    title: '1. Condiciones generales del lugar de trabajo',
    description: 'Evalúe las condiciones físicas y de orden del área observada.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'orden_limpieza',          label: 'Lugares de trabajo limpios, ordenados y libres de obstáculos.', kind: 'cumple_nocumple_na_obs' },
      { id: 'pasillos_transito',       label: 'Pasillos de circulación y vías de tránsito despejados y debidamente señalizados.', kind: 'cumple_nocumple_na_obs' },
      { id: 'senalizacion_riesgos',    label: 'Señalización de riesgos y de uso obligatorio de EPP presente, visible y en buen estado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'superficies_estructuras', label: 'Superficies de trabajo, pisos y estructuras en condiciones seguras y sin deterioro.', kind: 'cumple_nocumple_na_obs' },
      { id: 'iluminacion_ventilacion', label: 'Iluminación y ventilación adecuadas para la tarea que se realiza.', kind: 'cumple_nocumple_na_obs' },
      { id: 'almacenamiento_materiales', label: 'Materiales, herramientas y productos almacenados de forma segura, estable y ordenada.', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 2. Comportamiento y prácticas seguras de los trabajadores
  // ============================================================
  {
    id: 'comportamientos_trabajadores',
    title: '2. Comportamiento y prácticas seguras de los trabajadores',
    description: 'Observe las conductas y prácticas de los trabajadores durante la caminata.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'uso_epp',               label: 'Los trabajadores utilizan el EPP correspondiente a la tarea y al riesgo del área.', kind: 'cumple_nocumple_na_obs' },
      { id: 'procedimientos_trabajo', label: 'Se cumplen los procedimientos de trabajo seguro establecidos para la tarea.', kind: 'cumple_nocumple_na_obs' },
      { id: 'pausa_seguridad',       label: 'Los trabajadores realizan pausa de seguridad y evalúan riesgos antes de iniciar o reiniciar la tarea.', kind: 'cumple_nocumple_na_obs' },
      { id: 'conducta_preventiva',   label: 'Se observan conductas preventivas, sin exceso de confianza ni actos subestándar.', kind: 'cumple_nocumple_na_obs' },
      { id: 'reporte_condiciones',   label: 'Los trabajadores reportan condiciones o actos subestándar detectados.', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 3. Equipos, herramientas e instalaciones
  // ============================================================
  {
    id: 'equipos_instalaciones',
    title: '3. Equipos, herramientas e instalaciones',
    description: 'Verifique el estado y condiciones de equipos, herramientas e instalaciones del área.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'estado_equipos',           label: 'Equipos y máquinas en buen estado de funcionamiento y mantención.', kind: 'cumple_nocumple_na_obs' },
      { id: 'proteccion_partes_moviles', label: 'Partes móviles, transmisiones y puntos de operación debidamente protegidos.', kind: 'cumple_nocumple_na_obs' },
      { id: 'herramientas_estado',      label: 'Herramientas manuales y eléctricas en buen estado y uso adecuado.', kind: 'cumple_nocumple_na_obs' },
      { id: 'instalaciones_electricas', label: 'Instalaciones eléctricas, tableros y empalmes en condiciones seguras y protegidos.', kind: 'cumple_nocumple_na_obs' },
      { id: 'extintores_acceso',        label: 'Extintores accesibles, señalizados, sin obstáculos y en condiciones de uso.', kind: 'cumple_nocumple_na_obs' },
      { id: 'servicios_higienicos',     label: 'Servicios higiénicos y áreas de descanso en condiciones adecuadas de aseo y operación.', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 4. Observaciones generales
  // ============================================================
  {
    id: 'observaciones_generales',
    title: '4. Observaciones generales',
    description: 'Registro libre de hallazgos adicionales, medidas preventivas o compromisos detectados en la caminata.',
    countsForCompliance: false,
    items: [
      {
        id: 'observacion_libre',
        label: 'Observaciones adicionales de la caminata de seguridad',
        kind: 'text',
        placeholder: 'Describa observaciones, medidas preventivas o compromisos detectados…',
      },
    ],
  },
]
