import type { ChecklistSection } from '../types'

/**
 * Inspección de Carros — módulo 07.
 *
 * Fuente: `docx revisado/07-inspeccion-carros.md`.
 * Actividad PDTP 2026: n=34 ("Revisar y cerrar inspecciones de estado de
 * equipos — carros"). Mismo título que la act. 33 (responsables Sup/JT).
 *
 * Patrón C (multi-sujeto): una instancia por carro. Sujeto = `fuelVehicles`
 * (el carro); el selector filtra por worksiteId de la ejecución.
 *
 * Normalización B/R/M (regla §5): B=cumple · R=no_cumple · M=no_cumple,
 * con el matiz (R vs M) en observación. Todos los ítems usan
 * `cumple_nocumple_na_obs` (NA = no aplica al carro evaluado).
 *
 * Nota: el markdown 07 tiene un bug de numeración ("Pernos rueda" mergeado
 * en la fila de "Llantas", y la sección OTROS reinicia numeración colisionando
 * con DOCUMENTOS). Se transcribe el contenido correcto; los `id` son estables
 * y únicos por sección.
 */
export const CARROS_SECTIONS: ChecklistSection[] = [
  // ============================================================
  // 1. Luces
  // ============================================================
  {
    id: 'luces_carro',
    title: '1. Luces',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'intermitentes',           label: 'Intermitentes.', kind: 'cumple_nocumple_na_obs' },
      { id: 'luces_retroceso',         label: 'Luces de retroceso.', kind: 'cumple_nocumple_na_obs' },
      { id: 'luz_patente',             label: 'Luz de patente.', kind: 'cumple_nocumple_na_obs' },
      { id: 'luz_trasera',             label: 'Luz trasera.', kind: 'cumple_nocumple_na_obs' },
      { id: 'luz_freno',               label: 'Luz de freno.', kind: 'cumple_nocumple_na_obs' },
      { id: 'conexiones_electricas',   label: 'Conexiones eléctricas a camión.', kind: 'cumple_nocumple_na_obs' },
      { id: 'micas',                   label: 'Micas en general.', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 2. Neumáticos
  // ============================================================
  {
    id: 'neumaticos_carro',
    title: '2. Neumáticos',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'desgaste_profundidad',    label: 'Desgaste — profundidad mínima 3 mm.', kind: 'cumple_nocumple_na_obs' },
      { id: 'apriete_tuercas',         label: 'Apriete de tuercas.', kind: 'cumple_nocumple_na_obs' },
      { id: 'freno_neumatico',         label: 'Freno.', kind: 'cumple_nocumple_na_obs' },
      { id: 'llantas',                 label: 'Llantas.', kind: 'cumple_nocumple_na_obs' },
      { id: 'pernos_rueda',            label: 'Pernos de rueda.', kind: 'cumple_nocumple_na_obs' },
      { id: 'cadena_sujecion_repuesto', label: 'Cadena de sujeción del neumático de repuesto.', kind: 'cumple_nocumple_na_obs' },
      { id: 'neumatico_repuesto',      label: 'Neumático de repuesto.', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 3. Documentos
  // ============================================================
  {
    id: 'documentos_carro',
    title: '3. Documentos',
    description: 'Verifique la vigencia de la documentación del carro. Marque No cumple si algún documento está vencido o ausente.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'permiso_circulacion', label: 'Permiso de circulación vigente.', kind: 'cumple_nocumple_na_obs' },
      { id: 'revision_tecnica',    label: 'Revisión técnica vigente.', kind: 'cumple_nocumple_na_obs' },
      { id: 'seguro_obligatorio',  label: 'Seguro obligatorio vigente.', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 4. Otros (estructura y componentes)
  // ============================================================
  {
    id: 'estructura_carro',
    title: '4. Estructura y componentes',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'sistema_tiro',       label: 'Sistema de tiro (muela).', kind: 'cumple_nocumple_na_obs' },
      { id: 'chasis',             label: 'Chasis.', kind: 'cumple_nocumple_na_obs' },
      { id: 'lanza',              label: 'Lanza.', kind: 'cumple_nocumple_na_obs' },
      { id: 'cadenas',            label: 'Cadenas.', kind: 'cumple_nocumple_na_obs' },
      { id: 'plataforma_carga',   label: 'Plataforma de carga.', kind: 'cumple_nocumple_na_obs' },
      { id: 'manguera_aire',      label: 'Manguera de aire.', kind: 'cumple_nocumple_na_obs' },
    ],
  },

  // ============================================================
  // 5. Observaciones generales
  // ============================================================
  {
    id: 'observaciones_carro',
    title: '5. Observaciones generales',
    description: 'Registro libre de hallazgos adicionales del carro inspeccionado.',
    countsForCompliance: false,
    items: [
      {
        id: 'observacion_libre',
        label: 'Observaciones adicionales',
        kind: 'text',
        placeholder: 'Describe observaciones o medidas de control del carro…',
      },
    ],
  },
]
