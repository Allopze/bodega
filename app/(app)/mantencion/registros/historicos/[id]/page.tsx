import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { HistoricalLinkForm } from "@/components/mantencion/jefatura/registros/historical-link-form"
import { SectionCard } from "@/components/mantencion/jefatura/shared/section-card"
import { Callout } from "@/components/ui/callout"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { ACTION_TYPE_LABELS, SPECIALTY_LABELS, type ActionTypeOrUnknown, type Specialty } from "@/lib/mantencion/action-type"
import { driveLink } from "@/lib/mantencion/drive-link"
import { FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import { formatHours } from "@/lib/mantencion/format"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { loadFleet } from "@/lib/services/mantencion/fleet"
import { getHistoricalRecord, historicalLinkOptions } from "@/lib/services/mantencion/historical-import"
import { formatDate } from "@/lib/utils"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"

export const metadata: Metadata = { title: "Trabajo del historial anterior" }
export const dynamic = "force-dynamic"

/** Lo que el consolidado agrega a la fila; las filas que sólo vienen del formulario no lo traen. */
function consolidatedFacts(row: { actionType: string | null; specialties: string[] | null; laborHours: number | null; downtimeDays: number | null; contractText: string | null; originSource: string | null; sourceRecordId: string | null }) {
  const facts: Array<[string, string]> = []
  if (row.actionType && row.actionType in ACTION_TYPE_LABELS) facts.push(["Tipo de acción", ACTION_TYPE_LABELS[row.actionType as ActionTypeOrUnknown]])
  if (row.specialties?.length) facts.push(["Especialidades", row.specialties.map((specialty) => SPECIALTY_LABELS[specialty as Specialty] ?? specialty).join(", ")])
  if (row.laborHours !== null) facts.push(["Horas hombre", formatHours(row.laborHours)])
  if (row.downtimeDays !== null) facts.push(["Días detenido", String(row.downtimeDays).replace(".", ",")])
  if (row.contractText) facts.push(["Contrato", row.contractText])
  if (row.originSource) facts.push(["Formulario de origen", row.originSource])
  if (row.sourceRecordId) facts.push(["ID en el consolidado", row.sourceRecordId])
  return facts
}

const TEXT_LINK = "font-semibold text-[var(--color-primary-ink)] hover:underline"

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
  const facts = consolidatedFacts(row)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Trabajo del historial anterior"
        description={`${row.equipmentText || "Sin equipo"} · ${row.worksiteName || row.worksiteText || "Sin faena"}`}
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
            Viene de un formulario anterior. Cuenta en los indicadores del Panel hasta el {formatDate(FORMS_LAST_COUNTED_DATE)}, salvo posible prueba, pero no en el semáforo, las alertas ni la lectura oficial.{" "}
            Está en la hoja «{row.sourceSheet}», fila {row.sourceRow}, del Excel original.{" "}
            {equipment.length && row.vehicleId
              ? <Link className={TEXT_LINK} href={vehicleFichaHref(row.vehicleId, "mantencion")}>Ver ficha del equipo</Link>
              : row.vehicleId ? "El equipo está asociado a la flota." : "El equipo aún no está identificado."}
          </p>
        </SectionCard>
        {(facts.length > 0 || row.isTest || row.qualityNotes) && (
          <SectionCard title="Clasificación del consolidado">
            {row.isTest && (
              <Callout tone="warning" className="mb-3" title="Posible prueba">
                El consolidado marca este trabajo como posible prueba. El Panel no lo cuenta en sus indicadores de trabajos.
              </Callout>
            )}
            {facts.length > 0 && (
              <dl className="divide-y divide-[var(--color-border)]">
                {facts.map(([label, value]) => (
                  <div key={label} className="grid gap-1 py-2 sm:grid-cols-[minmax(12rem,1fr)_2fr] sm:gap-4">
                    <dt className="text-sm font-semibold">{label}</dt>
                    <dd className="min-w-0 break-words text-sm">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {row.qualityNotes && (
              <div className="mt-3">
                <p className="text-sm font-semibold">Observaciones de calidad</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-warning-ink)]">{row.qualityNotes}</p>
              </div>
            )}
          </SectionCard>
        )}
        {options && (
          <SectionCard title="Identificar equipo y faena" description="Elige lo que no se reconoció en el archivo.">
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
