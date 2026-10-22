"use client"

import { BigField, BigNumberInput, StepNotice } from "./big-controls"
import { PhotoTile } from "./photo-tile"
import { vehicleOf } from "./validate"
import type { StepViewProps } from "./step-props"

/** Paso 2: lo que marca el tablero, escrito por la persona (la foto es respaldo). */
export function StepMeter({ config, draft, photos, errors, patch, selectPhoto, compressing }: StepViewProps) {
  const vehicle = vehicleOf(config, draft)
  const meterLabel = vehicle?.meterType === "hour_meter" ? "Horómetro (horas)" : "Odómetro (kilómetros)"
  return (
    <div className="space-y-6">
      {vehicle?.meterType === "none" ? (
        <StepNotice tone="info">Este equipo no tiene medidor que anotar. Solo toma la foto del tablero.</StepNotice>
      ) : (
        <BigField id="tae-meter-reading" label={meterLabel} hint="Escribe el número tal como aparece en el tablero. Sin puntos; si tiene decimales, usa coma." error={errors.meterReading}>
          <BigNumberInput id="tae-meter-reading" name="meterReading" value={draft.meterReading} onChange={(event) => patch({ meterReading: event.target.value })} error={Boolean(errors.meterReading)} aria-describedby="tae-meter-reading-hint" />
        </BigField>
      )}
      <PhotoTile kind="odometer" label="Tomar foto del tablero" help="Que se vea el número del medidor." file={photos.odometer} compressing={Boolean(compressing.odometer)} error={errors.odometer} onSelect={(file) => selectPhoto("odometer", file)} />
    </div>
  )
}

/** Paso 3: cuántos litros entregó el surtidor, con la foto del medidor. */
export function StepLiters({ config, draft, photos, errors, patch, selectPhoto, compressing }: StepViewProps) {
  const capacity = vehicleOf(config, draft)?.tankCapacityLiters
  return (
    <div className="space-y-6">
      <BigField id="tae-liters" label="Litros cargados" hint={capacity ? `Estanque del equipo: ${capacity.toLocaleString("es-CL")} L. Si tiene decimales, usa coma.` : "Si tiene decimales, usa coma."} error={errors.liters}>
        <BigNumberInput id="tae-liters" name="liters" value={draft.liters} onChange={(event) => patch({ liters: event.target.value })} error={Boolean(errors.liters)} aria-describedby="tae-liters-hint" />
      </BigField>
      <PhotoTile kind="liter_meter" label="Tomar foto del medidor de litros" help="Que se vean los litros que marca el surtidor." file={photos.liter_meter} compressing={Boolean(compressing.liter_meter)} error={errors.liter_meter} onSelect={(file) => selectPhoto("liter_meter", file)} />
    </div>
  )
}
