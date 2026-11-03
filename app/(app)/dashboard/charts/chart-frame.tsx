/**
 * Los marcos de gráfico viven en `components/charts/chart-frame.tsx` desde
 * CHART-036 (así `/facturacion` los reutiliza sin depender de la ruta del
 * tablero). Este archivo reexporta sus nombres para los gráficos del tablero.
 */
export { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
