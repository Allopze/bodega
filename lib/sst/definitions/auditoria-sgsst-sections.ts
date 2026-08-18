import type { ChecklistSection } from '../types'

/**
 * Auditoría interna del Sistema de Gestión de SST.
 *
 * Fuente normativa: DS 44/2024 art. 22 (los cinco elementos exigibles del
 * Sistema de Gestión) desplegados sobre los instrumentos que el mismo
 * reglamento obliga a tener, y cruzados con las cláusulas de ISO 45001:2018.
 *
 * Ojo con la distinción que motiva este checklist: el art. 14 exige evaluar el
 * cumplimiento **del programa de trabajo preventivo** —eso ya lo cubre
 * `/prevencion/pdtp/cobertura`— mientras que el art. 22 n°4 exige auditar **el
 * desempeño del Sistema de Gestión**, que es el nivel de arriba. Son dos
 * obligaciones distintas; esta plantilla resuelve la segunda.
 *
 * Escala: `cumple_nocumple_na_obs`. El N/A es necesario de verdad — hay
 * secciones que no aplican según dotación (Departamento de Prevención sobre
 * 100 trabajadores, comité paritario sobre 25) o según si la faena comparte
 * centro de trabajo con otras empresas.
 *
 * `danoPotencial` marca los ítems cuyo incumplimiento es hallazgo de sistema,
 * no de detalle: sin política, sin matriz IPER o sin programa aprobado no hay
 * sistema de gestión que auditar. Esos derivan CAPA de prioridad alta.
 */
export const AUDITORIA_SGSST_SECTIONS: ChecklistSection[] = [
  {
    id: 'politica',
    title: '1. Política de seguridad y salud en el trabajo',
    description: 'DS 44 art. 22 n°1 · ISO 45001 §5.2',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'politica_existe', label: 'Existe una política de SST escrita y aprobada por el representante legal', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'politica_compromiso_vida', label: 'Explicita el compromiso de protección de la vida y salud de las personas trabajadoras', kind: 'cumple_nocumple_na_obs' },
      { id: 'politica_cumplimiento_normativo', label: 'Explicita el compromiso de cumplimiento de la normativa aplicable', kind: 'cumple_nocumple_na_obs' },
      { id: 'politica_participacion', label: 'Explicita la participación del Comité Paritario y de las personas trabajadoras', kind: 'cumple_nocumple_na_obs' },
      { id: 'politica_mejora_continua', label: 'Explicita mecanismos de diálogo y de propuestas de mejoramiento continuo', kind: 'cumple_nocumple_na_obs' },
      { id: 'politica_difundida', label: 'Está difundida y es conocida en los lugares de trabajo', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'estructura',
    title: '2. Estructura preventiva y responsabilidades',
    description: 'DS 44 art. 21, 22 n°2 y título III · ISO 45001 §5.1 y §5.3',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'estructura_documentada', label: 'La estructura organizacional para la gestión preventiva está documentada con funciones y responsabilidades por nivel jerárquico', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'estructura_cphs', label: 'El Comité Paritario está constituido y vigente donde la dotación lo exige (sobre 25 trabajadores)', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'estructura_delegado', label: 'Hay delegado de SST designado donde corresponde (entre 10 y 25 trabajadores)', kind: 'cumple_nocumple_na_obs' },
      { id: 'estructura_depto', label: 'El Departamento de Prevención de Riesgos existe y cumple la dedicación mínima del experto (sobre 100 trabajadores)', kind: 'cumple_nocumple_na_obs' },
      { id: 'estructura_facilidades', label: 'Se otorgan las facilidades de tiempo y medios para el funcionamiento del Comité Paritario', kind: 'cumple_nocumple_na_obs' },
      { id: 'estructura_riohs', label: 'El Reglamento Interno de Higiene y Seguridad está vigente y entregado a la dotación', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
    ],
  },
  {
    id: 'iper',
    title: '3. Identificación de peligros y evaluación de riesgos',
    description: 'DS 44 art. 7 y 62 · ISO 45001 §6.1.1 y §6.1.2',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'iper_existe', label: 'Existe matriz IPER por procesos, tareas y puestos de trabajo', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
      { id: 'iper_disponible', label: 'La matriz está disponible en los lugares de trabajo e informada al Comité Paritario, delegado y dirigentes sindicales', kind: 'cumple_nocumple_na_obs' },
      { id: 'iper_enfoque_genero', label: 'La evaluación considera enfoque de género y personas especialmente sensibles', kind: 'cumple_nocumple_na_obs' },
      { id: 'iper_factores', label: 'Considera riesgos ergonómicos, psicosociales, y violencia y acoso en el trabajo', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'iper_actualizada', label: 'Se actualiza ante cambios de proceso, incidentes o nuevas condiciones', kind: 'cumple_nocumple_na_obs' },
      { id: 'iper_mapa_riesgos', label: 'Existe mapa de riesgos exigible, visible y actualizado', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'requisitos_legales',
    title: '4. Requisitos legales y otros requisitos',
    description: 'ISO 45001 §6.1.3',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'legal_registro', label: 'Existe un registro actualizado de requisitos legales aplicables', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'legal_evaluacion', label: 'Se evalúa periódicamente el cumplimiento de cada requisito', kind: 'cumple_nocumple_na_obs' },
      { id: 'legal_incumplimientos', label: 'Los incumplimientos detectados derivan en acción correctiva con responsable y plazo', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'programa',
    title: '5. Programa de trabajo preventivo',
    description: 'DS 44 art. 8, 9 y 22 n°3 · ISO 45001 §6.2',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'programa_existe', label: 'Existe programa de trabajo preventivo escrito y aprobado por el representante legal', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
      { id: 'programa_deriva_iper', label: 'El programa se elaboró a partir de la matriz IPER dentro de los 30 días de su confección o actualización', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'programa_contenido', label: 'Contiene medidas preventivas y correctivas, plazos de implementación y responsables de ejecución', kind: 'cumple_nocumple_na_obs' },
      { id: 'programa_prelacion', label: 'Las medidas respetan la prelación: eliminar, sustituir, controles de ingeniería, administrativos y EPP al final', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'programa_alcohol_drogas', label: 'Incluye actividades de promoción sobre consumo de alcohol y drogas y vida saludable', kind: 'cumple_nocumple_na_obs' },
      { id: 'programa_conduccion', label: 'Incluye actividades de prevención asociadas a la conducción de vehículos motorizados, cuando corresponde', kind: 'cumple_nocumple_na_obs' },
      { id: 'programa_difundido', label: 'Fue difundido antes de su implementación y se remitió un ejemplar al Comité Paritario', kind: 'cumple_nocumple_na_obs' },
      { id: 'programa_control', label: 'Existen acciones de control y vigilancia del cumplimiento de las medidas, con la periodicidad que el programa define', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'informacion_capacitacion',
    title: '6. Información y capacitación',
    description: 'DS 44 art. 15 y 16 · ISO 45001 §7.2 y §7.3',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'odi_entregada', label: 'Se informa oportunamente a cada persona sobre los riesgos de su puesto y las medidas de control (obligación de informar)', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'capacitacion_programa', label: 'Existe programa de capacitación en prevención de riesgos con cobertura por cargo', kind: 'cumple_nocumple_na_obs' },
      { id: 'capacitacion_registro', label: 'Hay registro de asistencia, contenido y evaluación de cada capacitación', kind: 'cumple_nocumple_na_obs' },
      { id: 'capacitacion_competencias', label: 'Las habilitaciones vigentes por trabajador están controladas y se detectan brechas', kind: 'cumple_nocumple_na_obs' },
      { id: 'capacitacion_induccion', label: 'Todo ingreso o cambio de puesto recibe inducción antes de comenzar la tarea', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
    ],
  },
  {
    id: 'participacion',
    title: '7. Consulta y participación',
    description: 'DS 44 art. 17 · ISO 45001 §5.4',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'participacion_consulta', label: 'Se consulta a las personas trabajadoras o sus representantes en las materias de SST que les afectan', kind: 'cumple_nocumple_na_obs' },
      { id: 'participacion_cphs_actas', label: 'El Comité Paritario sesiona con la periodicidad exigida y levanta acta de sus acuerdos', kind: 'cumple_nocumple_na_obs' },
      { id: 'participacion_propuestas', label: 'Existe un canal para propuestas y reclamos sobre condiciones de trabajo, y las respuestas quedan registradas', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'control_operacional',
    title: '8. Control operacional, EPP y gestión del cambio',
    description: 'DS 44 art. 10 a 13 · ISO 45001 §8.1',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'control_maquinas', label: 'Las máquinas, equipos y herramientas cuentan con sus protecciones y mantención al día', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'control_sensibles', label: 'Se protege a las personas trabajadoras especialmente sensibles según su condición', kind: 'cumple_nocumple_na_obs' },
      { id: 'control_colectiva', label: 'Se privilegia la protección colectiva por sobre la individual', kind: 'cumple_nocumple_na_obs' },
      { id: 'control_epp_entrega', label: 'Los EPP exigidos por cargo se entregan, registran y reponen sin costo para la persona', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'control_epp_mantencion', label: 'Existe procedimiento de selección, uso y mantención de EPP', kind: 'cumple_nocumple_na_obs' },
      { id: 'control_permisos', label: 'Las tareas críticas se autorizan mediante permiso de trabajo con controles verificados en terreno', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
      { id: 'control_cambio', label: 'Los cambios de proceso, instalación, equipo o dotación evalúan su impacto en los riesgos antes de aprobarse', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'emergencias',
    title: '9. Preparación y respuesta ante emergencias',
    description: 'DS 44 art. 18 y 19 · ISO 45001 §8.2',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'emergencia_plan', label: 'Existe plan de gestión, reducción y respuesta ante emergencias, catástrofes o desastres', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
      { id: 'emergencia_informado', label: 'Las personas trabajadoras están informadas de los riesgos, los mecanismos de actuación y el procedimiento de evacuación', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'emergencia_simulacro', label: 'El plan se ensayó al menos una vez en los últimos doce meses simulando una emergencia real', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'emergencia_equipos', label: 'Los equipos de emergencia (extintores, botiquines, camillas) están operativos y dentro de su vigencia', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'emergencia_riesgo_grave', label: 'Existe procedimiento ante riesgo grave e inminente, con derecho a interrumpir la tarea', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
    ],
  },
  {
    id: 'coordinacion',
    title: '10. Coordinación de la actividad preventiva',
    description: 'DS 44 art. 20 · aplica cuando dos o más empleadores comparten el lugar de trabajo',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'coordinacion_informacion_recibida', label: 'Se recibió del mandante y de las demás empresas la información de sus riesgos, medidas y planes de emergencia', kind: 'cumple_nocumple_na_obs' },
      { id: 'coordinacion_informacion_entregada', label: 'Se entregó a las demás empresas la información de los riesgos propios, medidas adoptadas y plan de emergencia', kind: 'cumple_nocumple_na_obs' },
      { id: 'coordinacion_incorporada', label: 'La información recibida se incorporó a la gestión de riesgos propia', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'vigilancia',
    title: '11. Vigilancia del ambiente y de la salud',
    description: 'DS 44 art. 67 a 70 · protocolos MINSAL',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'vigilancia_agentes', label: 'Están identificados los agentes con límite permisible y los grupos de exposición similar', kind: 'cumple_nocumple_na_obs' },
      { id: 'vigilancia_mediciones', label: 'Existen mediciones vigentes comparadas contra el límite permisible y el nivel de acción', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'vigilancia_protocolos', label: 'Los protocolos MINSAL aplicables están implementados y con cobertura vigente', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'vigilancia_examenes', label: 'Las personas en vigilancia asisten a sus exámenes y el resultado se gestiona con reserva de la información clínica', kind: 'cumple_nocumple_na_obs' },
      { id: 'vigilancia_prescripciones', label: 'Las medidas prescritas por el organismo administrador se implementaron dentro del plazo', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'vigilancia_traslado', label: 'Se traslada o adecúa el puesto cuando la condición de salud lo exige', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'siniestros',
    title: '12. Investigación de siniestros laborales',
    description: 'DS 44 art. 71 · ISO 45001 §10.2',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'siniestros_investigacion', label: 'Todo accidente, incidente peligroso y enfermedad profesional se investiga con la metodología del organismo administrador', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
      { id: 'siniestros_participacion', label: 'La investigación se hace con enfoque de género y con participación de las personas trabajadoras o sus representantes', kind: 'cumple_nocumple_na_obs' },
      { id: 'siniestros_denuncias', label: 'Las denuncias DIAT y DIEP se cursaron dentro de plazo', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'siniestros_capa', label: 'Cada investigación deriva en medidas correctivas con responsable, plazo y verificación de eficacia', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'siniestros_reincidencia', label: 'Se verifica que las medidas evitaron la repetición del evento', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'registro_indicadores',
    title: '13. Registro documental e indicadores',
    description: 'DS 44 art. 72 a 75 · ISO 45001 §7.5 y §9.1',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'registro_documental', label: 'Toda la información de la gestión preventiva está registrada y respaldada de forma fidedigna, a disposición del fiscalizador', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'registro_incidentes', label: 'Existe registro de todos los incidentes o sucesos peligrosos, con causas y acciones correctivas', kind: 'cumple_nocumple_na_obs' },
      { id: 'registro_accidentes', label: 'Existe registro de accidentes del trabajo, de trayecto y enfermedades profesionales', kind: 'cumple_nocumple_na_obs' },
      { id: 'registro_vigilancia', label: 'Existe registro actualizado de las personas en vigilancia de la salud', kind: 'cumple_nocumple_na_obs' },
      { id: 'registro_desagregacion', label: 'Las estadísticas están desagregadas por sexo', kind: 'cumple_nocumple_na_obs' },
      { id: 'registro_tasas', label: '¿Se calculan y mantienen actualizadas las tasas de accidentabilidad, frecuencia y gravedad conforme al DS N°44?', kind: 'cumple_nocumple_na_obs' },
    ],
  },
  {
    id: 'evaluacion_mejora',
    title: '14. Evaluación del sistema y mejora continua',
    description: 'DS 44 art. 14 y 22 n°4 y n°5 · ISO 45001 §9.2, §9.3 y §10.3',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'evaluacion_programa', label: 'Se evaluó al menos una vez en el último año el cumplimiento del programa de trabajo preventivo', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'evaluacion_eficacia', label: 'La evaluación midió la eficacia de las acciones programadas, no solo su ejecución', kind: 'cumple_nocumple_na_obs' },
      { id: 'evaluacion_auditoria', label: 'Se realiza auditoría periódica del desempeño del Sistema de Gestión', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
      { id: 'evaluacion_direccion', label: 'La dirección revisa los resultados del sistema y define los recursos y mejoras necesarias', kind: 'cumple_nocumple_na_obs' },
      { id: 'evaluacion_mecanismos', label: 'Existen mecanismos permanentes que garantizan la corrección en función de los resultados obtenidos', kind: 'cumple_nocumple_na_obs' },
      { id: 'evaluacion_hallazgos_previos', label: 'Los hallazgos de la auditoría anterior están cerrados o con plan vigente', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
    ],
  },
]
