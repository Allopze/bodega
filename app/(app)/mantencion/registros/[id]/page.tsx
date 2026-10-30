import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { PhotoGallery } from "@/components/mantencion/jefatura/registros/photo-gallery"
import { photoCaption } from "@/components/mantencion/jefatura/registros/photo-labels"
import { RecordActions } from "@/components/mantencion/jefatura/registros/record-actions"
import { RecordListNav } from "@/components/mantencion/jefatura/registros/record-list-nav"
import { CorrectiveSections, EquipmentSection, PreventiveSection, RecordAlerts, RecordDataSection } from "@/components/mantencion/jefatura/registros/record-sections"
import { RecordAside } from "@/components/mantencion/jefatura/registros/record-aside"
import { RecordStatusBadges } from "@/components/mantencion/jefatura/shared/record-badges"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { recordKindText } from "@/lib/mantencion/format"
import { canObserveRecord, viewerFromSession } from "@/lib/services/mantencion/access"
import { loadRecordDetail } from "@/lib/services/mantencion/records-detail"
import { parseRecordListContext, recordDetailHref, recordListHref, type RawSearchParams } from "@/lib/services/mantencion/records-filters"
import { loadRecordNeighbors } from "@/lib/services/mantencion/records-query"
import { formatDateTime } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Registro de mantención" }

export default async function RecordDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_own", "mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const { id } = await params
  const viewer = viewerFromSession(session)
  // De qué lista se llegó (`?lista=`), si se llegó desde una: da el anterior y el siguiente y el «Volver».
  const context = parseRecordListContext(await searchParams)
  // `null` cubre «no existe» y «no es de tu alcance»: el mismo 404, sin confirmar que el id existe.
  const [detail, neighbors] = await Promise.all([
    loadRecordDetail(viewer, id),
    context ? loadRecordNeighbors(viewer, context.query, id) : Promise.resolve(null),
  ])
  if (!detail) notFound()
  const listHref = context ? recordListHref(context.listQuery, neighbors?.position) : "/mantencion/registros"
  // «Marcar revisado y siguiente» sigue con el siguiente de ESA lista, calculado antes de marcar:
  // en «Por revisar» el registro revisado sale de la lista, y el siguiente sigue siendo el mismo.
  const queue = context
    ? { nextHref: neighbors?.next ? recordDetailHref(neighbors.next.id, context.listQuery) : null, listHref }
    : null

  const photos = detail.photos.map((photo, index) => ({
    id: photo.id,
    caption: photoCaption(detail.photos, index),
    alt: `${photoCaption(detail.photos, index)} del equipo ${detail.equipment.code}; el sello dibujado en la foto trae la fecha, la hora, el código y la patente`,
    stampedAt: photo.stampedAt,
    receivedAt: photo.receivedAt,
  }))
  const folio = detail.folio ?? "Sin folio"
  const equipmentName = `${detail.equipment.code}${detail.equipment.noPlate || detail.equipment.plate === detail.equipment.code ? "" : ` · ${detail.equipment.plate}`}`
  const voided = detail.status === "anulado"

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`${recordKindText(detail.kind, detail.schedule?.intervalValue ?? null, detail.unit)} · ${equipmentName}`}
        description={`${folio} · ${detail.worksiteName}`}
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Registros", href: listHref },
          { label: folio },
        ]}
        actions={
          <RecordActions
            recordId={detail.id}
            folio={detail.folio}
            status={detail.status}
            review={detail.review}
            canExport={can(session, "mant:export")}
            canObserve={can(session, "mant:records:observe") && canObserveRecord(viewer, detail)}
            canReview={can(session, "mant:records:review")}
            canVoid={can(session, "mant:records:void")}
            canCorrect={can(session, "mant:app:use")}
            queue={queue}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <RecordStatusBadges status={detail.status} review={detail.review} showPending />
          {detail.correctedBy && (
            <Link href={`/mantencion/registros/${detail.correctedBy.id}`} className="text-sm font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline">
              Corregido en {detail.correctedBy.folio ?? "otro registro"}
            </Link>
          )}
          {detail.correctsRecord && (
            <Link href={`/mantencion/registros/${detail.correctsRecord.id}`} className="text-sm font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline">
              Corrige a {detail.correctsRecord.folio ?? "un registro anulado"}
            </Link>
          )}
        </div>
        {context && <RecordListNav listHref={listHref} listQuery={context.listQuery} neighbors={neighbors} />}
      </div>

      {voided && detail.voided && (
        <div role="note" className="mb-4 rounded-xl border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-4 py-3 text-sm text-[var(--color-danger-ink)]">
          <p className="font-semibold">
            <Badge variant="danger" size="sm">Anulado</Badge>{" "}
            Este registro no cuenta en las lecturas, el estado de los equipos ni los indicadores.
          </p>
          <p className="mt-1.5">Motivo: {detail.voided.reason}</p>
          <p className="mt-0.5">{detail.voided.userName} · {formatDateTime(detail.voided.createdAt)}</p>
        </div>
      )}

      <RecordAlerts detail={detail} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <EquipmentSection detail={detail} />
          <RecordDataSection detail={detail} />
          {detail.kind === "P" ? <PreventiveSection detail={detail} /> : <CorrectiveSections detail={detail} />}
        </div>
        <RecordAside detail={detail} photos={<PhotoGallery photos={photos} />} />
      </div>
    </PageContainer>
  )
}
