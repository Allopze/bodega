import type { ReactNode } from "react"
import { ChartDataTable, type ChartDataExcel } from "@/components/charts/chart-data-table"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { BarRankingChartLazy } from "@/components/charts/bar-ranking-chart-lazy"
import type { BarRankingItem } from "@/components/charts/bar-ranking-chart"
import { layoutChartSlots, type SlotKind, type SlotSpan } from "@/lib/indicators/chart-layout"
import { SectionError } from "../consumo/_components/charts/overview-section"

/**
 * Piezas de las secciones de «Indicadores de combustible». Los gráficos de Consumo que se
 * reutilizan no traen marco propio (los pintan `ViewSection`/`ChartSection`); aquí se les da el
 * del tablero —titular con la cifra, ventana y fuente en la descripción, «Ver datos» abajo— para
 * que las tres pantallas de Indicadores se lean igual. Son componentes de servidor.
 */

/**
 * Ancho de cada gráfico según cuáles se dibujan (`present[i]`: con datos o con su aviso de error).
 * Todos son del tipo «uno»: dos por fila en `xl`, tres en `2xl`, y `layoutChartSlots` sólo ensancha
 * una celda para cerrar la fila. Un gráfico ausente devuelve `null` y no cuenta para el reparto.
 */
export function chartSpans(present: readonly boolean[]): (SlotSpan | null)[] {
  const spans = layoutChartSlots(present.filter(Boolean).map((): SlotKind => "one"))
  let next = 0
  return present.map((isPresent) => (isPresent ? (spans[next++] ?? "one") : null))
}

export interface BlockHeadline {
  value: string
  caption: string
}

export interface BlockTable {
  caption: string
  headers: string[]
  rows: string[][]
  excel?: ChartDataExcel
}

/** Un gráfico reutilizado, en su celda del panel y con su «Ver datos». */
export function ChartBlock({
  span = "one",
  title,
  description,
  headline,
  table,
  children,
}: {
  span?: SlotSpan
  title: string
  description: string
  headline?: BlockHeadline
  table?: BlockTable
  children: ReactNode
}) {
  return (
    <ChartSlot span={span}>
      <ChartFrame
        title={title}
        description={description}
        headline={headline ? (
          <>
            <ChartHeadlineValue>{headline.value}</ChartHeadlineValue>
            <ChartHeadlineCaption>{headline.caption}</ChartHeadlineCaption>
          </>
        ) : undefined}
      >
        {children}
        {table ? <ChartDataTable caption={table.caption} headers={table.headers} rows={table.rows} excel={table.excel} /> : null}
      </ChartFrame>
    </ChartSlot>
  )
}

/**
 * Ranking de un solo tono como barras horizontales, con su titular y su «Ver datos» (el gráfico
 * reemplaza a la lista legible: la tabla trae todas las filas, el gráfico las `limit` primeras).
 * No dibuja nada sin filas: la celda se oculta (`empty:hidden`).
 */
export function RankingBlock({
  span = "one",
  title,
  description,
  headline,
  items,
  ariaLabel,
  table,
  unit = " L",
  limit = 8,
}: {
  span?: SlotSpan
  title: string
  description: string
  headline?: BlockHeadline
  items: BarRankingItem[]
  ariaLabel: string
  table?: BlockTable
  unit?: string
  limit?: number
}) {
  if (items.length === 0) return null
  return (
    <ChartSlot span={span}>
      <ChartFrame
        title={title}
        description={description}
        headline={headline ? (
          <>
            <ChartHeadlineValue>{headline.value}</ChartHeadlineValue>
            <ChartHeadlineCaption>{headline.caption}</ChartHeadlineCaption>
          </>
        ) : undefined}
      >
        <BarRankingChartLazy items={items} ariaLabel={ariaLabel} unit={unit} order="desc" limit={limit} />
        {table ? <ChartDataTable caption={table.caption} headers={table.headers} rows={table.rows} excel={table.excel} /> : null}
      </ChartFrame>
    </ChartSlot>
  )
}

/** La consulta de un bloque falló: se dice en su lugar, no se deja un hueco que parezca «sin datos». */
export function BlockError({ what, span = "one" }: { what: string; span?: SlotSpan }) {
  return (
    <ChartSlot span={span}>
      <div className="p-5"><SectionError what={what} /></div>
    </ChartSlot>
  )
}
