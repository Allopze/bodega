import * as React from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { Warning } from "@phosphor-icons/react/dist/ssr"
import type { TerrenoDetail } from "@/lib/combustibles/fuel-log-detail"
import { FUEL_LOAD_ORIGIN_LABEL, TAE_SUBMISSION_SOURCE_TO_ORIGIN } from "@/lib/combustibles/fuel-log-shared"
import { fuelEquipmentHref, fuelLoadHistoryHref, withFuelContext } from "@/lib/combustibles/routes"
import { formatDateTime } from "@/lib/utils"
import { EvidenceThumbnail } from "./evidence-thumbnail"
import { FuelTerm } from "@/components/combustibles/fuel-glossary"
import { MeterCorrectionDialog } from "./meter-correction-dialog"
import {
  LoadFacts,
  LoadOriginBadge,
  LoadReviewStatus,
  LoadSection,
  LoadStatusBadge,
  LoadTimeline,
  NeighborLoads,
  OpenRequestNotice,
  ReservedValue,
  type LoadFact,
} from "./load-sections"

type Search = Record<string, string | string[] | undefined>

const METER_UNIT: Record<string, { reading: string; unit: string }> = {
  odometer: { reading: "Lectura del odómetro", unit: "km" },
  hour_meter: { reading: "Lectura del horómetro", unit: "h" },
}

/**
 * Cuerpo de la ficha de una carga hecha en terreno (formulario por QR, app o
 * histórico de sellos). Los datos comunes los ve quien tiene `view`; las
 * secciones propias de terreno (alertas, fotos, sellos, personas, cargas
 * vecinas, historial y la corrección de lectura) sólo con `tae_view`; las fotos y
 * los nombres, además, con `view_personal` (D-10, P-01).
 */
export function TerrenoLoadDetail({
  detail,
  canTae,
  canReview,
  canAudit,
  canDecide,
  search,
}: {
  detail: TerrenoDetail
  /** `combustibles:tae_view`. */
  canTae: boolean
  /** `combustibles:tae_review`. */
  canReview: boolean
  /** `combustibles:view_audit`. */
  canAudit: boolean
  /** `combustibles:approve_flagged`: decidir y deshacer desde la ficha. */
  canDecide: boolean
  search: Search
}) {
  const { submission } = detail
  const origin = TAE_SUBMISSION_SOURCE_TO_ORIGIN[submission.source] ?? "qr"
  const meter = METER_UNIT[submission.meterType] ?? METER_UNIT.odometer!
  const status = submission.status as "submitted" | "observed" | "validated" | "voided"
  const alertsActive = status === "submitted" || status === "observed"

  const facts: LoadFact[] = [
    {
      label: "Equipo",
      value: detail.vehicle ? <Link href={withFuelContext(fuelEquipmentHref(detail.vehicle.id), search)} className="text-[var(--color-primary-ink)] hover:underline">{detail.equipmentLabel}</Link> : detail.equipmentLabel,
    },
    { label: "Faena", value: detail.worksiteName },
    { label: "Fecha y hora", value: formatDateTime(submission.loadedAt), mono: true },
    { label: "Litros", value: `${Number(submission.liters).toLocaleString("es-CL")} L`, mono: true },
    { label: meter.reading, value: submission.meterReading != null ? `${submission.meterReading.toLocaleString("es-CL")} ${meter.unit}` : "Sin lectura", mono: submission.meterReading != null },
    { label: "Cómo llegó", value: <LoadOriginBadge origin={origin} /> },
    { label: "Estado", value: <LoadStatusBadge origen="terreno" status={status} /> },
  ]
  if (canTae) {
    facts.splice(5, 0,
      { label: "Combustible", value: detail.productName },
      { label: "De dónde salió", value: detail.supplyMediumName ?? detail.loadingPointName },
    )
  }

  const readingNote = (() => {
    if (!canTae) return null
    if (submission.meterReadingSource === "ocr") return `Lectura automática de la foto${submission.ocrConfidence != null ? ` (${Math.round(Number(submission.ocrConfidence) * 100)} % de confianza)` : ""}.`
    if (submission.meterReadingSource === "manual") return "Lectura anotada a mano."
    if (submission.meterReadingSource === "import") return "Lectura del histórico de sellos."
    return null
  })()
  const pendingSuggestion = canTae && submission.ocrSuggestedReading != null && submission.meterReadingSource == null
    ? `La foto sugiere ${submission.ocrSuggestedReading.toLocaleString("es-CL")} ${meter.unit}${submission.ocrConfidence != null ? ` (${Math.round(Number(submission.ocrConfidence) * 100)} % de confianza)` : ""}; confírmala o corrígela.`
    : null

  const chain = submission.sealChainStatus
  // Una carga registrada después (fecha pasada) tiene las fotos opcionales: no se dice que «faltan».
  const backdated = submission.loadedAtSource === "backdated"
  const evidenceMissing = backdated ? 0 : Math.max(0, 4 - detail.evidenceCount)

  return (
    <div className="space-y-5">
      {canTae && detail.alerts.length > 0 && (
        alertsActive ? (
          <Callout tone="warning" role="status" icon={<Warning size={16} />} title="Alertas por resolver">
            <ul className="list-disc space-y-0.5 pl-5">{detail.alerts.map((alert) => <li key={alert.code}>{alert.message}</li>)}</ul>
          </Callout>
        ) : (
          <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm text-[var(--color-text-muted)]">
            <p className="font-semibold">{status === "validated" ? "Alertas revisadas" : "Alertas archivadas"}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{detail.alerts.map((alert) => <li key={alert.code}>{alert.message}</li>)}</ul>
          </section>
        )
      )}

      <LoadSection title="Datos de la carga">
        <LoadFacts items={facts} />
        {(readingNote || pendingSuggestion || (canTae && canReview)) && (
          <div className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-3 text-sm">
            {readingNote && <p className="text-[var(--color-text-muted)]">{readingNote}</p>}
            {pendingSuggestion && <p className="text-[var(--color-warning-ink)]">{pendingSuggestion}</p>}
            {canTae && canReview && (
              <MeterCorrectionDialog
                key={`${submission.id}:${submission.updatedAt}`}
                submissionId={submission.id}
                currentMeterType={submission.meterType}
                currentMeterReading={submission.meterReading}
                suggestedMeterReading={submission.ocrSuggestedReading}
                currentStatus={status}
              />
            )}
          </div>
        )}
        {canTae && submission.notes ? <p className="mt-3 text-sm text-[var(--color-text-muted)]"><span className="font-medium text-[var(--color-text)]">Nota de quien cargó:</span> {submission.notes}</p> : null}
        {canTae && submission.reviewNote ? <p className="mt-2 text-sm text-[var(--color-text-muted)]"><span className="font-medium text-[var(--color-text)]">Nota de la revisión{detail.reviewedByName ? ` (${detail.reviewedByName})` : ""}:</span> {submission.reviewNote}</p> : null}
        {canTae && backdated ? (
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text)]"><FuelTerm term="Registrada después" />:</span>{" "}
            se ingresó el {formatDateTime(submission.submittedAt)}{detail.registeredByName ? ` por ${detail.registeredByName}` : ""}, con la fecha y hora de la carga ya pasadas.
            {submission.backdateReason ? <> Motivo: «{submission.backdateReason}».</> : null}
          </p>
        ) : null}
      </LoadSection>

      <LoadSection title="Revisión de la plataforma" description="Lo que la plataforma no puede juzgar sola queda por decidir.">
        <div className="space-y-3">
          <LoadReviewStatus review={detail.review} search={search} canDecide={canDecide} equipmentLabel={detail.equipmentLabel} />
          {detail.openRequest && <OpenRequestNotice request={detail.openRequest} search={search} />}
        </div>
      </LoadSection>

      {canTae ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <LoadSection title="Fotos" id="evidencia" description={backdated ? `${detail.evidenceCount} de 4 fotos; en una carga registrada después son opcionales.` : `${detail.evidenceCount} de 4 fotos${evidenceMissing > 0 ? `; faltan ${evidenceMissing}` : ""}.`}>
              {!detail.evidence.length && detail.evidenceCount > 0 ? (
                <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
                  <ReservedValue /> Las fotos de esta carga requieren el permiso para ver datos personales.
                </p>
              ) : detail.evidence.length === 0 ? (
                <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
                  {submission.source === "legacy_xlsx" ? "Este registro del histórico de sellos no trae fotografías." : "Esta carga no tiene fotos."}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {detail.evidence.map((item) => <EvidenceThumbnail key={item.id} evidence={item} />)}
                </div>
              )}
            </LoadSection>
            <LoadSection
              title="Historial"
              actions={canAudit ? <Link href={withFuelContext(fuelLoadHistoryHref({ origen: "terreno", id: detail.id }), search)} className="text-sm text-[var(--color-primary-ink)] hover:underline">Ver cambios campo a campo</Link> : null}
            >
              <LoadTimeline events={detail.timeline} />
            </LoadSection>
          </div>
          <div className="space-y-5">
            <LoadSection title="Sellos">
              <p className="font-mono text-lg tabular-nums">
                {submission.removedSealNumber ?? "—"} <span aria-hidden>→</span><span className="sr-only"> y luego </span> {submission.installedSealNumber ?? "—"}
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Sello retirado y sello nuevo.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {chain === "ok" && <Badge variant="success" size="sm">Cadena correcta</Badge>}
                {chain === "mismatch" && <Badge variant="danger" size="sm">Cadena rota</Badge>}
                {chain === "no_previous" && <Badge variant="outline" size="sm">Primera carga con sello del equipo</Badge>}
                {chain === "no_seal" && <Badge variant="warning" size="sm">Sin sello</Badge>}
              </div>
              {chain === "mismatch" && submission.sealChainExpected ? (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Se esperaba retirar el sello {submission.sealChainExpected}, el que se puso en la carga anterior.</p>
              ) : null}
              {submission.noSealReason ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">Motivo de la falta de sello: {submission.noSealReason}</p> : null}
            </LoadSection>
            <LoadSection title="Personas">
              <dl className="space-y-1.5 text-sm">
                <div className="flex gap-2"><dt className="text-[var(--color-text-subtle)]">Conductor:</dt><dd className="font-medium">{detail.driverName ?? <ReservedValue />}</dd></div>
                <div className="flex gap-2"><dt className="text-[var(--color-text-subtle)]">Supervisor:</dt><dd className="font-medium">{detail.supervisorName ?? <ReservedValue />}</dd></div>
              </dl>
              {submission.manualIdentity ? <p className="mt-2 text-xs text-[var(--color-text-subtle)]">Se identificaron a mano: no están verificados en el catálogo de trabajadores.</p> : null}
            </LoadSection>
            <LoadSection
              title={`Cargas vecinas de ${detail.vehicle?.code ?? detail.vehicle?.plate ?? "este equipo"}`}
              actions={detail.vehicle ? <Link href={withFuelContext(fuelEquipmentHref(detail.vehicle.id), search)} className="text-sm text-[var(--color-primary-ink)] hover:underline">Ficha del equipo</Link> : null}
            >
              <NeighborLoads
                search={search}
                current={{ loadedAt: submission.loadedAt, liters: Number(submission.liters), meterReading: submission.meterReading, meterUnit: meter.unit }}
                previous={detail.previous ? { id: detail.previous.id, loadedAt: detail.previous.loadedAt, liters: detail.previous.liters, meterReading: detail.previous.meterReading, meterUnit: meter.unit, state: statusWord(detail.previous.status) } : null}
                next={detail.next ? { id: detail.next.id, loadedAt: detail.next.loadedAt, liters: detail.next.liters, meterReading: detail.next.meterReading, meterUnit: meter.unit, state: statusWord(detail.next.status) } : null}
              />
            </LoadSection>
          </div>
        </div>
      ) : (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
          El detalle del registro en terreno —fotos, sellos, personas e historial— requiere el permiso de control del formulario en terreno.
          Esta carga llegó como «{FUEL_LOAD_ORIGIN_LABEL[origin]}».
        </p>
      )}
    </div>
  )
}

function statusWord(status: string): string {
  return status === "validated" ? "validada" : status === "observed" ? "con observación" : status === "submitted" ? "por validar" : status
}
