import type { ChecklistDefinition } from '../types'

/**
 * Checklist Definition — Control de Seguimiento / Post-Incidente
 * Extracted from: "Lista Chequeo Control Seguimiento Trabajadores Antiguos Post Incidente.docx"
 * Revisión 01 — 05/06/2026
 *
 * Conductores Camión Sistema Ampliroll, Batea y Operadores de Maquinaria Pesada
 */
export const LC_SST_002: ChecklistDefinition = {
  code: 'LC-SST-002',
  version: '01',
  revisionDate: '2026-06-05',
  tipo: 'seguimiento',
  title: 'Lista de Chequeo — Control de Seguimiento',
  subtitle: 'Conductores Camión Sistema Ampliroll, Batea y Operadores de Maquinaria Pesada',
  legalFramework: [
    'Ley N°16.744',
    'DS N°44/2024',
    'DS N°594',
    'Ley N°19.300 cuando exista daño ambiental',
    'ISO 45001:2018',
    'Referencia ISO 14001 cuando aplique al SGI'
  ],
  applicableTo:
    'Trabajadores antiguos, trabajadores reincidentes en desviaciones, trabajadores involucrados en incidentes con daño a personas, daño material, daño ambiental, cuasi accidente, incidente de alto potencial, cambio de procedimiento, reincorporación o reforzamiento operacional.',
  objective:
    'Verificar en terreno la eficacia de los procedimientos, capacitaciones y controles definidos para el cargo, confirmando que el trabajador mantiene conductas seguras y cumple los estándares operacionales aplicables.',
  frequencySuggested:
    'Post incidente: evaluación inicial, verificación a 7 días, 15 días y 30 días. Trabajador antiguo sin incidente: evaluación semestral o anual según criticidad, desempeño y matriz de riesgos.',
  evaluationCriteria:
    'Marcar Cumple, No cumple o N/A. Registrar evidencia objetiva. Resultado: Eficaz ≥90% de cumplimiento aplicable y sin desviaciones críticas; Parcialmente eficaz 70%-89%; No eficaz <70% o existencia de desviación crítica/reincidencia.',

  sections: [
    // ============================================================
    // 2. Clasificación del evento, condición o desviación
    // ============================================================
    {
      id: 'clasificacion_evento',
      title: '2. Clasificación del evento, condición o desviación',
      countsForCompliance: false,
      items: [
        {
          id: 'dano_personas',
          label: 'Daño a personas o lesión laboral asociada al trabajo.',
          kind: 'si_no_obs'
        },
        {
          id: 'dano_material',
          label: 'Daño material a equipos, vehículos, instalaciones, carga o terceros.',
          kind: 'si_no_obs'
        },
        {
          id: 'dano_ambiental',
          label: 'Daño ambiental o potencial afectación a suelo, agua, aire, flora, fauna o comunidad.',
          kind: 'si_no_obs'
        },
        {
          id: 'incidente_alto_potencial',
          label: 'Incidente de alto potencial o cuasi accidente.',
          kind: 'si_no_obs'
        },
        {
          id: 'incumplimiento_procedimiento',
          label: 'Incumplimiento de procedimiento de trabajo seguro o instrucción operacional.',
          kind: 'si_no_obs'
        },
        {
          id: 'conducta_insegura',
          label: 'Conducta insegura reiterada, exceso de confianza o desviación conductual.',
          kind: 'si_no_obs'
        },
        {
          id: 'falla_comunicacion',
          label: 'Falla de comunicación, segregación de área, señalización o coordinación de maniobra.',
          kind: 'si_no_obs'
        },
        {
          id: 'condicion_no_controlada',
          label: 'Condición de equipo, accesorio, EPP o entorno no controlada antes de iniciar la tarea.',
          kind: 'si_no_obs'
        }
      ]
    },

    // ============================================================
    // 3. Verificación documental, competencias y reforzamientos
    // ============================================================
    {
      id: 'verificacion_documental',
      title: '3. Verificación documental, competencias y reforzamientos',
      countsForCompliance: true,
      items: [
        {
          id: 'licencia_autorizacion',
          label: 'Licencia de conducir / autorización interna vigente para el equipo asignado.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'examen_ocupacional',
          label: 'Examen ocupacional vigente y compatible con el cargo crítico.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'certificacion_competencias',
          label: 'Certificación o evaluación de competencias vigente para el cargo/equipo.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'registro_induccion',
          label: 'Registro de inducción, ODI o información de riesgos actualizada.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'procedimiento_cargo',
          label: 'Procedimiento de trabajo del cargo difundido, comprendido y firmado.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'procedimiento_do53',
          label: 'Procedimiento de conducción DO-53 u otros aplicable difundido y vigente.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'reforzamiento_piensa_actua',
          label: 'Reforzamiento del programa "Para, Piensa y Actúa" realizado.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'charla_leccion',
          label: 'Charla o difusión de lección aprendida del incidente/desviación realizada.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'procedimiento_alcohol',
          label: 'Procedimiento de alcohol y drogas vigente conocido por el trabajador.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'protocolos_minsal',
          label: 'Protocolos MINSAL aplicables al cargo difundidos, si corresponde.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'entrega_epp',
          label: 'Entrega y estado de EPP verificado según faena, cargo y matriz de riesgos.',
          kind: 'cumple_nocumple_na_obs'
        }
      ]
    },

    // ============================================================
    // 4. Evaluación transversal de cumplimiento de procedimientos críticos
    // ============================================================
    {
      id: 'procedimientos_criticos',
      title: '4. Evaluación transversal de cumplimiento de procedimientos críticos',
      countsForCompliance: true,
      items: [
        {
          id: 'pausa_seguridad',
          label: 'Realiza pausa de seguridad antes de iniciar, reiniciar o cambiar la tarea.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'identifica_peligros',
          label: 'Identifica peligros críticos de la tarea, entorno, equipo y condiciones climáticas.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'evalua_riesgo',
          label: 'Evalúa el riesgo antes de operar: personas cercanas, energía, pendiente, espacio, visibilidad, carga y tránsito.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'aplica_piensa_actua',
          label: 'Aplica el programa "Para, Piensa y Actúa" sin tratarlo como un trámite de papel.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'detiene_tarea',
          label: 'Detiene la tarea ante condiciones inseguras, interferencias o falta de control operacional.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'cumple_procedimiento',
          label: 'Cumple el procedimiento de trabajo seguro de acuerdo con su cargo.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'respeta_zonas',
          label: 'Respeta zonas de tránsito, estacionamiento, segregación y áreas autorizadas.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'distancia_seguridad',
          label: 'Mantiene distancia de seguridad respecto de equipos, estructuras, personas, taludes, bordes y obstáculos.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'comunicacion_radial',
          label: 'Usa comunicación radial, visual o señalero cuando la maniobra lo requiere.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'velocidad_controlada',
          label: 'Mantiene velocidad controlada y acorde a condiciones de ruta, carga, tránsito y visibilidad.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'cinturon_cabina',
          label: 'Usa cinturón de seguridad y verifica cabina libre de elementos sueltos.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'sin_distractores',
          label: 'No usa teléfono u otros distractores durante conducción u operación.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'reporta_condiciones',
          label: 'Reporta condiciones inseguras, daños, fallas mecánicas, derrames o incidentes oportunamente.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'no_improvisa',
          label: 'No improvisa maniobras fuera del estándar ni opera equipos sin autorización.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'conducta_preventiva',
          label: 'Mantiene conducta preventiva y no evidencia exceso de confianza o normalización de desvíos.',
          kind: 'cumple_nocumple_na_obs'
        }
      ]
    },

    // ============================================================
    // 5.1 Control operacional — Conductor Camión Sistema Ampliroll
    // ============================================================
    {
      id: 'control_ampliroll',
      title: '5.1 Conductor Camión Sistema Ampliroll',
      countsForCompliance: true,
      appliesWhen: ['conductor_ampliroll'],
      items: [
        {
          id: 'inspeccion_ampliroll',
          label: 'Inspecciona visualmente camión, sistema hidráulico, gancho/brazo, seguros, mangueras, luces, neumáticos y alarmas antes de operar.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'estabilidad_terreno_amp',
          label: 'Verifica estabilidad del terreno, pendiente, espacio disponible y ausencia de personas en la zona de maniobra.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'maniobra_carga_amp',
          label: 'Realiza maniobra de carga o descarga del contenedor con equipo alineado, velocidad controlada y área segregada.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'bloqueo_contenedor',
          label: 'Confirma bloqueo/aseguramiento del contenedor antes de iniciar traslado.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'sin_elementos_sueltos_amp',
          label: 'No transita con elementos sueltos, contenedor mal posicionado, sobrecarga o carga sin asegurar.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'distancia_segura_amp',
          label: 'Mantiene distancia segura respecto de estructuras, tendidos eléctricos, equipos, bordes y personal de apoyo.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'senalero_amp',
          label: 'Utiliza señalero o apoyo cuando la visibilidad o espacio de maniobra es limitado.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'riesgos_amp',
          label: 'Controla riesgos de atrapamiento, golpeado por, volcamiento, caída de carga y exposición a energía hidráulica.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'reporta_fallas_amp',
          label: 'Reporta fallas del sistema ampliroll y deja fuera de servicio si existe condición crítica.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'procedimiento_especifico_amp',
          label: 'Cumple procedimiento específico de carga, transporte y descarga de contenedores ampliroll.',
          kind: 'cumple_nocumple_na_obs'
        }
      ]
    },

    // ============================================================
    // 5.2 Control operacional — Conductor Camión Batea
    // ============================================================
    {
      id: 'control_batea',
      title: '5.2 Conductor Camión Batea',
      countsForCompliance: true,
      appliesWhen: ['conductor_batea'],
      items: [
        {
          id: 'inspeccion_batea',
          label: 'Inspecciona camión, tolva/batea, compuerta, sistema hidráulico, neumáticos, luces, bocina, alarma de retroceso y elementos de emergencia.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'compatibilidad_carga',
          label: 'Verifica compatibilidad de carga, distribución, peso, altura y estabilidad antes de iniciar traslado.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'conduccion_defensiva',
          label: 'Controla velocidad, distancia de seguimiento y conducción defensiva según ruta, pendiente, carga y condiciones ambientales.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'rutas_autorizadas',
          label: 'Respeta rutas autorizadas, señalización, prioridades de tránsito interno y zonas de descarga.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'verificacion_levantar_batea',
          label: 'Antes de levantar la batea verifica terreno nivelado, ausencia de líneas eléctricas, estructuras, personas y equipos cercanos.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'descarga_segura_batea',
          label: 'Realiza descarga con equipo detenido, frenos aplicados, área segregada y sin exposición de terceros.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'sin_batea_levantada',
          label: 'No circula con batea levantada, compuerta defectuosa, carga sobresaliente o riesgo de caída de material.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'riesgos_batea',
          label: 'Controla riesgos de volcamiento, caída de material, atropello, colisión, atrapamiento y polvo en suspensión.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'reporta_condiciones_batea',
          label: 'Reporta condiciones de ruta, derrames, caída de material o desviaciones del estándar.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'procedimiento_especifico_batea',
          label: 'Cumple procedimiento específico de conducción, transporte, descarga y estacionamiento de camión batea.',
          kind: 'cumple_nocumple_na_obs'
        }
      ]
    },

    // ============================================================
    // 5.3 Control operacional — Operador de Maquinaria Pesada
    // ============================================================
    {
      id: 'control_maquinaria',
      title: '5.3 Operador de Maquinaria Pesada',
      countsForCompliance: true,
      appliesWhen: ['operador_maquinaria_pesada'],
      items: [
        {
          id: 'inspeccion_preoperacional',
          label: 'Realiza inspección preoperacional del equipo: fluidos, neumáticos/orugas, luces, alarma, espejos/cámaras, estructura, implementos y elementos de seguridad.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'verifica_entorno',
          label: 'Verifica entorno de trabajo: personas, equipos, segregación, pendientes, taludes, líneas eléctricas, bordes, excavaciones y estabilidad del terreno.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'tres_puntos_apoyo',
          label: 'Sube y baja del equipo usando tres puntos de apoyo y mantiene cabina ordenada.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'parametros_autorizados',
          label: 'Opera solo dentro de parámetros autorizados del equipo, sin exceder capacidad, alcance o condiciones de estabilidad.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'comunicacion_senalero',
          label: 'Mantiene comunicación efectiva con señalero, supervisor y otros equipos cuando existe interferencia operacional.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'radios_giro',
          label: 'Respeta radios de giro, zonas ciegas, distancias de seguridad y áreas segregadas.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'riesgos_maquinaria',
          label: 'Controla riesgos de atropello, atrapamiento, volcamiento, golpeado por, caída de material y contacto con energía.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'detiene_personal_no_autorizado',
          label: 'Detiene la operación si ingresa personal no autorizado al área de influencia del equipo.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'estacionamiento_seguro',
          label: 'Estaciona en lugar autorizado, implemento apoyado, freno aplicado, motor detenido y equipo asegurado según procedimiento.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'reporta_fallas_maq',
          label: 'Reporta fallas mecánicas, fugas, daños, derrames o condiciones subestándar antes de continuar operando.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'procedimiento_especifico_maq',
          label: 'Cumple procedimiento específico de operación segura de maquinaria pesada del cargo evaluado.',
          kind: 'cumple_nocumple_na_obs'
        }
      ]
    },

    // ============================================================
    // 6. Verificación ambiental (cuando corresponda)
    // ============================================================
    {
      id: 'verificacion_ambiental',
      title: '6. Verificación ambiental (cuando corresponda)',
      countsForCompliance: true,
      items: [
        {
          id: 'aspectos_ambientales',
          label: 'Identifica aspectos ambientales asociados a su tarea: derrames, residuos, polvo, ruido, emisiones, afectación de suelo/agua o comunidad.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'reporte_derrames',
          label: 'Conoce y aplica procedimiento de reporte y contención de derrames o incidentes ambientales.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'kit_emergencia',
          label: 'Cuenta con kit de emergencia ambiental o sabe dónde se encuentra y cómo activarlo.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'manejo_residuos',
          label: 'Maneja residuos, material contaminado o carga de acuerdo con instrucciones de faena.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'zonas_autorizadas_amb',
          label: 'Evita descargar, lavar, botar o intervenir materiales fuera de zonas autorizadas.',
          kind: 'cumple_nocumple_na_obs'
        },
        {
          id: 'reporta_dano_ambiental',
          label: 'Reporta oportunamente daño ambiental, potencial daño o condición con impacto ambiental.',
          kind: 'cumple_nocumple_na_obs'
        }
      ]
    }
  ],

  closingAct: {
    title: '10. Acta de Cierre del Seguimiento',
    resultOptions: [
      { value: 'habilitado_autonomo', label: 'HABILITADO PARA CONTINUAR OPERANDO EN FORMA AUTÓNOMA' },
      { value: 'habilitado_restricciones', label: 'HABILITADO CON RESTRICCIONES' },
      { value: 'requiere_reforzamiento', label: 'REQUIERE REFORZAMIENTO ADICIONAL' },
      { value: 'no_habilitado', label: 'NO HABILITADO TEMPORALMENTE PARA OPERAR' }
    ],
    hasRestrictions: true,
    signatureRoles: ['trabajador', 'supervisor', 'prevencionista', 'jefe_area']
  }
}
