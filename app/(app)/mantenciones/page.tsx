import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { can, requirePermission } from "@/lib/auth/can"
import { getMaintenancePageData } from "@/lib/services/maintenance"
import { MaintenanceForm } from "./maintenance-form"

export const metadata: Metadata = { title: "Mantenciones" }

const statusLabels: Record<string, { label: string; variant: "default" | "warning" | "success" | "danger" | "outline" }> = {
  scheduled: { label: "Programada", variant: "outline" },
  in_progress: { label: "En curso", variant: "warning" },
  completed: { label: "Completada", variant: "success" },
  cancelled: { label: "Cancelada", variant: "danger" },
}

const formatCLP = (value: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value)

const formatNumber = (value: number | null) =>
  value == null ? "—" : new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value)

export default async function MantencionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("mantenciones:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const vehicleId = typeof sp.vehicle === "string" ? sp.vehicle : undefined
  const worksiteId = typeof sp.faena === "string" ? sp.faena : undefined
  const status = typeof sp.status === "string" ? sp.status : undefined
  const data = await getMaintenancePageData(session, { vehicleId, worksiteId, status })
  const canCreate = can(session, "mantenciones:create")

  return (
    <PageContainer>
      <PageHeader
        title="Mantenciones"
        description="Registro operativo de servicios, costos, kilometraje, horómetro y documentos de flota."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Vehículos", href: "/" },
            { label: "Mantenciones" },
          ]} />
        }
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href="/flota">Ver flota</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <select name="vehicle" defaultValue={vehicleId ?? ""} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Todos los vehículos</option>
              {data.vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}</option>
              ))}
            </select>
            <select name="faena" defaultValue={worksiteId ?? ""} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Todas las faenas</option>
              {data.worksites.map((worksite) => (
                <option key={worksite.id} value={worksite.id}>{worksite.name}</option>
              ))}
            </select>
            <select name="status" defaultValue={status ?? ""} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Todos los estados</option>
              {Object.entries(statusLabels).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button asChild variant="ghost">
                <Link href="/mantenciones">Limpiar</Link>
              </Button>
              <Button type="submit">Filtrar</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nueva mantención</CardTitle>
          </CardHeader>
          <CardContent>
            <MaintenanceForm
              vehicles={data.vehicles.map((vehicle) => ({ id: vehicle.id, plate: vehicle.plate, type: vehicle.type }))}
              suppliers={data.suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
              worksites={data.worksites.map((worksite) => ({ id: worksite.id, name: worksite.name }))}
              costCenters={data.costCenters.map((center) => ({ id: center.id, code: center.code, name: center.name }))}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Vehículo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead className="text-right">Hr</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                    No hay mantenciones para los filtros actuales.
                  </TableCell>
                </TableRow>
              ) : data.records.map((record) => {
                const statusMeta = statusLabels[record.status] ?? { label: record.status, variant: "default" as const }
                return (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-sm">{record.maintenanceDate}</TableCell>
                    <TableCell>{record.vehicle?.plate ?? record.vehicleId}</TableCell>
                    <TableCell>{record.maintenanceType}</TableCell>
                    <TableCell>{record.supplier?.name ?? "—"}</TableCell>
                    <TableCell>{record.worksite?.name ?? "—"}</TableCell>
                    <TableCell><Badge variant={statusMeta.variant}>{statusMeta.label}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(record.odometerReading)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(record.hourMeterReading)}</TableCell>
                    <TableCell>{record.documentNumber ?? record.documentName ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatCLP(record.totalAmount)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
