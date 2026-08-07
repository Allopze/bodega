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
 * Escala B/R/M nativa (`bueno_regular_malo_obs`): la leyenda del Anexo 13 es
 * "B= BUENO   R= REGULAR   M= MALO", sin N/A. Regular puntúa 0.5 — ver
 * PARTIAL_STATUS_WEIGHT en `lib/sst/compliance.ts`. Antes se aplanaba a
 * `cumple_nocumple_na_obs` (R y M colapsados en no_cumple), que borraba el
 * grado intermedio que el papel sí registra.
 *
 * Nota: el markdown 07 tiene un bug de numeración ("Pernos rueda" mergeado
 * en la fila de "Llantas", y la sección OTROS reinicia numeración colisionando
 * con DOCUMENTOS). Se transcribe el contenido correcto; los `id` son estables
 * y únicos por sección.
 *
 * Deltas contra el XLS Rev. 00 pendientes de confirmar con el cliente:
 *   · `pernos_rueda` no aparece en el XLS (sí en el markdown 07). Se conserva:
 *     borrar un ítem de seguridad pide confirmación explícita.
 *   · El XLS lista "Gancho" donde el markdown decía "Sistema de tiro (muela)".
 *     Se adopta el rótulo del XLS; el `id` se mantiene para no romper el
 *     historial de respuestas, que va indexado por itemId.
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
      { id: 'intermitentes',           label: 'Intermitentes.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'grave',
      },
      { id: 'luces_retroceso',         label: 'Luces de retroceso.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'grave',
      },
      { id: 'luz_patente',             label: 'Luz de patente.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'leve',
      },
      { id: 'luz_trasera',             label: 'Luz trasera.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'grave',
      },
      { id: 'luz_freno',               label: 'Luz de freno.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'grave',
      },
      { id: 'conexiones_electricas',   label: 'Conexiones eléctricas a camión.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'grave',
      },
      { id: 'micas',                   label: 'Micas en general.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'moderado',
      },
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
      { id: 'desgaste_profundidad',    label: 'Desgaste: profundidad mínima 3 mm.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'apriete_tuercas',         label: 'Apriete de tuercas.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'freno_neumatico',         label: 'Freno.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'llantas',                 label: 'Llantas.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'pernos_rueda',            label: 'Pernos de rueda.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'cadena_sujecion_repuesto', label: 'Cadena de sujeción del neumático de repuesto.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'grave',
      },
      { id: 'neumatico_repuesto',      label: 'Neumático de repuesto.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'moderado',
      },
    ],
  },

  // ============================================================
  // 3. Documentos
  // ============================================================
  {
    id: 'documentos_carro',
    title: '3. Documentos',
    description: 'Verifique la vigencia de la documentación del carro. Marque Malo si algún documento está vencido o ausente, Regular si está por vencer.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: [
      { id: 'permiso_circulacion', label: 'Permiso de circulación vigente.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'leve',
      },
      { id: 'revision_tecnica',    label: 'Revisión técnica vigente.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'grave',
      },
      { id: 'seguro_obligatorio',  label: 'Seguro obligatorio vigente.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'leve',
      },
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
      { id: 'sistema_tiro',       label: 'Gancho.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'chasis',             label: 'Chasis.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'lanza',              label: 'Lanza.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'cadenas',            label: 'Cadenas.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'plataforma_carga',   label: 'Plataforma de carga.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
      { id: 'manguera_aire',      label: 'Manguera de aire.', kind: 'bueno_regular_malo_obs',
        danoPotencial: 'fatal',
      },
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
