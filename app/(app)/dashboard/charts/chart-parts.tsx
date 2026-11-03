/**
 * Las piezas compartidas de los gráficos por mes viven en
 * `components/charts/chart-parts.tsx` desde CHART-036 (así los gráficos que se
 * reutilizan fuera del tablero no dependen de su ruta). Este archivo reexporta
 * sus nombres para los gráficos del tablero.
 *
 * Reexportación con nombres y no `export *`: el módulo de origen es un límite de
 * cliente y Next no admite `export *` sobre uno.
 */
export {
  COUNT_DOMAIN,
  InteractiveLegend,
  SERIES_FADE_CLASS,
  SURFACE,
  activeDotFor,
  dimmedBarShape,
  emphasizedTick,
  lastPointDot,
  monthFullName,
  monthTitle,
  niceCountMax,
  partialTailLineShape,
  useChartUid,
  useSeriesFocus,
} from "@/components/charts/chart-parts"
export type { LegendEntry, SeriesFocus } from "@/components/charts/chart-parts"
