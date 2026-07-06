import type { ChecklistSection } from '../types'

export const NUEVO_SECTIONS: ChecklistSection[] = [
  // ============================================================
  // 1.1 Documentación y requisitos legales
  // ============================================================
  {
    id: 'documentacion_requisitos',
    title: '1.1 Documentación y requisitos legales',
    countsForCompliance: true,
    items: [
      { id: 'contrato_trabajo',        label: 'Contrato de trabajo firmado', kind: 'cumple_nocumple_na_obs' },
      { id: 'examen_preocupacional',    label: 'Examen preocupacional vigente de acuerdo al cargo', kind: 'cumple_nocumple_na_obs' },
      { id: 'licencia_conducir',        label: 'Licencia de conducir correspondiente al equipo a conducir u operar', kind: 'cumple_nocumple_na_obs' },
      { id: 'certificacion_competencias', label: 'Certificación de competencias', kind: 'cumple_nocumple_na_obs' },
      { id: 'declaracion_salud',        label: 'Declaración de salud', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 1.2 Inducción y capacitación inicial
  // ============================================================
  {
    id: 'induccion_capacitacion',
    title: '1.2 Inducción y capacitación inicial',
    countsForCompliance: true,
    items: [
      { id: 'induccion_irl',            label: 'Inducción IRL', kind: 'cumple_nocumple_na_obs' },
      { id: 'riohs',                    label: 'Reglamento interno de orden, higiene y seguridad', kind: 'cumple_nocumple_na_obs' },
      { id: 'procedimientos_operacionales', label: 'Procedimientos operacionales de trabajo', kind: 'cumple_nocumple_na_obs' },
      { id: 'procedimiento_do53',       label: 'Procedimiento de conducción DO-53', kind: 'cumple_nocumple_na_obs' },
      { id: 'piensa_actua',             label: 'Programa Piensa y Actúa', kind: 'cumple_nocumple_na_obs' },
      { id: 'alcohol_drogas',           label: 'Procedimiento de alcohol y drogas', kind: 'cumple_nocumple_na_obs' },
      { id: 'protocolos_minsal',        label: 'Protocolos Minsal', kind: 'cumple_nocumple_na_obs' },
      { id: 'capacitacion_epp',         label: 'Capacitación: gestión de los elementos de protección personal', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 1.3 Elementos de protección personal
  // ============================================================
  {
    id: 'epp',
    title: '1.3 Elementos de protección personal',
    countsForCompliance: true,
    items: [
      { id: 'casco_seguridad',    label: 'Casco de seguridad', kind: 'entregado_obs' },
      { id: 'calzado_seguridad',  label: 'Calzado de seguridad', kind: 'entregado_obs' },
      { id: 'proteccion_auditiva', label: 'Protección auditiva', kind: 'entregado_obs' },
      { id: 'lentes_seguridad',   label: 'Lentes de seguridad sellados', kind: 'entregado_obs' },
      { id: 'guantes_seguridad',  label: 'Guantes de seguridad', kind: 'entregado_obs' },
      { id: 'chaleco_reflectante', label: 'Chaleco reflectante', kind: 'entregado_obs' },
      { id: 'otros_epp',          label: 'Otros de acuerdo a la faena', kind: 'entregado_obs' },
    ],
  },

  // ============================================================
  // 2. Competencias operacionales iniciales
  // ============================================================
  {
    id: 'competencias_operacionales',
    title: '2. Competencias operacionales iniciales',
    countsForCompliance: true,
    items: [
      { id: 'reconoce_peligros',        label: 'Reconoce peligros críticos de la tarea', kind: 'apto_obs' },
      { id: 'pausas_seguridad',         label: 'Aplica pausas de seguridad antes de operar', kind: 'apto_obs' },
      { id: 'uso_correcto_equipos',     label: 'Uso correcto de los equipos, de acuerdo al equipo a operar o conducir', kind: 'apto_obs' },
      { id: 'maniobras_carga_descarga', label: 'Maniobras seguras de carga y descarga', kind: 'apto_obs' },
      { id: 'distancia_seguridad',      label: 'Mantiene distancia de seguridad entre equipos o estructuras', kind: 'apto_obs' },
      { id: 'comunicacion_efectiva',    label: 'Comunicación efectiva con otros trabajadores cercanos a la actividad', kind: 'apto_obs' },
      { id: 'detiene_tarea_insegura',   label: 'Detiene la tarea ante condiciones inseguras', kind: 'apto_obs' },
    ],
  },

  // ============================================================
  // 3.1 Acompañamiento en terreno — Semana 1 (días 1-7)
  // ============================================================
  {
    id: 'acompanamiento_terreno_s1',
    title: '3.1 Acompañamiento en terreno — Semana 1',
    description: 'Días 1–7 desde la fecha de evaluación',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    requiresPermission: 'sst:evaluate_acompanamiento',
    weekNumber: 1,
    items: [
      { id: 'procedimientos_trabajo_seguro', label: 'Cumple procedimientos operativos de trabajo seguro', kind: 'cumple_nocumple_na_obs' },
      { id: 'zonas_estacionamiento',         label: 'Respeta zonas establecidas de estacionamiento', kind: 'cumple_nocumple_na_obs' },
      { id: 'distancias_estacionamiento',    label: 'Respeta distancias de seguridad al estacionarse cerca de equipos, estructuras u otros obstáculos', kind: 'cumple_nocumple_na_obs' },
      { id: 'conductas_preventivas',         label: 'Mantiene conductas preventivas', kind: 'cumple_nocumple_na_obs' },
      { id: 'sin_exceso_confianza',          label: 'No incurre en excesos de confianza', kind: 'cumple_nocumple_na_obs' },
      { id: 'aplica_piensa_actua',           label: 'Aplica Piensa y Actúa', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 3.2 Acompañamiento en terreno — Semana 2 (días 8-14)
  // ============================================================
  {
    id: 'acompanamiento_terreno_s2',
    title: '3.2 Acompañamiento en terreno — Semana 2',
    description: 'Días 8–14 desde la fecha de evaluación',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    requiresPermission: 'sst:evaluate_acompanamiento',
    weekNumber: 2,
    items: [
      { id: 'procedimientos_trabajo_seguro', label: 'Cumple procedimientos operativos de trabajo seguro', kind: 'cumple_nocumple_na_obs' },
      { id: 'zonas_estacionamiento',         label: 'Respeta zonas establecidas de estacionamiento', kind: 'cumple_nocumple_na_obs' },
      { id: 'distancias_estacionamiento',    label: 'Respeta distancias de seguridad al estacionarse cerca de equipos, estructuras u otros obstáculos', kind: 'cumple_nocumple_na_obs' },
      { id: 'conductas_preventivas',         label: 'Mantiene conductas preventivas', kind: 'cumple_nocumple_na_obs' },
      { id: 'sin_exceso_confianza',          label: 'No incurre en excesos de confianza', kind: 'cumple_nocumple_na_obs' },
      { id: 'aplica_piensa_actua',           label: 'Aplica Piensa y Actúa', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 3.3 Acompañamiento en terreno — Semana 3 (días 15-21)
  // ============================================================
  {
    id: 'acompanamiento_terreno_s3',
    title: '3.3 Acompañamiento en terreno — Semana 3',
    description: 'Días 15–21 desde la fecha de evaluación',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    requiresPermission: 'sst:evaluate_acompanamiento',
    weekNumber: 3,
    items: [
      { id: 'procedimientos_trabajo_seguro', label: 'Cumple procedimientos operativos de trabajo seguro', kind: 'cumple_nocumple_na_obs' },
      { id: 'zonas_estacionamiento',         label: 'Respeta zonas establecidas de estacionamiento', kind: 'cumple_nocumple_na_obs' },
      { id: 'distancias_estacionamiento',    label: 'Respeta distancias de seguridad al estacionarse cerca de equipos, estructuras u otros obstáculos', kind: 'cumple_nocumple_na_obs' },
      { id: 'conductas_preventivas',         label: 'Mantiene conductas preventivas', kind: 'cumple_nocumple_na_obs' },
      { id: 'sin_exceso_confianza',          label: 'No incurre en excesos de confianza', kind: 'cumple_nocumple_na_obs' },
      { id: 'aplica_piensa_actua',           label: 'Aplica Piensa y Actúa', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 3.4 Acompañamiento en terreno — Semana 4 (días 22-30)
  // ============================================================
  {
    id: 'acompanamiento_terreno_s4',
    title: '3.4 Acompañamiento en terreno — Semana 4',
    description: 'Días 22–30 desde la fecha de evaluación',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    requiresPermission: 'sst:evaluate_acompanamiento',
    weekNumber: 4,
    items: [
      { id: 'procedimientos_trabajo_seguro', label: 'Cumple procedimientos operativos de trabajo seguro', kind: 'cumple_nocumple_na_obs' },
      { id: 'zonas_estacionamiento',         label: 'Respeta zonas establecidas de estacionamiento', kind: 'cumple_nocumple_na_obs' },
      { id: 'distancias_estacionamiento',    label: 'Respeta distancias de seguridad al estacionarse cerca de equipos, estructuras u otros obstáculos', kind: 'cumple_nocumple_na_obs' },
      { id: 'conductas_preventivas',         label: 'Mantiene conductas preventivas', kind: 'cumple_nocumple_na_obs' },
      { id: 'sin_exceso_confianza',          label: 'No incurre en excesos de confianza', kind: 'cumple_nocumple_na_obs' },
      { id: 'aplica_piensa_actua',           label: 'Aplica Piensa y Actúa', kind: 'cumple_nocumple_na_obs' },
    ],
  },
]
