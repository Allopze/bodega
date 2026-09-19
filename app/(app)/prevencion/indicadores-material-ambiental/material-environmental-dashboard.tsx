"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { Siren, Wrench, Drop } from "@phosphor-icons/react/dist/ssr"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"

const MaterialEnvironmentalCharts = dynamic(() => import("./material-environmental-charts"), { ssr: false })

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export interface MaterialEnvironmentalData {
  worksiteId: string
  worksiteName: string
  monthly: Array<{
    month: number
    dangerousIncidents: number
    materialDamage: number
    environmentalSpills: number
  }>
  annual: {
    dangerousIncidents: number
    materialDamage: number
    environmentalSpills: number
  }
}

export function MaterialEnvironmentalDashboard({
  worksites: _worksites,
  eventData,
  year,
  currentYear,
}: {
  worksites?: Array<{ id: string; name: string }>
  eventData: MaterialEnvironmentalData[]
  year: number
  currentYear: number
}) {
  const router = useRouter()
  const [selectedWorksiteId, setSelectedWorksiteId] = useState<string>(
    eventData.find((item) => item.worksiteId === "total")?.worksiteId ?? eventData[0]?.worksiteId ?? "",
  )
  const selectedData = eventData.find((item) => item.worksiteId === selectedWorksiteId)

  const totals = useMemo(() => {
    const result = { dangerousIncidents: 0, materialDamage: 0, environmentalSpills: 0, totalEvents: 0 }
    for (const item of eventData) {
      if (item.worksiteId === "total") continue
      result.dangerousIncidents += item.annual.dangerousIncidents
      result.materialDamage += item.annual.materialDamage
      result.environmentalSpills += item.annual.environmentalSpills
    }
    result.totalEvents = result.dangerousIncidents + result.materialDamage + result.environmentalSpills
    return result
  }, [eventData])

  const yearOptions = Array.from({ length: 6 }, (_, index) => currentYear - index)
  if (!yearOptions.includes(year)) yearOptions.push(year)

  if (!selectedData) {
    return <EmptyState title="Sin eventos material o ambiental" description="No se registraron incidentes peligrosos, daños materiales o derrames ambientales en el período seleccionado." />
  }

  return (
    <div className="space-y-4">
      <div role="status" className="rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-4 py-3 text-sm">
        <p className="font-medium">Conteo canónico de eventos · {selectedData.worksiteName}</p>
        <p className="mt-1 text-[var(--color-text-subtle)]">
          Datos extraídos desde el registro de incidentes. Solo se consideran eventos tipo incidente peligroso, daño material y derrame ambiental.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={selectedWorksiteId} onValueChange={setSelectedWorksiteId}>
          <SelectTrigger aria-label="Faena" className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {eventData.map((item) => (
              <SelectItem key={item.worksiteId} value={item.worksiteId}>{item.worksiteName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(value) => router.replace(`/prevencion/indicadores-material-ambiental?year=${value}`, { scroll: false })}>
          <SelectTrigger aria-label="Año" className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {yearOptions.sort((a, b) => b - a).map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        <div className="border-r border-[var(--color-border)] px-4 py-3">
          <span className="text-eyebrow">Total eventos</span>
          <span className="mt-1 block font-mono text-xl font-semibold">{totals.totalEvents}</span>
          <span className="text-xs text-[var(--color-text-subtle)]">Suma de todos los tipos</span>
        </div>
        <div className="border-r border-[var(--color-border)] px-4 py-3">
          <span className="text-eyebrow">Inc. peligrosos</span>
          <span className="mt-1 block font-mono text-xl font-semibold">{selectedData.annual.dangerousIncidents}</span>
          <span className="text-xs text-[var(--color-text-subtle)]">Eventos sin lesión ni daño</span>
        </div>
        <div className="border-r border-[var(--color-border)] px-4 py-3">
          <span className="text-eyebrow">Daño material</span>
          <span className="mt-1 block font-mono text-xl font-semibold">{selectedData.annual.materialDamage}</span>
          <span className="text-xs text-[var(--color-text-subtle)]">Eventos con daño a la propiedad</span>
        </div>
        <div className="px-4 py-3">
          <span className="text-eyebrow">Daño ambiental</span>
          <span className="mt-1 block font-mono text-xl font-semibold">{selectedData.annual.environmentalSpills}</span>
          <span className="text-xs text-[var(--color-text-subtle)]">Derrames y eventos ambientales</span>
        </div>
      </div>

      <Tabs defaultValue="monthly">
        <TabsList>
          <TabsTrigger value="monthly">Desglose mensual</TabsTrigger>
          <TabsTrigger value="charts">Gráficos</TabsTrigger>
          <TabsTrigger value="summary">Resumen por faena</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly">
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead><div className="flex items-center gap-1"><Siren size={14} />Inc. peligrosos</div></TableHead>
                  <TableHead><div className="flex items-center gap-1"><Wrench size={14} />Daño material</div></TableHead>
                  <TableHead><div className="flex items-center gap-1"><Drop size={14} />Daño ambiental</div></TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedData.monthly.map((item) => {
                  const total = item.dangerousIncidents + item.materialDamage + item.environmentalSpills
                  return (
                    <TableRow key={item.month}>
                      <TableCell className="font-medium">{MONTHS[item.month - 1]}</TableCell>
                      <TableCell>{item.dangerousIncidents}</TableCell>
                      <TableCell>{item.materialDamage}</TableCell>
                      <TableCell>{item.environmentalSpills}</TableCell>
                      <TableCell className="font-semibold">{total}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="charts">
          <MaterialEnvironmentalCharts
            selectedData={selectedData}
            eventData={eventData}
          />
        </TabsContent>

        <TabsContent value="summary">
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Faena</TableHead>
                  <TableHead><div className="flex items-center gap-1"><Siren size={14} />Inc. peligrosos</div></TableHead>
                  <TableHead><div className="flex items-center gap-1"><Wrench size={14} />Daño material</div></TableHead>
                  <TableHead><div className="flex items-center gap-1"><Drop size={14} />Daño ambiental</div></TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventData.filter((item) => item.worksiteId !== "total").map((item) => {
                  const total = item.annual.dangerousIncidents + item.annual.materialDamage + item.annual.environmentalSpills
                  return (
                    <TableRow key={item.worksiteId}>
                      <TableCell className="font-medium">{item.worksiteName}</TableCell>
                      <TableCell>{item.annual.dangerousIncidents}</TableCell>
                      <TableCell>{item.annual.materialDamage}</TableCell>
                      <TableCell>{item.annual.environmentalSpills}</TableCell>
                      <TableCell className="font-semibold">{total}</TableCell>
                    </TableRow>
                  )
                })}
                {eventData.filter((item) => item.worksiteId === "total").map((item) => {
                  const total = item.annual.dangerousIncidents + item.annual.materialDamage + item.annual.environmentalSpills
                  return (
                    <TableRow key={item.worksiteId} className="font-semibold">
                      <TableCell>{item.worksiteName}</TableCell>
                      <TableCell>{item.annual.dangerousIncidents}</TableCell>
                      <TableCell>{item.annual.materialDamage}</TableCell>
                      <TableCell>{item.annual.environmentalSpills}</TableCell>
                      <TableCell className="font-semibold">{total}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
