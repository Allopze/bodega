import type { ChecklistSection } from '../types'

/**
 * Observaciones de Seguridad — módulos 12 (ampliroll) + 13 (maquinaria).
 *
 * Fuente: `docx revisado/12-observacion-camion-ampliroll.md` (PR-SGC-24) y
 * `docx revisado/13-observacion-maquinaria-pesada.md` (PR-SGC-25).
 * Actividades PDTP 2026: n=40 (corregir desviaciones) y n=41 (caminatas/
 * observaciones en terreno).
 *
 * Patrón C (multi-sujeto): una instancia por operador. Sujeto = `workers`
 * (el operador), filtrado por worksiteId de la ejecución.
 *
 * Los markdowns 12/13 comparten ~95% de estructura (22 ítems, 3 fases). Las
 * diferencias terminológicas (ampliroll ↔ equipo rodante) se resuelven con
 * DOS arrays de secciones (`OBSERVACION_AMPLIROLL_SECTIONS` y
 * `OBSERVACION_MAQUINARIA_SECTIONS`) exportados desde este archivo — mismo
 * patrón que trabajador-nuevo/antiguo comparten `*-sections.ts`.
 *
 * Escala Si/No/N/A → `cumple_nocumple_na_obs` (Si=cumple, No=no_cumple,
 * N/A=na). `% = buenas/22`.
 */
export const OBSERVACION_AMPLIROLL_SECTIONS: ChecklistSection[] = [
  // ============================================================
  // 3.1 Inspección al ingreso y término de turno
  // ============================================================
  {
    id: 'ingreso_termino_turno',
    title: '1. Inspección al ingreso y término de turno',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'inspeccion_inicio_turno',   label: 'Inspecciona su equipo al inicio del turno, de acuerdo a reporte de uso diario de equipo (instructivo).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'peldanos_limpios',          label: 'Verifica que los peldaños estén limpios de grasas, aceites, lodos, etc. para evitar caídas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'entrega_camion',            label: 'Hace entrega del camión al colega que ingresa al turno.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'revisa_ampliroll',          label: 'Revisa el equipo ampliroll (gancho, riel, rodillo de guía, aleta de seguridad).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'revisa_emergencia',         label: 'Revisa equipos de emergencia (extintor, cuñas, conos, alarma de retroceso, etc.).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
    ],
  },

  // ============================================================
  // 3.2 En el desplazamiento por planta
  // ============================================================
  {
    id: 'desplazamiento_planta',
    title: '2. En el desplazamiento por planta',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'mira_espejos_marcha',       label: 'Antes de iniciar la marcha mira por los espejos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'respeta_velocidades',      label: 'Respeta velocidades establecidas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'respeta_senales_transito',  label: 'Respeta señales de tránsito establecidas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'distancia_prudente',        label: 'Mantiene distancia prudente al ir detrás de otro equipo móvil.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'usa_cinturon_desplazamiento', label: 'Usa cinturón de seguridad.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'peaton_zonas_demarcadas',   label: 'Como peatón transita por zonas demarcadas y autorizadas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
    ],
  },

  // ============================================================
  // 3.3 En la operación
  // ============================================================
  {
    id: 'operacion',
    title: '3. En la operación',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'detiene_maniobra_persona',  label: 'Detiene la maniobra ante la presencia de una persona en el área de trabajo e informa por radio.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'toca_bocina_peaton',        label: 'Toca la bocina al acercarse a un peatón o equipo móvil para advertir su presencia.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'observa_espejos_maniobra',  label: 'Observa por los espejos antes de realizar cualquier maniobra.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'usa_cinturon_operacion',    label: 'Usa cinturón de seguridad.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'respeta_no_acompanante',    label: 'Respeta no llevar acompañante.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'tres_puntos_apoyo',         label: 'Al bajar y subir del camión usa los tres puntos de apoyo.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'usa_epp',                   label: 'Usa sus elementos de protección personal.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'freno_motor_llaves',        label: 'Al bajar del camión acciona el freno de mano, detiene el motor y retira las llaves; cuando corresponde corta la corriente según procedimiento de bloqueo.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'no_distractores',           label: 'Respeta el no uso de equipos distractorios (celulares, redes sociales) en horas de trabajo.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'respeta_procedimientos',    label: 'Respeta los procedimientos de trabajo que fue capacitado.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'pasador_muela',             label: 'Se asegura que el pasador de la muela esté bien acoplado (la palanca queda en posición vertical; para asegurarse debe realizar un pequeño movimiento hacia adelante y atrás).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
    ],
  },
]

/**
 * Secciones para Observación de Seguridad — Maquinaria Pesada (módulo 13).
 * Diferencias terminológicas vs ampliroll (ítems 2, 3, 4, 9, 17, 19): se
 * referencia "equipo rodante" en lugar de "camión"/"móvil", y el ítem 3
 * reemplaza la revisión ampliroll por equipos adicionales (porta elementos,
 * pala, lanza y garra).
 */
export const OBSERVACION_MAQUINARIA_SECTIONS: ChecklistSection[] = [
  {
    id: 'ingreso_termino_turno',
    title: '1. Inspección al ingreso y término de turno',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'inspeccion_inicio_turno',   label: 'Inspecciona su equipo al inicio del turno, de acuerdo a reporte de uso diario de equipo (instructivo).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'peldanos_limpios',          label: 'Verifica que los peldaños estén limpios de grasas, aceites, lodos, hielo, etc. para evitar caídas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'revisa_equipos_adicionales', label: 'Revisa los equipos adicionales (porta elementos, pala, lanza y garra, pasadores, cilindro y fisuras).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'entrega_equipo',            label: 'Hace entrega del equipo móvil a su colega que ingresa al turno.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'revisa_emergencia',         label: 'Revisa equipos de emergencia (extintor, cuñas, conos, alarma de retroceso, etc.).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
    ],
  },
  {
    id: 'desplazamiento_planta',
    title: '2. En el desplazamiento por planta',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'mira_espejos_marcha',       label: 'Antes de iniciar la marcha mira por los espejos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'respeta_velocidades',      label: 'Respeta velocidades establecidas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'respeta_senales_transito',  label: 'Respeta señales de tránsito establecidas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'distancia_prudente',        label: 'Mantiene distancia prudente al ir detrás de otro equipo rodante.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'usa_cinturon_desplazamiento', label: 'Usa cinturón de seguridad.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'peaton_zonas_demarcadas',   label: 'Como peatón transita por zonas demarcadas y autorizadas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
    ],
  },
  {
    id: 'operacion',
    title: '3. En la operación',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'detiene_maniobra_persona',  label: 'Detiene la maniobra ante la presencia de una persona en el área de trabajo e informa por radio de la situación.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'toca_bocina_peaton',        label: 'Toca la bocina al acercarse a un peatón o equipo móvil para advertir su presencia antes de realizar la maniobra.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'observa_espejos_maniobra',  label: 'Observa por los espejos antes de realizar cualquier maniobra.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'usa_cinturon_operacion',    label: 'Usa cinturón de seguridad.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'respeta_no_acompanante',    label: 'Respeta no llevar acompañante.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'tres_puntos_apoyo',         label: 'Al bajar y subir del equipo rodante usa los tres puntos de apoyo.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'usa_epp',                   label: 'Usa sus elementos de protección personal que entrega la empresa.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'freno_motor_llaves',        label: 'Al bajar del equipo rodante acciona el freno de mano, detiene el motor y retira las llaves; cuando corresponde corta la corriente según procedimiento de bloqueo.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'no_distractores',           label: 'Respeta el no uso de equipos distractorios en las horas de trabajo (celulares, redes sociales).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'respeta_procedimientos',    label: 'Respeta los procedimientos de trabajo que fue capacitado.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'pasador_muela',             label: 'Se asegura que el pasador de la muela esté bien acoplado (la palanca queda en posición vertical; para asegurarse debe realizar un pequeño movimiento hacia adelante y atrás).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
    ],
  },
]
