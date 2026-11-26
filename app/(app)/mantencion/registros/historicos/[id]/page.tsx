import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { ActionTypeBadge } from "@/components/mantencion/historial/action-type-badge"
import { responsibleText } from "@/components/mantencion/historial/history-format"
import { HistoricalLinkForm } from "@/components/mantencion/jefatura/registros/historical-link-form"
import { SectionCard } from "@/components/mantencion/jefatura/shared/section-card"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { SPECIALTY_LABELS, actionTypeFromText, isActionType, type ActionTypeOrUnknown, type Specialty } from "@/lib/mantencion/action-type"
import { driveLink } from "@/lib/mantencion/drive-link"
import { FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import { formatHours } from "@/lib/mantencion/format"
import { HISTORY_PATH } from "@/lib/mantencion/history-view"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { loadFleet } from "@/lib/services/mantencion/fleet"
import { getAdjacentHistoricalRecords, getHistoricalRecord, historicalLinkOptions, historicalWorkDate, type HistoricalNeighbor } from "@/lib/services/mantencion/historical-import"
import { externalFromHistorical, externalNameFromHistorical } from "@/lib/services/mantencion/maintenance-work"
import { formatDate } from "@/lib/utils"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"

export const metadata: Metadata = { title: "Trabajo del formulario" }
export const dynamic = "force-dynamic"

const TEXT_LINK = "font-semibold text-[var(--color-primary-ink)] hover:underline"
const DASH = "—"
const plainDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null)
const dayLabel = (value: string | null) => { const day = plainDay(value); return day ? formatDate(day) : DASH }

/** El tipo como lo cuenta el Panel: el normalizado del consolidado o, si falta, lo que dice el texto del formulario. */
function typeOf(row: { actionType: string | null; kindText: string }): ActionTypeOrUnknown {
  return isActionType(row.actionType) || row.actionType === "sin_clasificar" ? (row.actionType as ActionTypeOrUnknown) : actionTypeFromText(row.kindText)
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  )
}

function Neighbor({ neighbor, direction }: { neighbor: HistoricalNeighbor | null; direction: "previous" | "next" }) {
  const label = direction === "previous" ? "Trabajo anterior de este equipo" : "Trabajo siguiente de este equipo"
  if (!neighbor) return <span className="text-xs text-[var(--color-text-muted)]">{direction === "previous" ? "No hay un trabajo anterior de este equipo" : "No hay un trabajo siguiente de este equipo"}</span>
  const Icon = direction === "previous" ? ArrowLeft : ArrowRight
  return (
    <Link href={`${HISTORY_PATH}/${neighbor.sourceKey}`} className={`${TEXT_LINK} inline-flex max-w-full items-center gap-1.5 text-sm`} aria-label={`${label}: ${formatDate(neighbor.date)}`}>
      {direction === "previous" && <Icon size={14} weight="bold" aria-hidden />}
      <span className="truncate">{label} · {formatDate(neighbor.date)}</span>
      {direction === "next" && <Icon size={14} weight="bold" aria-hidden />}
    </Link>
  )
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
  const [equipment, neighbors] = await Promise.all([
    row.vehicleId ? loadFleet({ scope: equipmentScope(viewer), includeRetired: true, vehicleIds: [row.vehicleId], readingsPerEquipment: 1 }) : Promise.resolve([]),
    getAdjacentHistoricalRecords(viewer, row),
  ])
  const canLink = can(session, "mant:equipment:manage") && can(session, "mant:records:view_all")
  const options = canLink && (!row.vehicleId || !row.worksiteId) ? await historicalLinkOptions() : null

  const type = typeOf(row)
  const when = historicalWorkDate(row)
  const externalValue = row.fields.find((field) => field.header.toUpperCase().includes("EXTERNO"))?.value ?? null
  // El mismo texto que la lista, la vista previa y la línea de tiempo.
  const responsible = responsibleText({ external: externalFromHistorical(externalValue), detail: { responsible: externalNameFromHistorical(externalValue) } })
  const specialties = row.specialties?.map((specialty) => SPECIALTY_LABELS[specialty as Specialty] ?? specialty).join(", ")
  const origin: Array<[string, string]> = []
  if (row.originSource) origin.push(["Formulario de origen", row.originSource])
  if (row.sourceRecordId) origin.push(["ID en el consolidado", row.sourceRecordId])
  const filled = row.fields.filter((field) => field.value || field.formula || field.hyperlink)

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Trabajo del formulario"
        description={`${row.equipmentText || "Sin equipo"} · ${row.worksiteName || row.worksiteText || "Sin faena"}`}
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Historial de mantenciones", href: HISTORY_PATH },
          { label: "Detalle" },
        ]}
      />
      <div className="flex flex-col gap-5">
        <SectionCard title="El trabajo" description={`Hecho el ${formatDate(when)}`}>
          {row.isTest && (
            <Callout tone="warning" className="mb-3" title="Posible prueba">
              El consolidado marca este trabajo como posible prueba. El Panel no lo cuenta en sus indicadores de trabajos.
            </Callout>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ActionTypeBadge type={type} />
            {!row.vehicleId && <Badge variant="warning">Equipo sin identificar</Badge>}
            {!row.worksiteId && <Badge variant="warning">Faena sin identificar</Badge>}
          </div>
          <section aria-labelledby="work-done-heading" className="mt-3">
            <h3 id="work-done-heading" className="text-xs font-medium text-[var(--color-text-muted)]">Trabajo realizado</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{row.description || "No informado"}</p>
          </section>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Equipo">
              {equipment.length && row.vehicleId
                ? <Link className={TEXT_LINK} href={vehicleFichaHref(row.vehicleId, "mantencion")}>{row.equipmentText || "Ver la ficha del equipo"}</Link>
                : row.equipmentText || "Sin identificar"}
            </Fact>
            <Fact label="Lectura del equipo">{row.readingText.trim() || DASH}</Fact>
            <Fact label="Nº de orden">{row.orderText.trim() || DASH}</Fact>
            <Fact label="Ingreso a taller">{dayLabel(row.entryDate)}</Fact>
            <Fact label="Salida de taller">{dayLabel(row.exitDate)}</Fact>
            <Fact label="Días detenido">{row.downtimeDays !== null ? String(row.downtimeDays).replace(".", ",") : DASH}</Fact>
            <Fact label="Horas hombre">{row.laborHours !== null ? formatHours(row.laborHours) : row.hoursText.trim() || DASH}</Fact>
            <Fact label="Hecho por">{responsible}</Fact>
            <Fact label="Especialidades">{specialties || DASH}</Fact>
            {row.contractText && <Fact label="Contrato">{row.contractText}</Fact>}
          </dl>
          {row.qualityNotes && (
            <div className="mt-4">
              <p className="text-sm font-semibold">Observaciones de calidad</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-warning-ink)]">{row.qualityNotes}</p>
            </div>
          )}
          {row.vehicleId && (
            <nav aria-label="Otros trabajos de este equipo" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
              <Neighbor neighbor={neighbors.previous} direction="previous" />
              <Neighbor neighbor={neighbors.next} direction="next" />
            </nav>
          )}
        </SectionCard>

        <SectionCard title="Origen" description={`Archivo «${row.sourceFile}»`}>
          <p className="text-sm">
            Viene de un formulario anterior. Cuenta en los indicadores del Panel hasta el {formatDate(FORMS_LAST_COUNTED_DATE)}, salvo posible prueba, pero no en el semáforo, las alertas ni la lectura oficial.{" "}
            Está en la hoja «{row.sourceSheet}», fila {row.sourceRow}, del Excel original.
          </p>
          {origin.length > 0 && (
            <dl className="mt-3 divide-y divide-[var(--color-border)]">
              {origin.map(([label, value]) => (
                <div key={label} className="grid gap-1 py-2 sm:grid-cols-[minmax(12rem,1fr)_2fr] sm:gap-4">
                  <dt className="text-sm font-semibold">{label}</dt>
                  <dd className="min-w-0 break-words text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </SectionCard>

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
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-primary-ink)] hover:underline">
              Ver los {filled.length} campos tal como venían en el formulario
            </summary>
            <dl className="mt-2 divide-y divide-[var(--color-border)]">
              {filled.map((field, index) => {
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
          </details>
        </SectionCard>
      </div>
    </PageContainer>
  )
}
