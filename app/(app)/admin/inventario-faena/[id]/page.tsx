import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { can, canAny, requireAuth } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { getEmergencyResourceDetail } from "@/lib/services/worksite-inventory"
import { formatDate, formatDateTime } from "@/lib/utils"
import { EMERGENCY_RESOURCE_STATUS_LABELS, emergencyResourceStatusVariant } from "@/lib/prevention/emergency"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"

export const metadata: Metadata = { title: "Ficha de activo de emergencia" }

const EVENT_LABELS: Record<string, string> = {
  imported: "Importado",
  used: "Uso registrado",
  service_requested: "Recarga solicitada",
  service_completed: "Recarga completada",
  reassigned: "Reasignado",
  retired: "Dado de baja",
}

type Props = { params: Promise<{ id: string }> }

export default async function EmergencyResourceDetailPage({ params }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!canAny(session, "admin:worksite_inventory", "admin:worksite_inventory_service")) redirect("/forbidden")
  const { id } = await params
  let detail
  try {
    detail = await getEmergencyResourceDetail({
      userId: session.user.id,
      permissions: session.user.permissions,
      scope: serviceWorksiteScope(session),
    }, id)
  } catch { notFound() }

  const resource = detail.resource
  const title = resource.assetCode ?? resource.name
  const timeline = [
    ...detail.events.map((event) => ({
      key: `event-${event.id}`,
      at: event.occurredAt,
      title: EVENT_LABELS[event.eventType] ?? event.eventType,
      detail: event.notes ?? null,
      href: null as string | null,
    })),
    ...detail.inspections.map((inspection) => ({
      key: `inspection-${inspection.id}`,
      at: inspection.reviewedAt ?? inspection.executedAt ?? "",
      title: `Inspección ${inspection.code}`,
      detail: `${inspection.status}${inspection.compliancePercent === null ? "" : ` · ${inspection.compliancePercent}%`}${inspection.nonConformingCount ? ` · ${inspection.nonConformingCount} no conforme(s)` : ""}`,
      href: `/prevencion/inspecciones/${inspection.id}`,
    })),
    ...detail.assignments.flatMap((assignment) => [
      { key: `assignment-${assignment.id}`, at: assignment.assignedAt, title: `Asignado a ${assignment.pointLabel}`, detail: assignment.reason, href: null as string | null },
      ...(assignment.unassignedAt ? [{ key: `unassignment-${assignment.id}`, at: assignment.unassignedAt, title: `Terminó cobertura de ${assignment.pointLabel}`, detail: assignment.reason, href: null as string | null }] : []),
    ]),
  ].filter((item) => item.at).sort((left, right) => right.at.localeCompare(left.at))

  return <PageContainer width="workbench">
    <PageHeader
      title={title}
      description={`${detail.technicalType?.canonicalName ?? resource.kind} · ${detail.worksiteName} · ${resource.location}`}
      breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Inventario de faena", href: "/admin/inventario-faena" }, { label: title }]} />}
      actions={can(session, "admin:worksite_inventory_service") && resource.status !== "out_of_service" && resource.typeId ? <Button asChild><Link href={`/solicitudes/nueva?tipo=otro&faena=${encodeURIComponent(resource.worksiteId)}&recursoEmergencia=${encodeURIComponent(resource.id)}`}>Solicitar recarga</Link></Button> : undefined}
    />

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Estado actual</p><h2 className="mt-1 text-lg font-semibold">{resource.name}</h2></div><Badge variant={emergencyResourceStatusVariant(resource.status)}>{EMERGENCY_RESOURCE_STATUS_LABELS[resource.status] ?? resource.status}</Badge></div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div><dt className="text-xs text-text-subtle">Código de activo</dt><dd className="font-medium">{resource.assetCode ?? "Por clasificar"}</dd></div>
          <div><dt className="text-xs text-text-subtle">Especificación</dt><dd className="font-medium">{detail.technicalType?.canonicalName ?? "Por clasificar"}</dd></div>
          <div><dt className="text-xs text-text-subtle">Última mantención</dt><dd>{resource.lastMaintenanceAt ? formatDate(resource.lastMaintenanceAt) : "Sin registro"}</dd></div>
          <div><dt className="text-xs text-text-subtle">Próximo vencimiento</dt><dd>{resource.expiresAt ? formatDate(resource.expiresAt) : "Sin registro"}</dd></div>
          <div><dt className="text-xs text-text-subtle">Próxima inspección</dt><dd>{resource.nextInspectionAt ? formatDate(resource.nextInspectionAt) : "Sin programación"}</dd></div>
          <div><dt className="text-xs text-text-subtle">Versión</dt><dd className="tabular-nums">{resource.version}</dd></div>
        </dl>
      </section>

      <aside className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-xs">
        <h2 className="text-sm font-semibold">Solicitudes, OC y recepciones</h2>
        {detail.serviceCases.length === 0 ? <p className="mt-3 text-sm text-text-subtle">Todavía no hay casos de recarga.</p> : <ul className="mt-3 space-y-3">{detail.serviceCases.map((service) => <li key={`${service.id}-${service.orderId ?? "no-oc"}`} className="rounded-xl border border-(--color-border) p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><Link className="font-semibold text-(--color-primary) hover:underline" href={`/solicitudes/${service.requestId}`}>{service.requestCode}</Link><Badge variant={service.status === "completed" ? "success" : "warning"}>{service.status === "completed" ? "Completado" : "Abierto"}</Badge></div>
          {service.orderId && <p className="mt-1"><Link href={`/compras/${service.orderId}`} className="hover:underline">{service.orderCode}</Link>{service.supplierName ? ` · ${service.supplierName}` : ""}</p>}
          {service.receiptId && <p className="mt-1"><Link href={`/recepcion/${service.receiptId}`} className="hover:underline">{service.receiptCode}</Link> · {service.receiptStatus}</p>}
          <p className="mt-1 text-xs text-text-subtle">Costo: {service.subtotal === null ? "pendiente" : `$${service.subtotal.toLocaleString("es-CL")}`}</p>
        </li>)}</ul>}
      </aside>
    </div>

    <section className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-xs">
      <h2 className="text-sm font-semibold">Línea de tiempo</h2>
      {timeline.length === 0 ? <p className="mt-3 text-sm text-text-subtle">Sin eventos registrados.</p> : <ol className="mt-4 space-y-4 border-l border-(--color-border) pl-5">{timeline.map((item) => <li key={item.key} className="relative"><span className="absolute -left-[1.53rem] top-1.5 h-2 w-2 rounded-full bg-(--color-primary)" /><time className="text-xs tabular-nums text-text-subtle">{formatDateTime(item.at)}</time><p className="text-sm font-semibold">{item.href ? <Link href={item.href} className="hover:underline">{item.title}</Link> : item.title}</p>{item.detail && <p className="text-xs text-text-subtle">{item.detail}</p>}</li>)}</ol>}
    </section>
  </PageContainer>
}
