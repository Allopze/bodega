import type { ChecklistSection } from '../types'

/**
 * Inspección de Equipos Móviles — módulo 05.
 *
 * Fuente: `docx revisado/05-inspeccion-equipos-moviles.md`.
 * Actividad PDTP 2026: n=33 ("Lista de chequeo estado de equipos y
 * documentación de maquinarias").
 *
 * Patrón C (multi-sujeto): una instancia por equipo/vehículo. Sujeto =
 * `fuelVehicles`, filtrado por worksiteId de la ejecución.
 *
 * Normalización de escalas (regla §5):
 *   §3.1 DOCUMENTOS usa Cumple/No cumple/N/A → `cumple_nocumple_na_obs`.
 *   §3.2–3.8 usan Buen Estado/Mal Estado/N/A (binario) → igualmente
 *   `cumple_nocumple_na_obs` (Buen Estado=cumple, Mal Estado=no_cumple).
 *
 * Aplicabilidad condicional: el markdown marca ítems "Solo camión carretera"
 * (gata, cruceta, botiquín, caja herramientas, rueda repuesto, linterna) e
 * ítems ampliroll. En v1 esos ítems se declaran sin `appliesWhen` (universales)
 * y el inspector marca N/A cuando no aplican al equipo evaluado. El gating
 * real por equipmentTypeId es un refinamiento posterior (requiere pasar el
 * tipo de equipo como cargoKey a calculateInstanceCompliance).
 *
 * DOCUMENTOS = fuente de verdad cruzada (§5.1): los 4 ítems documentales
 * (licencia, permiso circulación, revisión técnica, seguro) se pre-cargan
 * desde `fuelVehicles.*ExpiresAt` en el selector (Fase C UI). Aquí se declaran
 * como ítems normales para capturar la verificación.
 *
 * Nota: el markdown 05 tiene una colisión de numeración (§3.7 Calefacción
 * 42-43, §3.8 Estado Mecánico reinicia en 42). Se transcribe el contenido
 * correcto; los `id` son estables y únicos por sección.
 */
export const EQUIPOS_MOVILES_SECTIONS: ChecklistSection[] = [
  // ============================================================
  // 3.1 Documentos
  // ============================================================
  {
    id: 'documentos_equipo',
    title: '1. Documentos',
    description: 'Vigencia de la documentación del equipo. Los vencimientos se pre-cargan desde flota cuando el equipo tiene registro; marque No cumple si está vencido o ausente.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'licencia_conduccion',  label: 'Licencia de conducción vigente.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'permiso_circulacion',  label: 'Permiso de circulación vigente.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'leve',
      },
      { id: 'revision_tecnica',     label: 'Revisión técnica vigente.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'seguro_obligatorio',   label: 'Seguro obligatorio (SOAP) vigente.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'leve',
      },
    ],
  },

  // ============================================================
  // 3.2 Estado general cabina
  // ============================================================
  {
    id: 'estado_cabina',
    title: '2. Estado general de cabina',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'plumillas_limpia_parabrisas', label: 'Plumillas, limpiaparabrisas y chorro limpiaparabrisas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'bocina',                      label: 'Bocina.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'escaleras_pasamano',          label: 'Escaleras y pasamano de acceso (tres puntos de apoyo).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'asiento_conductor',           label: 'Asiento del conductor en buen estado.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'cinturon_seguridad',          label: 'Cinturón de seguridad en ambos asientos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'panel_tablero',               label: 'Panel o tablero de instrumentos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'espejo_central',              label: 'Espejo central retrovisor.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'espejos_laterales',           label: 'Espejos laterales retrovisores.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'iluminacion_interior',        label: 'Iluminación interior de cabina.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'patentes',                    label: 'Patentes delantera y trasera.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'leve',
      },
      { id: 'piso_sin_obstaculos',         label: 'Piso en buen estado, sin obstáculos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'alizas_vidrios_manillas',     label: 'Alizas de vidrios y manillas de puerta.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'alarma_retroceso',            label: 'Alarma de retroceso.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'vidrios_estado',              label: 'Vidrios en buen estado.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
    ],
  },

  // ============================================================
  // 3.3 Accesorios de emergencia
  // ============================================================
  {
    id: 'accesorios_emergencia',
    title: '3. Accesorios de emergencia',
    description: 'Marque N/A los accesorios que no aplican al tipo de equipo (p.ej. los marcados "solo camión carretera" en equipos que no salen de planta).',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'gata_hidraulica',         label: 'Gata hidráulica. (Solo camión carretera.)', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'cruceta_copa',            label: 'Cruceta o copa (llave de rueda). (Solo camión carretera.)', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'senales_carretera',       label: 'Señales de carretera (conos y chaleco reflectante).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'cunas',                   label: 'Cuñas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'botiquin',                label: 'Botiquín. (Solo camión carretera.)', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'extintor_incendios',      label: 'Extintor de incendios (mínimo 4 kg PQS).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'caja_herramientas',       label: 'Caja de herramientas básica. (Solo camión carretera.)', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'rueda_repuesto',          label: 'Llanta (rueda) de repuesto. (Solo camión carretera.)', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'linterna',                label: 'Linterna. (Solo camión carretera.)', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
    ],
  },

  // ============================================================
  // 3.4 Luces
  // ============================================================
  {
    id: 'luces_equipo',
    title: '4. Luces',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'direccionales_delanteras', label: 'Direccionales delanteras.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'direccionales_traseras',   label: 'Direccionales traseras.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'trabajo_delanteras',       label: 'Luces de trabajo delanteras (altas, bajas).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'navegacion',               label: 'Luces de navegación.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'frenado',                  label: 'Luces de frenado.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'focos_faenero',            label: 'Focos faenero trasero.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'emergencia_hazzard',       label: 'Luces de emergencia (hazzard) delantera y traseras.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'patente_vehiculo',         label: 'Luz de patente (vehículo que sale de planta).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'leve',
      },
    ],
  },

  // ============================================================
  // 3.5 Sistema levante de cabina
  // ============================================================
  {
    id: 'levante_cabina',
    title: '5. Sistema de levante de cabina',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'pasadores_levante',        label: 'Pasadores completos y en buen estado.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'seguro_manilla_levante',   label: 'Estado del seguro o manilla de levante de cabina o capot.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'sistema_levante',          label: 'Estado del sistema de levante (brazo/cilindro).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
    ],
  },

  // ============================================================
  // 3.6 Ruedas
  // ============================================================
  {
    id: 'ruedas_equipo',
    title: '6. Ruedas',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'huella_minima',        label: 'Huella mínima de 3 mm.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'neumaticos_cortaduras', label: 'Neumáticos sin cortaduras profundas ni abultamientos.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'pernos_ruedas',        label: 'Pernos de ruedas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
    ],
  },

  // ============================================================
  // 3.7 Sistema de calefacción
  // ============================================================
  {
    id: 'calefaccion_equipo',
    title: '7. Sistema de calefacción',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'aire_caliento_frio',  label: 'Estado de aire caliente y frío.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
      { id: 'aire_acondicionado',  label: 'Aire acondicionado.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'moderado',
      },
    ],
  },

  // ============================================================
  // 3.8 Estado mecánico (incluye frenos/dirección — bloqueo operacional)
  // ============================================================
  {
    id: 'estado_mecanico',
    title: '8. Estado mecánico',
    description: 'Ítems críticos de seguridad operacional. Frenos o dirección en No cumple requieren acción de prioridad alta (sugerencia de fuera de servicio).',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'freno_servicio',         label: 'Freno de servicio en todas las ruedas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'freno_emergencia',       label: 'Freno de emergencia o parqueo.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'direccion_terminales',   label: 'Dirección y terminales.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'amortiguacion',          label: 'Sistema de amortiguación general.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'fugas_hidraulicas',      label: 'Control de fugas hidráulicas: aceite y refrigerante (motor/mangueras/estanque).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'fugas_aire',             label: 'Control de fugas de aire (mangueras, acoples, tecalán).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'caja_cambios',           label: 'Caja de cambios.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'cardan_crucetas',        label: 'Cardán y crucetas.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'bateria_cables',         label: 'Batería, cables y terminales en buen estado.', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'grave',
      },
      { id: 'porta_elementos',        label: 'Porta elementos, pala y garra (pasadores, cilindro y fisuras).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
      { id: 'equipo_ampliroll',       label: 'Equipo ampliroll (ganchos, riel, rodillo de guía, aleta de seguridad, pernos).', kind: 'cumple_nocumple_na_obs',
        danoPotencial: 'fatal',
      },
    ],
  },

  // ============================================================
  // 3.9 Observaciones generales
  // ============================================================
  {
    id: 'observaciones_equipo',
    title: '9. Observaciones generales',
    description: 'Registro libre de hallazgos adicionales del equipo inspeccionado.',
    countsForCompliance: false,
    items: [
      {
        id: 'observacion_libre',
        label: 'Observaciones adicionales',
        kind: 'text',
        placeholder: 'Describe observaciones o medidas de control del equipo…',
      },
    ],
  },
]
