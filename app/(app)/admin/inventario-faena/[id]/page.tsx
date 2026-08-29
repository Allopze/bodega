import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowRight, ClipboardText, ListChecks, TruckTrailer } from "@phosphor-icons/react/dist/ssr"
import { can, canAny, requireAuth } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { getEmergencyResourceDetail } from "@/lib/services/worksite-inventory"
import { formatDate, formatDateTime, todayInChile } from "@/lib/utils"
import { EMERGENCY_RESOURCE_STATUS_LABELS, emergencyResourceStatusVariant } from "@/lib/prevention/emergency"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
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
  classified: "Clasificado",
}

/** Los puntos coloreados comunican el tipo de evento: neutro para alta, ámbar
 *  para mantenimiento, rojo para retiro. Sin esto, todos los eventos del timeline
 *  lucen iguales y el operador no distingue una inspección vencida de un alta. */
const EVENT_TONE: Record<string, { dot: string; ring: string; label: string }> = {
  imported: { dot: "bg-[var(--color-primary)]", ring: "ring-[var(--color-primary)]/30", label: "Alta" },
  classified: { dot: "bg-[var(--color-primary)]", ring: "ring-[var(--color-primary)]/30", label: "Clasificación" },
  used: { dot: "bg-[var(--color-warning-ink)]", ring: "ring-[var(--color-warning-ink)]/30", label: "Uso" },
  service_requested: { dot: "bg-[var(--color-warning-ink)]", ring: "ring-[var(--color-warning-ink)]/30", label: "Recarga" },
  service_completed: { dot: "bg-[var(--color-success-ink)]", ring: "ring-[var(--color-success-ink)]/30", label: "Recarga" },
  reassigned: { dot: "bg-[var(--color-primary)]", ring: "ring-[var(--color-primary)]/30", label: "Asignación" },
  retired: { dot: "bg-[var(--color-danger-ink)]", ring: "ring-[var(--color-danger-ink)]/30", label: "Baja" },
}

const STATUS_SECTION_CLASS: Record<string, string> = {
  operational: "border-t-[var(--color-success)]",
  needs_maintenance: "border-t-[var(--color-warning)]",
  out_of_service: "border-t-[var(--color-danger)]",
}

type TimelineItem = {
  key: string
  at: string
  title: string
  detail: string | null
  href: string | null
  tone: { dot: string; ring: string; label: string } | null
}

type Props = { params: Promise<{ id: string }> }

function daysUntil(date: string, today: string): number {
  // Las fechas llegan como YYYY-MM-DD y `today` también: comparar a nivel de día
  // evita que un evento del 31 de diciembre aparezca como "ayer" por la zona
  // horaria del servidor.
  const target = Date.parse(`${date}T12:00:00Z`)
  const now = Date.parse(`${today}T12:00:00Z`)
  return Math.round((target - now) / 86_400_000)
}

function dueHint(date: string | null, today: string): { text: string; tone: "muted" | "warning" | "danger" } | null {
  if (!date) return null
  const days = daysUntil(date, today)
  if (days < 0) return { text: `Vencido hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`, tone: "danger" }
  if (days <= 30) return { text: `Vence en ${days} día${days === 1 ? "" : "s"}`, tone: "warning" }
  return { text: `En ${days} días`, tone: "muted" }
}

const DUE_HINT_CLASS: Record<"muted" | "warning" | "danger", string> = {
  muted: "text-[var(--color-text-subtle)]",
  warning: "text-[var(--color-warning-ink)]",
  danger: "text-[var(--color-danger-ink)]",
}

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
  const today = todayInChile()
  const expiresHint = dueHint(resource.expiresAt, today)
  const inspectionHint = dueHint(resource.nextInspectionAt, today)

  const timeline: TimelineItem[] = [
    ...detail.events.map((event) => ({
      key: `event-${event.id}`,
      at: event.occurredAt,
      title: EVENT_LABELS[event.eventType] ?? event.eventType,
      detail: event.notes ?? null,
      href: null,
      tone: EVENT_TONE[event.eventType] ?? null,
    })),
    ...detail.inspections.map((inspection) => ({
      key: `inspection-${inspection.id}`,
      at: inspection.reviewedAt ?? inspection.executedAt ?? "",
      title: `Inspección ${inspection.code}`,
      detail: `${inspection.status}${inspection.compliancePercent === null ? "" : ` · ${inspection.compliancePercent}%`}${inspection.nonConformingCount ? ` · ${inspection.nonConformingCount} no conforme(s)` : ""}`,
      href: `/prevencion/inspecciones/${inspection.id}`,
      tone: { dot: "bg-[var(--color-primary)]", ring: "ring-[var(--color-primary)]/30", label: "Inspección" },
    })),
    ...detail.assignments.flatMap((assignment) => [
      { key: `assignment-${assignment.id}`, at: assignment.assignedAt, title: `Asignado a ${assignment.pointLabel}`, detail: assignment.reason, href: null, tone: { dot: "bg-[var(--color-primary)]", ring: "ring-[var(--color-primary)]/30", label: "Asignación" } as TimelineItem["tone"] },
      ...(assignment.unassignedAt ? [{ key: `unassignment-${assignment.id}`, at: assignment.unassignedAt, title: `Terminó cobertura de ${assignment.pointLabel}`, detail: assignment.reason, href: null, tone: { dot: "bg-[var(--color-text-subtle)]", ring: "ring-[var(--color-text-subtle)]/30", label: "Liberado" } as TimelineItem["tone"] }] : []),
    ]),
  ].filter((item) => item.at).sort((left, right) => right.at.localeCompare(left.at))

  const canRequestService = can(session, "admin:worksite_inventory_service")
    && resource.status !== "out_of_service"
    && Boolean(resource.typeId)

  return <PageContainer width="workbench">
    <PageHeader
      title={title}
      description={`${detail.technicalType?.canonicalName ?? resource.kind} · ${detail.worksiteName} · ${resource.location}`}
      breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Inventario de faena", href: "/admin/inventario-faena" }, { label: title }]} />}
      actions={canRequestService ? <Button asChild><Link href={`/solicitudes/nueva?tipo=otro&faena=${encodeURIComponent(resource.worksiteId)}&recursoEmergencia=${encodeURIComponent(resource.id)}`}>Solicitar recarga</Link></Button> : undefined}
    />

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section
        aria-labelledby="resource-status-heading"
        className={`rounded-2xl border border-slate-200/70 border-t-4 bg-white p-5 shadow-xs ${STATUS_SECTION_CLASS[resource.status] ?? "border-t-[var(--color-border)]"}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p id="resource-status-heading" className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Estado actual</p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--color-text)]">{resource.name}</h2>
          </div>
          <Badge variant={emergencyResourceStatusVariant(resource.status)} dot>
            {EMERGENCY_RESOURCE_STATUS_LABELS[resource.status] ?? resource.status}
          </Badge>
        </div>
        <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Código de activo</dt>
            <dd className="font-medium text-[var(--color-text)]">{resource.assetCode ?? "Por clasificar"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Especificación técnica</dt>
            <dd className="font-medium text-[var(--color-text)]">
              {detail.technicalType?.canonicalName ?? "Por clasificar"}
              {detail.technicalType?.agent && detail.technicalType.capacity
                ? <span className="block text-xs font-normal text-[var(--color-text-subtle)]">{detail.technicalType.agent} · {detail.technicalType.capacity} {detail.technicalType.capacityUnit ?? ""}</span>
                : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Última mantención</dt>
            <dd className="tabular-nums text-[var(--color-text)]">{resource.lastMaintenanceAt ? formatDate(resource.lastMaintenanceAt) : "Sin registro"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Vencimiento del agente</dt>
            <dd className="tabular-nums text-[var(--color-text)]">
              {resource.expiresAt ? formatDate(resource.expiresAt) : "Sin registro"}
              {expiresHint && <span className={`ml-2 text-xs font-medium ${DUE_HINT_CLASS[expiresHint.tone]}`}>{expiresHint.text}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Próxima inspección</dt>
            <dd className="tabular-nums text-[var(--color-text)]">
              {resource.nextInspectionAt ? formatDate(resource.nextInspectionAt) : "Sin programación"}
              {inspectionHint && <span className={`ml-2 text-xs font-medium ${DUE_HINT_CLASS[inspectionHint.tone]}`}>{inspectionHint.text}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-subtle)]">Versión del registro</dt>
            <dd className="tabular-nums text-[var(--color-text)]">{resource.version}</dd>
          </div>
        </dl>
        {!resource.typeId ? (
          <p role="status" className="mt-4 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-tint)] p-3 text-xs text-[var(--color-warning-ink)]">
            Esta ficha no tiene especificación técnica. Clasifícala en el catálogo de tipos para habilitar la solicitud de recarga y la cobertura automática del punto.
          </p>
        ) : null}
      </section>

      <aside className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-xs" aria-labelledby="resource-service-heading">
        <h2 id="resource-service-heading" className="text-sm font-semibold text-[var(--color-text)]">Solicitudes, OC y recepciones</h2>
        {detail.serviceCases.length === 0 ? (
          <EmptyState
            compact
            align="start"
            icon={<ClipboardText size={18} aria-hidden />}
            title="Sin casos de recarga"
            description={canRequestService
              ? "Cuando el activo lo requiera, abre una solicitud y la trazabilidad se anexará a esta ficha."
              : "La próxima recarga se registrará acá cuando se abra una solicitud desde Inventario o desde una inspección."}
            action={canRequestService ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/solicitudes/nueva?tipo=otro&faena=${encodeURIComponent(resource.worksiteId)}&recursoEmergencia=${encodeURIComponent(resource.id)}`}>
                  Abrir solicitud
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </Button>
            ) : undefined}
          />
        ) : (
          <ul className="mt-3 space-y-3">
            {detail.serviceCases.map((service) => (
              <li key={`${service.id}-${service.orderId ?? "no-oc"}`} className="rounded-xl border border-[var(--color-border)] p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link className="font-semibold text-[var(--color-primary)] hover:underline" href={`/solicitudes/${service.requestId}`}>{service.requestCode}</Link>
                  <Badge variant={service.status === "completed" ? "success" : "warning"} dot>{service.status === "completed" ? "Completado" : "Abierto"}</Badge>
                </div>
                {service.orderId ? (
                  <p className="mt-1">
                    <Link href={`/compras/${service.orderId}`} className="hover:underline">{service.orderCode}</Link>
                    {service.supplierName ? <span className="text-[var(--color-text-subtle)]"> · {service.supplierName}</span> : null}
                  </p>
                ) : null}
                {service.receiptId ? (
                  <p className="mt-1">
                    <Link href={`/recepcion/${service.receiptId}`} className="hover:underline">{service.receiptCode}</Link>
                    <span className="text-[var(--color-text-subtle)]"> · {service.receiptStatus}</span>
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Costo: {service.subtotal === null ? "pendiente" : `$${service.subtotal.toLocaleString("es-CL")}`}</p>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>

    <section className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-xs" aria-labelledby="resource-timeline-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="resource-timeline-heading" className="text-sm font-semibold text-[var(--color-text)]">Línea de tiempo</h2>
        {timeline.length > 0 ? <p className="text-xs text-[var(--color-text-subtle)]">{timeline.length} evento{timeline.length === 1 ? "" : "s"} registrado{timeline.length === 1 ? "" : "s"}</p> : null}
      </div>
      {timeline.length === 0 ? (
        <EmptyState
          align="start"
          icon={<ListChecks size={18} aria-hidden />}
          title="Sin eventos registrados"
          description={resource.status === "operational"
            ? "La próxima inspección, recarga o reasignación aparecerá acá en orden cronológico."
            : "Cuando se registre el primer evento, esta sección trazará la vida del activo."}
        />
      ) : (
        <ol className="mt-5 space-y-4 border-l border-[var(--color-border)] pl-5">
          {timeline.map((item) => (
            <li key={item.key} className="relative">
              <span aria-hidden className={`absolute -left-[1.59rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ${item.tone?.dot ?? "bg-[var(--color-primary)]"} ${item.tone?.ring ?? "ring-[var(--color-primary)]/30"}`} />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <time className="text-xs tabular-nums text-[var(--color-text-subtle)]">{formatDateTime(item.at)}</time>
                {item.tone ? <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">· {item.tone.label}</span> : null}
              </div>
              <p className="text-sm font-semibold text-[var(--color-text)]">{item.href ? <Link href={item.href} className="hover:underline">{item.title}</Link> : item.title}</p>
              {item.detail ? <p className="text-xs text-[var(--color-text-subtle)]">{item.detail}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>

    {resource.status === "out_of_service" ? (
      <p role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-tint)] p-3 text-sm text-[var(--color-danger-ink)]">
        <TruckTrailer size={16} aria-hidden className="mt-0.5 shrink-0" />
        Activo fuera de servicio: la solicitud de recarga no está disponible. Reclasifícalo desde Inventario cuando vuelva a estar operativo.
      </p>
    ) : null}
  </PageContainer>
}
