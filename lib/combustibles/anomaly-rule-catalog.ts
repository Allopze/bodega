/**
 * Catálogo canónico de reglas de anomalía de combustible.
 *
 * Vive aparte del servicio porque lo consumen dos escritores —el cron, que lo
 * sincroniza en cada corrida, y el script manual de despliegue— y una regla que
 * exista en una lista y no en la otra es una regla que no se dispara nunca.
 *
 * Las severidades replican el fallback que cada detector pasa a `severityOf`,
 * para que sembrar no cambie el comportamiento que el código ya asume.
 */
import type { KNOWN_RULE_CODES } from "./validation"

export interface AnomalyRuleSeed {
  code: (typeof KNOWN_RULE_CODES)[number]
  name: string
  description: string
  severity: "low" | "medium" | "high" | "critical"
  /** Config inicial. Vacía = el detector usa sus valores por omisión. */
  config: Record<string, unknown>
}

export const ANOMALY_RULE_CATALOG: AnomalyRuleSeed[] = [
  { code: "rendimiento_fuera_historico", name: "Rendimiento fuera del historial del equipo", severity: "high", config: { thresholdStdDevs: 2 },
    description: "El rendimiento se aleja de la media histórica del propio equipo más allá del umbral configurado." },
  { code: "rendimiento_fuera_grupo", name: "Rendimiento fuera del grupo comparable", severity: "medium", config: { thresholdStdDevs: 2 },
    description: "El rendimiento se aleja del de los equipos comparables del mismo grupo." },
  { code: "litros_supera_capacidad", name: "Litros superiores a capacidad del estanque", severity: "critical", config: { margin: 0.05 },
    description: "La carga supera la capacidad declarada del equipo más un margen configurable." },
  { code: "sello_repetido", name: "Sello repetido", severity: "high", config: {},
    description: "Un número de sello aparece en más de una carga TAE." },
  { code: "sello_no_correlativo", name: "Sello no correlativo", severity: "medium", config: {},
    description: "El sello instalado no coincide con el retirado en la carga siguiente." },
  { code: "evidencia_faltante", name: "Evidencia faltante en carga TAE", severity: "medium",
    config: { requiredKinds: ["odometer", "liter_meter", "removed_seal", "installed_seal"] },
    description: "La carga TAE no adjunta todas las fotografías exigidas." },
  { code: "evidencia_duplicada", name: "Evidencia duplicada por hash", severity: "low", config: {},
    description: "La misma imagen respalda más de una carga." },
  { code: "evidencia_ilegible", name: "Evidencia ilegible o corrupta", severity: "medium", config: {},
    description: "El archivo adjunto está corrupto o no se puede leer." },
  { code: "kilometraje_regresivo", name: "Kilometraje inferior al anterior", severity: "high", config: {},
    description: "La lectura de odómetro es menor que la de la carga anterior del mismo equipo." },
  { code: "horometro_regresivo", name: "Horómetro inferior al anterior", severity: "high", config: {},
    description: "La lectura de horómetro es menor que la de la carga anterior del mismo equipo." },
  // Umbrales por omisión como cotas físicas, no metas de operación: 1.500 km en
  // un día es más de lo que rinde un camión conduciendo sin parar, y un motor no
  // acumula más de 24 horas por día.
  { code: "salto_medidor_implausible", name: "Salto de medidor implausible", severity: "high",
    config: { maxKmPerDay: 1500, maxHoursPerDay: 24 },
    description: "El medidor avanza más de lo posible para los días transcurridos entre dos cargas." },
  { code: "kilometraje_sin_variacion", name: "Kilometraje sin variación respecto a la carga anterior", severity: "medium", config: {},
    description: "Dos cargas consecutivas declaran el mismo odómetro: el equipo no registra recorrido entre ambas." },
  { code: "horometro_sin_variacion", name: "Horómetro sin variación respecto a la carga anterior", severity: "medium", config: {},
    description: "Dos cargas consecutivas declaran el mismo horómetro: el equipo no registra uso entre ambas." },
  { code: "sello_inicial_faltante", name: "Falta sello inicial (retirado)", severity: "medium", config: {},
    description: "La carga TAE no declara el sello retirado." },
  { code: "sello_final_faltante", name: "Falta sello final (instalado)", severity: "medium", config: {},
    description: "La carga TAE no declara el sello instalado." },
  { code: "identidad_incompleta", name: "Conductor o supervisor no verificado en catálogo", severity: "low", config: {},
    description: "La carga TAE no identifica completamente a quien la realizó." },
  { code: "consumo_durante_inactividad", name: "Consumo durante inactividad del equipo", severity: "high", config: {},
    description: "Hay carga registrada en un período en que el equipo estaba declarado fuera de operación." },
  { code: "carga_fuera_horario", name: "Carga fuera de horario operativo", severity: "low", config: {},
    description: "La carga ocurrió fuera del horario de operación declarado del equipo." },
  { code: "carga_faena_distinta", name: "Carga en faena distinta de la asignada al equipo", severity: "medium", config: {},
    description: "La carga se registró en una faena que no es la del equipo." },
  { code: "exceso_cargas_ventana", name: "Exceso de cargas dentro de una ventana temporal", severity: "medium", config: { windowHours: 2, maxLoads: 3 },
    description: "El equipo acumula más cargas de las esperadas dentro de la ventana configurada." },
  { code: "proveedor_no_habitual", name: "Carga facturada con proveedor no habitual", severity: "low", config: {},
    description: "La carga se facturó con un proveedor que no es el declarado para el equipo." },
  { code: "variacion_brusca_consumo", name: "Variación brusca de consumo", severity: "medium", config: { thresholdPct: 50 },
    description: "El consumo del período se aparta del anterior más allá del porcentaje configurado." },
]
