"use client"

import * as React from "react"
import { CaretRight } from "@phosphor-icons/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CategoryBarChart, MonthlyEvolutionChart } from "../fuel-charts-lazy"

interface ChartPoint {
  group: string | null
  totalLiters: number
  totalAmount: number
  count?: number
}

export interface InvoiceChartData {
  byMonth: ChartPoint[]
  byProduct: ChartPoint[]
  byWorksite: ChartPoint[]
  byEquipment: ChartPoint[]
}

/**
 * «Gráficos de facturación», plegados: la pregunta de la pantalla es qué se
 * facturó y se paga, y esa respuesta es la lista. Los cuatro gráficos de antes
 * (evolución mensual, gasto por producto, faenas y equipos con más gasto) siguen
 * aquí para quien los quiere. Recharts pesa, así que no se monta hasta abrirlos.
 */
export function InvoiceCharts({ data }: { data: InvoiceChartData }) {
  const [open, setOpen] = React.useState(false)

  return (
    <details
      className="group mt-6 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
        <CaretRight size={14} weight="bold" aria-hidden className="transition-transform group-open:rotate-90" />
        Gráficos de facturación
        <span className="text-xs font-normal text-[var(--color-text-subtle)]">Evolución del gasto, producto, faenas y equipos</span>
      </summary>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle as="h3" className="text-base">Evolución mensual del gasto</CardTitle></CardHeader>
              <CardContent><MonthlyEvolutionChart data={data.byMonth} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle as="h3" className="text-base">Gasto por producto</CardTitle></CardHeader>
              <CardContent><CategoryBarChart data={data.byProduct} title="Productos" /></CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle as="h3" className="text-base">Faenas con más gasto</CardTitle></CardHeader>
              <CardContent><CategoryBarChart data={data.byWorksite} title="Faenas" /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle as="h3" className="text-base">Equipos con más gasto</CardTitle></CardHeader>
              <CardContent><CategoryBarChart data={data.byEquipment} title="Equipos" /></CardContent>
            </Card>
          </div>
        </div>
      )}
    </details>
  )
}
