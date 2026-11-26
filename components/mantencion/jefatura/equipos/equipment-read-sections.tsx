import type { ReactNode } from "react"
import Link from "next/link"
import { DetailItem } from "@/components/ui/detail-item"
import { MANT_GPS_SOURCE_LABEL } from "@/lib/mantencion/gps-estimate"
import { formatReading, recordKindText, remainingText, unitName } from "@/lib/mantencion/format"
import { isDeclaredPreventive, PRIOR_PREVENTIVE_LABEL, preventiveSupportText } from "@/lib/mantencion/preventive-origin"
import { formatDate, todayInChile } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"
import { EquipmentStateBadge } from "../shared/equipment-state-badge"
import type { EquipmentDetailData, PriorPreventiveView } from "./equipment-detail-types"

/**
 * Un tramo que no se parte a la mitad: una fecha («29-10-↵2026») o una lectura
 * («120.100 ↵km») cortadas por el ancho de la columna se leen como dos datos.
 */
function NoBreak({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>
}

/** Un valor con su fecha debajo, en mono y entera: «120.100 km» / «29-10-2026». */
function ValueOnDate({ value, date }: { value: ReactNode; date: string }) {
  return (
    <>
      {value}
      <span className="block whitespace-nowrap font-mono text-xs font-normal tabular-nums text-[var(--color-text-muted)]">{formatDate(date)}</span>
    </>
  )
}

/**
 * Lo que dice la correctiva abierta además de la etiqueta «En taller · N días»:
 * desde cuándo y cuándo fue la última novedad. «Sin actualizar» va en el naranja
 * de pendientes, en el tono de texto (C4), y dice qué falta.
 */
function WorkshopNote({ workshop }: { workshop: NonNullable<EquipmentDetailData["workshop"]> }) {
  return (
    <p className="mb-3 text-sm text-[var(--color-text-muted)]">
      {workshop.entryDate ? <>Entró a taller el <NoBreak>{formatDate(workshop.entryDate)}</NoBreak>. </> : "Sin fecha de ingreso a taller. "}
      {workshop.stale
        ? <span className="font-semibold text-[var(--color-signal-ink)]">Sin actualizar: la última novedad es del <NoBreak>{formatDate(workshop.lastActivityDate)}</NoBreak>.</span>
        : <>Última novedad el <NoBreak>{formatDate(workshop.lastActivityDate)}</NoBreak>.</>}
    </p>
  )
}

/**
 * De dónde sale una preventiva. La firmada muestra su folio; la declarada, el rótulo «Declarada,
 * anterior a la plataforma», su respaldo y quién la declaró: nunca parece un registro firmado.
 */
function PreventiveOrigin({ preventive, declaredBy }: { preventive: { origin?: "firmada" | "declarada"; evidence?: string | null }; declaredBy?: PriorPreventiveView | null }) {
  const support = preventiveSupportText(preventive)
  if (!isDeclaredPreventive(preventive)) {
    return support ? <span className="block text-xs font-normal text-[var(--color-text-muted)]">{support}</span> : null
  }
  return (
    <span className="mt-0.5 block text-xs font-normal text-[var(--color-text-muted)]">
      <span className="font-semibold text-[var(--color-text)]">{PRIOR_PREVENTIVE_LABEL}</span>
      {support ? <> · {support}</> : null}
      {declaredBy?.declaredByName ? <> · Declarada por {declaredBy.declaredByName}</> : null}
      {declaredBy?.source ? <span className="block">Fuente: {declaredBy.source}</span> : null}
    </span>
  )
}

/** Estado de mantención del equipo: lectura, próxima mantención y última preventiva. */
export function EquipmentStatusCard({ data }: { data: EquipmentDetailData }) {
  const { status, unit } = data
  const last = status.lastPreventive
  const sourceLabel = MANT_GPS_SOURCE_LABEL[data.gpsReadingSource ?? "gps"]
  return (
    <SectionCard title="Mantención">
      <div className="mb-3">
        {/* Sin fecha de ingreso (`daysStopped` nulo) no hay cuántos días decir: la etiqueta cae en «desde hoy». */}
        <EquipmentStateBadge state={status.state} workshop={data.workshop ? { days: data.workshop.daysStopped ?? null } : null} />
      </div>
      {data.workshop && <WorkshopNote workshop={data.workshop} />}
      {status.state === "sin_preventiva" ? (
        <p className="mb-3 text-sm text-[var(--color-text-muted)]">
          Sin preventiva firmada ni declarada no hay próxima mantención. Si hubo una antes de la plataforma, declárala en
          «Editar plan de mantención» con su respaldo.
        </p>
      ) : null}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem layout="stacked" mono label="Última lectura" value={status.currentReading ? <ValueOnDate value={<NoBreak>{formatReading(status.currentReading.value, unit)}</NoBreak>} date={status.currentReading.date} /> : null} />
        <DetailItem layout="stacked" mono label="Próxima mantención" value={status.nextReading != null ? <NoBreak>{formatReading(status.nextReading, unit)}</NoBreak> : null} />
        <DetailItem layout="stacked" label="Diferencia" value={status.remaining != null ? remainingText(status, unit) : null} />
        <DetailItem layout="stacked" label="Intervalo que toca" value={status.nextIntervalValue != null ? formatReading(status.nextIntervalValue, unit) : null} />
        <DetailItem
          layout="stacked"
          label="Última preventiva"
          value={last ? <><ValueOnDate value={recordKindText("P", last.intervalValue, unit)} date={last.date} /><PreventiveOrigin preventive={last} declaredBy={data.priorPreventive} /></> : null}
        />
        {/* La declarada guardada, aunque ya mande una firmada más nueva: dato aparte y rotulado. */}
        {data.priorPreventive && !isDeclaredPreventive(last) ? (
          <DetailItem
            layout="stacked"
            label="Preventiva declarada"
            value={(
              <>
                <ValueOnDate value={recordKindText("P", data.priorPreventive.intervalValue, unit)} date={data.priorPreventive.date} />
                <PreventiveOrigin preventive={{ origin: "declarada", evidence: data.priorPreventive.evidence }} declaredBy={data.priorPreventive} />
                <span className="block text-xs font-normal text-[var(--color-text-muted)]">Manda la firmada más reciente.</span>
              </>
            )}
          />
        ) : null}
      </dl>
      {data.gpsStatus ? (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-eyebrow">Estimación {sourceLabel}</p>
            <EquipmentStateBadge state={data.gpsStatus.state} workshop={null} />
            {data.gpsReadingAt ? (
              <span className="text-xs text-[var(--color-text-subtle)]">Lectura del {formatDate(todayInChile(data.gpsReadingAt))}</span>
            ) : null}
          </div>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem
              layout="stacked"
              mono
              label={`Última lectura ${sourceLabel}`}
              value={data.gpsStatus.currentReading
                ? <NoBreak>{formatReading(data.gpsStatus.currentReading.value, unit)}</NoBreak>
                : null}
            />
            <DetailItem
              layout="stacked"
              mono
              label="Próxima lectura estimada"
              value={data.gpsStatus.nextReading != null ? <NoBreak>{formatReading(data.gpsStatus.nextReading, unit)}</NoBreak> : null}
            />
            <DetailItem
              layout="stacked"
              label="Diferencia estimada"
              value={data.gpsStatus.remaining != null ? remainingText(data.gpsStatus, unit) : null}
            />
          </dl>
          <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
            Referencia para programar; no reemplaza la lectura registrada.
          </p>
        </div>
      ) : null}
    </SectionCard>
  )
}

/**
 * Lo que Mantención decide del equipo, en modo lectura: su pauta, en qué se mide, su lectura
 * inicial y si está activo. La identidad —código, patente, tipo y faena— va en la cabecera de la
 * ficha; marca, modelo y año los dice la pestaña Flota y aquí sólo se muestran a quien no la ve
 * (`showIdentity`). Antes esta tarjeta («Ficha») repetía todo eso (crítica 2026-11-15, paso 4b).
 */
export function EquipmentPlanCard({ data, canSeeSchedules, showIdentity }: { data: EquipmentDetailData; canSeeSchedules: boolean; showIdentity: boolean }) {
  const unit = unitName(data.unit)
  return (
    <SectionCard title="Plan de mantención">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem
          layout="stacked"
          label="Pauta"
          value={data.schedule
            ? (canSeeSchedules
              // Objetivo táctil de 44 px en móvil; en escritorio la línea normal.
              ? <Link href={`/mantencion/pautas/${data.schedule.id}`} className="inline-flex min-h-11 items-center text-[var(--color-primary-ink)] underline-offset-2 hover:underline sm:min-h-0">{data.schedule.name}</Link>
              : data.schedule.name)
            : <span className="text-[var(--color-text-muted)]">Sin pauta</span>}
        />
        <DetailItem layout="stacked" label="Se mide en" value={unit.charAt(0).toUpperCase() + unit.slice(1)} />
        <DetailItem layout="stacked" mono label="Lectura inicial" value={data.initialReading ? <ValueOnDate value={<NoBreak>{formatReading(data.initialReading.value, data.unit)}</NoBreak>} date={data.initialReading.date} /> : null} />
        <DetailItem layout="stacked" label="Estado" value={data.retired ? `Dado de baja${data.retiredReason ? ` · ${data.retiredReason}` : ""}` : "Activo"} />
        {showIdentity ? (
          <>
            <DetailItem layout="stacked" label="Marca" value={data.brandName} />
            <DetailItem layout="stacked" label="Modelo" value={data.model} />
            <DetailItem layout="stacked" label="Año" value={data.year} />
          </>
        ) : null}
      </dl>
    </SectionCard>
  )
}
