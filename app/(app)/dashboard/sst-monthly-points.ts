/**
 * Serie mensual de indicadores SST para los gráficos del dashboard.
 *
 * Era la única lógica de `dashboard-analytics.tsx`; el resto de ese archivo
 * —`DashboardAnalytics` y su fallback— murió al disolverse el bloque "Analítica
 * y tendencias" en las secciones por dominio (Fase 3). Queda sola en su módulo
 * porque es pura, tiene test propio y la consumen las secciones.
 */
export const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

/** Forma mínima que `toSstMonthlyPoints` necesita de `CanonicalIndicatorResult`. */
interface CanonicalMonthlySlice {
  confirmed: { accidents: number; frequencyRate: number | null; severityRate: number | null }
  provisional: { accidents: number }
}

/**
 * Serie mensual de indicadores SST para los gráficos.
 *
 * `provisional` es confirmados **más** pendientes
 * (`safety-indicators-calc.ts:217-219`), así que la resta da los incidentes que
 * sólo tienen casos por calificar. Es una función exportada y no un `.map()`
 * inline porque es la única lógica de derivación de la sección y necesitaba un
 * test: antes esta misma línea alimentaba una serie rotulada "Accidentes STP"
 * con el superconjunto provisional.
 *
 * El `Math.max(0, …)` sostiene el invariante provisional ⊇ confirmed, que
 * garantiza el motor de cálculo y no el tipo.
 */
export function toSstMonthlyPoints(monthly: CanonicalMonthlySlice[]) {
  return monthly.map((m, index) => ({
    month: MONTH_LABELS[index] ?? `M${index + 1}`,
    tasaFrecuencia: m.confirmed.frequencyRate ?? 0,
    tasaGravedad: m.confirmed.severityRate ?? 0,
    confirmados: m.confirmed.accidents ?? 0,
    porCalificar: Math.max(0, (m.provisional.accidents ?? 0) - (m.confirmed.accidents ?? 0)),
  }))
}
