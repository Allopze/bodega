import type { ReactNode } from "react"
import { ChartDataTable, type ChartDataExcel } from "@/components/charts/chart-data-table"
import { ChartFrame, ChartHeadlineCaption, ChartHeadlineValue } from "@/components/charts/chart-frame"
import { ChartSlot } from "@/components/ui/dashboard-panel"
import { RankedList, type RankedListItem } from "@/components/ui/ranked-list"
import { SectionError } from "../consumo/_components/charts/overview-section"

/**
 * Piezas de las secciones de «Indicadores de combustible». Los gráficos de Consumo que se
 * reutilizan no traen marco propio (los pintan `ViewSection`/`ChartSection`); aquí se les da el
 * del tablero —titular con la cifra, ventana y fuente en la descripción, «Ver datos» abajo— para
 * que las tres pantallas de Indicadores se lean igual. Son componentes de servidor.
 */

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
  span?: "one" | "wide" | "full" | "fillXl"
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

/** Ranking de un solo tono con su titular. No dibuja nada sin filas: la celda se oculta (`empty:hidden`). */
export function RankingBlock({
  span = "one",
  title,
  description,
  headline,
  items,
  ariaLabel,
  unit = " L",
  limit = 8,
}: {
  span?: "one" | "wide" | "full" | "fillXl"
  title: string
  description: string
  headline?: BlockHeadline
  items: RankedListItem[]
  ariaLabel: string
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
        <RankedList items={items} format="count" unit={unit} limit={limit} ariaLabel={ariaLabel} />
      </ChartFrame>
    </ChartSlot>
  )
}

/** La consulta de un bloque falló: se dice en su lugar, no se deja un hueco que parezca «sin datos». */
export function BlockError({ what, span = "one" }: { what: string; span?: "one" | "wide" | "full" | "fillXl" }) {
  return (
    <ChartSlot span={span}>
      <div className="p-5"><SectionError what={what} /></div>
    </ChartSlot>
  )
}
