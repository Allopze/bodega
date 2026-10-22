"use client"

import * as React from "react"
import Image from "next/image"
import { Textarea } from "@/components/ui/textarea"
import { formatQty } from "@/lib/utils"
import { parseFieldNumber } from "@/lib/combustibles/field-load-number"
import { EVIDENCE_LABELS } from "@/lib/combustibles/field-load-rules"
import type { TaeEvidenceKind } from "@/lib/validation/fuel-tae"
import { BigField } from "./big-controls"
import { effectiveSeals, vehicleOf } from "./validate"
import type { StepViewProps } from "./step-props"
import type { FieldLoadStep } from "./types"

function Row({ label, value, step, onEdit }: { label: string; value: React.ReactNode; step: FieldLoadStep; onEdit: (step: FieldLoadStep) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] py-3">
      <div className="min-w-0">
        <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
        <dd className="text-lg font-semibold break-words">{value}</dd>
      </div>
      <button type="button" className="min-h-14 shrink-0 px-2 text-base font-semibold text-[var(--color-primary-ink)] underline" onClick={() => onEdit(step)}>
        Cambiar<span className="sr-only"> {label.toLocaleLowerCase("es-CL")}</span>
      </button>
    </div>
  )
}

function PhotoThumb({ kind, file }: { kind: TaeEvidenceKind; file: File }) {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return (
    <figure className="w-20">
      {url && <Image unoptimized src={url} alt={EVIDENCE_LABELS[kind]} width={160} height={120} className="h-16 w-20 rounded-[var(--radius-sm)] object-cover" />}
      <figcaption className="mt-1 text-xs text-[var(--color-text-muted)]">{EVIDENCE_LABELS[kind].replace("Foto del ", "").replace("Foto de ", "")}</figcaption>
    </figure>
  )
}

/** Paso 6: todo lo contestado en una pantalla, cada dato con su «Cambiar», antes de «Enviar carga». */
export function StepReview({ config, draft, photos, driver, supervisor, patch, goTo, loadingPointName }: StepViewProps & { goTo: (step: FieldLoadStep) => void; loadingPointName: string | null }) {
  const vehicle = vehicleOf(config, draft)
  const product = vehicle?.products.find((item) => item.id === draft.productId)
  const medium = config.supplyMedia.find((item) => item.id === draft.supplyMediumId)
  const seals = effectiveSeals(draft)
  const reading = parseFieldNumber(draft.meterReading)
  const liters = parseFieldNumber(draft.liters)
  const driverName = driver.matched?.name ?? draft.driverName
  const supervisorName = supervisor.matched?.name ?? draft.supervisorName
  const photoEntries = (Object.keys(photos) as TaeEvidenceKind[]).filter((kind) => photos[kind])
  const sealText = (value: string, none: boolean) => none || !value ? "Sin sello" : value
  return (
    <div className="space-y-5">
      <p className="text-base text-[var(--color-text-muted)]">Revisa que todo esté bien. Si algo no coincide, toca «Cambiar».</p>
      <dl>
        <Row label="Equipo" value={vehicle ? `${vehicle.code ?? vehicle.plate} · ${vehicle.plate}` : "—"} step="vehicle" onEdit={goTo} />
        <Row label="Combustible y medio" value={`${product?.name ?? "—"} · ${medium?.name ?? "—"}`} step="vehicle" onEdit={goTo} />
        <Row label={vehicle?.meterType === "hour_meter" ? "Horómetro" : "Odómetro"} value={vehicle?.meterType === "none" ? "Sin medidor" : reading != null ? formatQty(reading) : "—"} step="meter" onEdit={goTo} />
        <Row label="Litros" value={liters != null ? `${formatQty(liters)} L` : "—"} step="liters" onEdit={goTo} />
        <Row label="Sello retirado" value={sealText(seals.removedSealNumber, draft.noRemovedSeal)} step="seals" onEdit={goTo} />
        <Row label="Sello nuevo" value={sealText(seals.installedSealNumber, draft.noInstalledSeal)} step="seals" onEdit={goTo} />
        {(draft.noRemovedSeal || draft.noInstalledSeal) && <Row label="Motivo sin sello" value={draft.noSealReason || "—"} step="seals" onEdit={goTo} />}
        <Row label="Conductor" value={driverName || "—"} step="people" onEdit={goTo} />
        <Row label="Supervisor" value={supervisorName || "—"} step="people" onEdit={goTo} />
        {loadingPointName && <div className="border-b border-[var(--color-border)] py-3"><dt className="text-sm text-[var(--color-text-muted)]">Lugar de carga</dt><dd className="text-lg font-semibold">{loadingPointName}</dd></div>}
      </dl>
      {photoEntries.length > 0 && (
        <div className="flex flex-wrap gap-3" aria-label="Fotos adjuntas">
          {photoEntries.map((kind) => <PhotoThumb key={kind} kind={kind} file={photos[kind]!} />)}
        </div>
      )}
      <BigField id="tae-notes" label="Observaciones (opcional)">
        <Textarea id="tae-notes" name="notes" rows={3} value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} className="text-base" />
      </BigField>
      <p className="text-sm text-[var(--color-text-muted)]">Al enviar, la plataforma registra la fecha y la hora. Sin conexión se usa la hora del teléfono.</p>
    </div>
  )
}
