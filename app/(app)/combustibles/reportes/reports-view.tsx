"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChartBar, Truck, Buildings, GasPump, CalendarBlank } from "@phosphor-icons/react"
import { MonthlyEvolutionChart, CategoryBarChart, ProductPieChart } from "../fuel-charts"

interface ReportRow {
  group: string | null
  totalLiters: number
  totalAmount: number
  count?: number
}

interface ChartDataPoint {
  group: string | null
  totalLiters: number
  totalAmount: number
  count?: number
}

interface ReportsViewProps {
  byMonth: ReportRow[]
  byWeek: ReportRow[]
  byWorksite: ReportRow[]
  byVehicle: ReportRow[]
  bySupplier: ReportRow[]
  byProduct: ChartDataPoint[]
  currentFilters: { startDate?: string; endDate?: string }
}

const formatCLP = (n: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n)
const formatLiters = (n: number) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(n)

export function ReportsView({ byMonth, byWeek, byWorksite, byVehicle, bySupplier, byProduct, currentFilters }: ReportsViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setDateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`/combustibles/reportes?${params.toString()}`)
  }

  return (
    <div className="space-y-6">
      {/* Date filters */}
      <div className="flex flex-wrap gap-4 p-4 bg-[var(--color-surface-2)] rounded-lg">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Desde</Label>
          <Input type="date" className="w-44" defaultValue={currentFilters.startDate ?? ""} onChange={(e) => setDateFilter("desde", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" className="w-44" defaultValue={currentFilters.endDate ?? ""} onChange={(e) => setDateFilter("hasta", e.target.value)} />
        </div>
        <div className="flex items-end">
          <Button variant="ghost" size="sm" onClick={() => router.push("/combustibles/reportes")}>Limpiar</Button>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Evolución mensual</CardTitle></CardHeader>
          <CardContent><MonthlyEvolutionChart data={byMonth} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Por producto</CardTitle></CardHeader>
          <CardContent><ProductPieChart data={byProduct} /></CardContent>
        </Card>
      </div>

      {/* Weekly + Tables */}
      <Tabs defaultValue="weekly">
        <TabsList>
          <TabsTrigger value="weekly"><CalendarBlank className="h-4 w-4 mr-1" />Semanal</TabsTrigger>
          <TabsTrigger value="monthly"><ChartBar className="h-4 w-4 mr-1" />Mensual</TabsTrigger>
          <TabsTrigger value="worksite"><Buildings className="h-4 w-4 mr-1" />Por faena</TabsTrigger>
          <TabsTrigger value="vehicle"><Truck className="h-4 w-4 mr-1" />Por vehículo</TabsTrigger>
          <TabsTrigger value="supplier"><GasPump className="h-4 w-4 mr-1" />Por proveedor</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly"><ReportCard title="Consumo semanal" icon={<CalendarBlank className="h-5 w-5" />} rows={byWeek} /></TabsContent>
        <TabsContent value="monthly"><ReportCard title="Consumo mensual" icon={<ChartBar className="h-5 w-5" />} rows={byMonth} /></TabsContent>
        <TabsContent value="worksite">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CategoryBarChart data={byWorksite} title="Faenas" />
            <ReportCard title="Por faena" icon={<Buildings className="h-5 w-5" />} rows={byWorksite} />
          </div>
        </TabsContent>
        <TabsContent value="vehicle">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CategoryBarChart data={byVehicle} title="Vehículos" />
            <ReportCard title="Por vehículo" icon={<Truck className="h-5 w-5" />} rows={byVehicle} />
          </div>
        </TabsContent>
        <TabsContent value="supplier"><ReportCard title="Por proveedor" icon={<GasPump className="h-5 w-5" />} rows={bySupplier} /></TabsContent>
      </Tabs>
    </div>
  )
}

function ReportCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: ReportRow[] }) {
  const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        {icon}
        <CardTitle className="text-base">{title}</CardTitle>
        <span className="ml-auto text-sm text-muted-foreground">{formatCLP(totalAmount)}</span>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <Table className="min-w-[500px]">
          <TableHeader>
            <TableRow>
              <TableHead>Grupo</TableHead>
              <TableHead className="text-right">Litros</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Cargas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground text-sm">Sin datos</TableCell></TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.group ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatLiters(r.totalLiters)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCLP(r.totalAmount)}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  )
}
