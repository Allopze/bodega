import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { HistoricalLinkForm } from "@/components/mantencion/jefatura/registros/historical-link-form"
import { SectionCard } from "@/components/mantencion/jefatura/shared/section-card"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { loadFleet } from "@/lib/services/mantencion/fleet"
import { getHistoricalRecord, historicalLinkOptions } from "@/lib/services/mantencion/historical-import"
import { formatDate } from "@/lib/utils"

export const metadata: Metadata = { title: "Trabajo del historial anterior" }
export const dynamic = "force-dynamic"

const TEXT_LINK = "font-semibold text-[var(--color-primary-ink)] hover:underline"

function driveLink(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && ["drive.google.com", "docs.google.com"].includes(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

export default async function HistoricalRecordPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const { id } = await params
  const viewer = viewerFromSession(session)
  const row = await getHistoricalRecord(viewer, id)
  if (!row) notFound()
  const equipment = row.vehicleId ? await loadFleet({ scope: equipmentScope(viewer), includeRetired: true, vehicleIds: [row.vehicleId], readingsPerEquipment: 1 }) : []
  const canLink = can(session, "mant:equipment:manage") && can(session, "mant:records:view_all")
  const options = canLink && (!row.vehicleId || !row.worksiteId) ? await historicalLinkOptions() : null

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Trabajo del historial anterior"
        description={`${row.equipmentText || "Sin equipo"} · ${row.worksiteText || "Sin faena"}`}
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Registros firmados", href: "/mantencion/registros" },
          { label: "Historial anterior", href: "/mantencion/registros/historicos" },
          { label: "Detalle" },
        ]}
      />
      <div className="flex flex-col gap-5">
        <SectionCard title="Origen" description={`Archivo «${row.sourceFile}»`}>
          <p className="text-sm">
            Este trabajo viene de un formulario anterior. Está en la hoja «{row.sourceSheet}», fila {row.sourceRow}, por si hay que revisarlo en el Excel original.{" "}
            {equipment.length
              ? <Link className={TEXT_LINK} href={`/mantencion/equipos/${row.vehicleId}`}>Ver ficha del equipo</Link>
              : row.vehicleId ? "El equipo está asociado a la flota." : "El equipo aún no está identificado."}
          </p>
        </SectionCard>
        {options && (
          <SectionCard title="Identificar equipo y faena" description="Elige el equipo y la faena que no se pudieron reconocer en el archivo.">
            <HistoricalLinkForm
              sourceKey={row.sourceKey}
              needsVehicle={!row.vehicleId}
              needsWorksite={!row.worksiteId}
              vehicles={options.vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.code || "Sin código"} / ${vehicle.plate}` }))}
              sites={options.sites.map((site) => ({ value: site.id, label: site.name }))}
            />
          </SectionCard>
        )}
        <SectionCard title="Datos originales">
          <dl className="divide-y divide-[var(--color-border)]">
            {row.fields.filter((field) => field.value || field.formula || field.hyperlink).map((field, index) => {
              const link = driveLink(field.hyperlink ?? field.value)
              const value = field.header === "Fecha de envío" && field.value ? formatDate(field.value) : field.value
              return (
                <div key={`${field.header}-${index}`} className="grid gap-1 py-3 sm:grid-cols-[minmax(12rem,1fr)_2fr] sm:gap-4">
                  <dt className="text-sm font-semibold">{field.header}</dt>
                  <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">
                    {link
                      ? <a className="text-[var(--color-primary-ink)] underline" href={link} target="_blank" rel="noreferrer">{value || "Abrir archivo de respaldo"}</a>
                      : value || "Sin resultado"}
                    {field.formula && <span className="block text-xs text-[var(--color-text-muted)]">Fórmula del Excel: {field.formula}</span>}
                  </dd>
                </div>
              )
            })}
          </dl>
        </SectionCard>
      </div>
    </PageContainer>
  )
}
