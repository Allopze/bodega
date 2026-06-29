import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { requirePermission } from "@/lib/auth/can"
import { getFleetVehicleDetail } from "@/lib/services/fleet"
import { FleetDocumentsPanel } from "./fleet-documents-panel"

export const metadata: Metadata = { title: "Detalle de vehículo" }

export default async function FlotaVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  let session
  try { session = await requirePermission("flota:view") }
  catch { redirect("/forbidden") }

  const { id } = await params
  const detail = await getFleetVehicleDetail(session, id)
  if (!detail) notFound()

  const vehicle = detail.vehicle

  return (
    <PageContainer>
      <PageHeader
        title={vehicle.plate}
        description={[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.type}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Vehículos", href: "/flota" },
            { label: vehicle.plate },
          ]} />
        }
        actions={
          <div className="flex justify-end gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/combustibles?vehicle=${vehicle.id}`}>Combustible</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/mantenciones?vehicle=${vehicle.id}`}>Mantenciones</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Operación</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Fact label="Faena" value={vehicle.worksite?.name ?? "Sin faena"} />
            <Fact label="Responsable" value={vehicle.responsibleUser?.name ?? vehicle.responsibleUser?.email ?? "—"} />
            <Fact label="Estado" value={<Badge variant={vehicle.operationalStatus === "operativo" ? "success" : "outline"}>{vehicle.operationalStatus}</Badge>} />
            <Fact label="Próximo vencimiento" value={detail.nextExpiryDate ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Vencimientos</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Fact label="SOAP" value={vehicle.soapExpiresAt ?? "—"} />
            <Fact label="Revisión técnica" value={vehicle.technicalReviewExpiresAt ?? "—"} />
            <Fact label="Permiso circulación" value={vehicle.circulationPermitExpiresAt ?? "—"} />
            <Fact label="Seguro" value={vehicle.insuranceExpiresAt ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Seguro</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Fact label="Póliza" value={vehicle.insurancePolicyNumber ?? "—"} />
            <Fact label="Estado catálogo" value={vehicle.isActive ? "Activo" : "Inactivo"} />
            <Fact label="Notas" value={vehicle.notes ?? "—"} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Documentos</CardTitle></CardHeader>
        <CardContent>
          <FleetDocumentsPanel
            vehicleId={vehicle.id}
            documents={detail.documents.map((document) => ({
              id: document.id,
              documentType: document.documentType,
              fileName: document.fileName,
              mimeType: document.mimeType ?? null,
              expiresAt: document.expiresAt ?? null,
              createdAt: document.createdAt,
            }))}
          />
        </CardContent>
      </Card>
    </PageContainer>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
