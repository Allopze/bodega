"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { ChartBar, Truck, Buildings, GasPump } from "@phosphor-icons/react"

interface ReportRow {
  group: string | null
  totalLiters: number
  totalAmount: number
  count: number
}

interface ReportsViewProps {
  byMonth: ReportRow[]
  byWorksite: ReportRow[]
  byVehicle: ReportRow[]
  bySupplier: ReportRow[]
  currentFilters: { startDate?: string; endDate?: string }
}

const formatCLP = (n: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n)
const formatLiters = (n: number) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(n)

export function ReportsView({ byMonth, byWorksite, byVehicle, bySupplier, currentFilters }: ReportsViewProps) {
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
      <div className="flex flex-wrap gap-4 p-4 bg-muted/50 rounded-lg">
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

      {/* Report tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ReportCard title="Por mes" icon={<ChartBar className="h-5 w-5" />} rows={byMonth} />
        <ReportCard title="Por faena" icon={<Buildings className="h-5 w-5" />} rows={byWorksite} />
        <ReportCard title="Por vehículo" icon={<Truck className="h-5 w-5" />} rows={byVehicle} />
        <ReportCard title="Por proveedor" icon={<GasPump className="h-5 w-5" />} rows={bySupplier} />
      </div>
    </div>
  )
}

function ReportCard({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: ReportRow[] }) {
  const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0)
  const totalLiters = rows.reduce((s, r) => s + r.totalLiters, 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        {icon}
        <CardTitle className="text-base">{title}</CardTitle>
        <span className="ml-auto text-sm text-muted-foreground">{formatCLP(totalAmount)}</span>
      </CardHeader>
      <CardContent>
        <Table>
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
      </CardContent>
    </Card>
  )
}
