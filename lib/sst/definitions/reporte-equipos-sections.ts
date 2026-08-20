import type { ChecklistItem, ChecklistSection } from '../types'

/**
 * Reporte de Equipos — checklist diario del operador de maquinaria.
 *
 * Fuente: formulario en papel "REPORTE DE EQUIPOS" (talonario correlativo,
 * triple firma), transcrito contra la plantilla corregida 2026-08-19 y
 * contrastado con el ejemplar N° 03101 lleno. Actividades PDTP 2026 n=25 y
 * n=28 ("Report de uso diario de equipos").
 *
 * Patrón C (multi-sujeto): una instancia por equipo y por turno. Sujeto =
 * `fuelVehicles` vía `subjectVehicleId` del run.
 *
 * Quién lo llena: el papel lo completa el operador en terreno y lo sube el
 * **jefe de faena** (`jefe_terreno` en RBAC). Los conductores no tienen cuenta
 * en la plataforma, así que operador entrante y saliente son campos de texto y
 * la evidencia legal de las firmas es la foto del papel adjunta al run.
 *
 * ── Fidelidad posicional (obligatoria, no estética) ──────────────────────
 * El papel es UNA tabla de 25 filas con cuatro columnas de marca:
 * CAMIÓN/MAQUINARIA {NORMAL, FALLA} y ACOPLADO (SI APLICA) {NORMAL, FALLA}.
 *
 * Por eso:
 *   1. Las 25 filas van EN EL ORDEN DEL PAPEL. Las tres secciones sólo
 *      reproducen las llaves "Exclusivo" del margen izquierdo; concatenadas
 *      dan exactamente las filas 1-25.
 *   2. La sección de acoplado es un ESPEJO EXACTO de las mismas 25 filas,
 *      generado con `mirrorForAcoplado` y no escrito a mano, para que no pueda
 *      derivar.
 *
 * El detector de marcas lee por posición de celda: la fila N de la columna
 * ACOPLADO necesita un ítem donde escribir, y ese ítem debe ser el espejo de
 * la fila N del camión. Un subconjunto elegido a criterio —como el que tenía
 * antes esta definición— deja huérfanas 17 de las 25 filas y hace imposible el
 * mapeo.
 *
 * ── Escalas ──────────────────────────────────────────────────────────────
 * El papel es NORMAL/FALLA, binario y sin estado intermedio. Se transcribe a
 * `cumple_nocumple_na_obs` (NORMAL=cumple, FALLA=no cumple) y el N/A cubre las
 * celdas que el papel deja en blanco por no aplicar al equipo.
 *
 * `countsForCompliance: false` en el acoplado y en los dos bloques "Exclusivo"
 * es deliberado y no es una laguna: `deriveFindings` no mira ese flag, así que
 * una FALLA ahí genera hallazgo igual. Lo que evita es obligar a justificar por
 * escrito decenas de "No aplica" cada vez que el equipo no tiene acoplado ni es
 * cargador frontal — `assessRunCompletion` exige responder todo ítem que
 * puntúa, y con `true` el formulario sería impasable para un camión simple.
 */

/* ── Filas 1-19 · comunes ─────────────────────────────────────────────────── */
const FILAS_COMUNES: ChecklistItem[] = [
  { id: 'luces',                   label: 'Luces.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
  { id: 'baliza',                  label: 'Baliza.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'bocina',                  label: 'Bocina.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
  { id: 'alarma_retroceso',        label: 'Alarma de retroceso.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
  { id: 'fuga_aceite_frenos',      label: 'Fuga de aceite / frenos.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
  { id: 'espejos',                 label: 'Espejos.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'cinturon_seguridad',      label: 'Cinturón de seguridad.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
  // Filas 8-9: el papel las agrupa bajo la llave "ESTADO DE FRENOS".
  { id: 'freno_servicio',          label: 'Estado de frenos — de servicio (pedal de freno).', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
  { id: 'freno_estacionamiento',   label: 'Estado de frenos — de estacionamiento (freno de mano).', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
  { id: 'estado_carroceria',       label: 'Estado de carrocería.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'leve' },
  { id: 'neumaticos_llantas',      label: 'Estado de neumáticos y llantas.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
  { id: 'nivel_agua',              label: 'Nivel de agua.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'nivel_aceite_motor',      label: 'Nivel de aceite motor (motor detenido 3 minutos).', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'nivel_aceite_hidraulico', label: 'Nivel de aceite hidráulico (motor detenido 3 minutos).', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'extintor',                label: 'Extintor.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
  { id: 'tableros_instrumentos',   label: 'Tableros de instrumentos.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'direccion',               label: 'Funcionamiento de la dirección (suave y sin holguras).', kind: 'cumple_nocumple_na_obs', danoPotencial: 'fatal' },
  { id: 'estado_asiento',          label: 'Estado del asiento.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'pernos_tuercas_rueda',    label: 'Estado de pernos y tuercas de rueda.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
]

/* ── Filas 20-24 · exclusivo cargador frontal y excavadora ────────────────── */
const FILAS_CARGA: ChecklistItem[] = [
  { id: 'estado_rotor',          label: 'Estado de rotor.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'estado_garra',          label: 'Estado de garra.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'estado_link_pasadores', label: 'Estado de link y pasadores.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
  { id: 'estado_orugas',         label: 'Estado orugas.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
  { id: 'estado_balde',          label: 'Estado balde.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'moderado' },
]

/* ── Fila 25 · exclusivo camión ───────────────────────────────────────────── */
const FILAS_CAMION: ChecklistItem[] = [
  { id: 'estado_ampliroll', label: 'Estado de ampliroll.', kind: 'cumple_nocumple_na_obs', danoPotencial: 'grave' },
]

/** Las 25 filas del papel, en orden. El detector mapea por este índice. */
export const REPORTE_EQUIPOS_FILAS: readonly ChecklistItem[] = [
  ...FILAS_COMUNES, ...FILAS_CARGA, ...FILAS_CAMION,
]

/**
 * Espejo de una fila para la columna ACOPLADO (SI APLICA).
 *
 * Se genera, no se escribe: el papel usa la misma fila para las dos columnas,
 * así que cualquier divergencia entre ambas listas sería un error de
 * transcripción esperando a ocurrir.
 */
function mirrorForAcoplado(item: ChecklistItem): ChecklistItem {
  return { ...item, id: `acoplado_${item.id}`, label: `Acoplado — ${item.label.charAt(0).toLowerCase()}${item.label.slice(1)}` }
}

export const REPORTE_EQUIPOS_SECTIONS: ChecklistSection[] = [
  // ============================================================
  // 1. Identificación del turno
  // ============================================================
  {
    id: 'identificacion',
    title: '1. Identificación del turno',
    description: 'La faena, la fecha y el equipo salen del encabezado de la inspección; acá va lo que el papel pide además.',
    countsForCompliance: false,
    items: [
      { id: 'turno', label: 'Turno.', kind: 'select', required: true, options: [
        { value: 'dia', label: 'Día' },
        { value: 'tarde', label: 'Tarde' },
        { value: 'noche', label: 'Noche' },
      ] },
      { id: 'area_trabajo',      label: 'Área de trabajo.', kind: 'text', required: true, placeholder: 'Ej: Patio madera' },
      { id: 'operador_entrante', label: 'Operador entrante.', kind: 'text', required: true, placeholder: 'Nombre y apellido' },
      { id: 'operador_saliente', label: 'Operador saliente.', kind: 'text', placeholder: 'Nombre y apellido' },
      { id: 'folio_papel',       label: 'N° de reporte en papel.', kind: 'text', placeholder: 'Ej: 03101' },
    ],
  },

  // ============================================================
  // 2. Horómetro
  // ============================================================
  {
    id: 'horometro',
    title: '2. Horómetro / odómetro',
    description: 'Lectura al iniciar y al terminar el turno. Sin separador de miles.',
    countsForCompliance: false,
    items: [
      { id: 'horometro_inicio',  label: 'Horómetro inicio.', kind: 'number', required: true, placeholder: '134122' },
      { id: 'horometro_termino', label: 'Horómetro término.', kind: 'number', required: true, placeholder: '135120' },
    ],
  },

  // ============================================================
  // 3. Control de mantención
  // ============================================================
  {
    id: 'control_mantencion',
    title: '3. Control de mantención',
    description: 'HR/KM faltantes para la próxima mantención y servicios realizados durante el turno.',
    countsForCompliance: false,
    items: [
      { id: 'faltante_ac_motor',       label: 'HR/KM faltantes: AC motor.', kind: 'number', placeholder: 'Sin separador de miles' },
      { id: 'faltante_ac_transmision', label: 'HR/KM faltantes: AC transmisión.', kind: 'number' },
      { id: 'faltante_ac_corona',      label: 'HR/KM faltantes: AC corona.', kind: 'number' },
      { id: 'faltante_otro',           label: 'HR/KM faltantes: otro.', kind: 'number' },
      { id: 'lavado_hora_1',           label: 'Lavado — hora 1.', kind: 'text', placeholder: 'HH:MM' },
      { id: 'lavado_hora_2',           label: 'Lavado — hora 2.', kind: 'text', placeholder: 'HH:MM' },
      { id: 'sopleteo_hora_1',         label: 'Sopleteo — hora 1.', kind: 'text', placeholder: 'HH:MM' },
      { id: 'sopleteo_hora_2',         label: 'Sopleteo — hora 2.', kind: 'text', placeholder: 'HH:MM' },
      { id: 'sopleteo_hora_3',         label: 'Sopleteo — hora 3.', kind: 'text', placeholder: 'HH:MM' },
      { id: 'engrase_hora_1',          label: 'Engrase — hora 1.', kind: 'text', placeholder: 'HH:MM' },
      { id: 'carga_combustible',       label: 'Carga de combustible (litros).', kind: 'number' },
    ],
  },

  // ============================================================
  // 4-6. Estado del camión / maquinaria — filas 1 a 25 del papel
  // ============================================================
  {
    id: 'estado_camion',
    title: '4. Estado del camión / maquinaria',
    description: '¡Importante! Avisar al supervisor de turno en caso de falla de estos ítems.',
    countsForCompliance: true,
    hasActionCorrectiva: true,
    items: FILAS_COMUNES,
  },
  {
    id: 'exclusivo_carga',
    title: '5. Exclusivo cargador frontal y excavadora',
    description: 'Importante: si falla uno de estos ítems, avisar al supervisor. Déjala sin responder si el equipo no corresponde.',
    countsForCompliance: false,
    hasActionCorrectiva: true,
    items: FILAS_CARGA,
  },
  {
    id: 'exclusivo_camion',
    title: '6. Exclusivo camión',
    description: 'Déjala sin responder si el equipo no lleva ampliroll.',
    countsForCompliance: false,
    hasActionCorrectiva: true,
    items: FILAS_CAMION,
  },

  // ============================================================
  // 7. Acoplado (si aplica) — espejo exacto de las 25 filas
  // ============================================================
  {
    id: 'estado_acoplado',
    title: '7. Acoplado (si aplica)',
    description: 'Segunda columna de marca del papel. Déjala sin responder entera si el equipo no lleva acoplado.',
    countsForCompliance: false,
    hasActionCorrectiva: true,
    items: REPORTE_EQUIPOS_FILAS.map(mirrorForAcoplado),
  },

  // ============================================================
  // 8. Observaciones
  // ============================================================
  {
    id: 'observaciones',
    title: '8. Observaciones del turno',
    countsForCompliance: false,
    items: [
      { id: 'observaciones', label: 'Observaciones.', kind: 'textarea', placeholder: 'Ej: alarma nivel de sonido muy bajo. Bocina no funciona.' },
      { id: 'solucionado',   label: 'Solucionado durante el turno.', kind: 'textarea', placeholder: 'Ej: se traslada a taller con orden de trabajo.' },
    ],
  },
]
