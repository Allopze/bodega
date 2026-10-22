"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { recomputeProgressLabel } from "@/lib/combustibles/control/catalogs"
import type { PerformanceControlSettings } from "@/lib/combustibles/control/contracts"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatQty } from "@/lib/utils"
import { ConfigSection } from "./config-section"
import { recomputeSeriesBatchAction, savePerformanceThresholdsAction } from "./actions-thresholds"

const decimalText = (value: number) => String(value).replace(".", ",")

export function ThresholdsSection({ settings }: { settings: PerformanceControlSettings }) {
  const op = useOperation({ feedback: "toast" })
  const [minSamples, setMinSamples] = React.useState(decimalText(settings.minSamples))
  const [maxKmPerLiter, setMaxKmPerLiter] = React.useState(decimalText(settings.maxKmPerLiter))
  const [maxLitersPerHour, setMaxLitersPerHour] = React.useState(decimalText(settings.maxLitersPerHour))
  const [windowMinutes, setWindowMinutes] = React.useState(decimalText(settings.duplicateWindowMinutes))
  const [litersTolerance, setLitersTolerance] = React.useState(decimalText(settings.duplicateLitersTolerance))

  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(() => savePerformanceThresholdsAction({
      minSamples,
      maxKmPerLiter,
      maxLitersPerHour,
      duplicateWindowMinutes: windowMinutes,
      duplicateLitersTolerance: litersTolerance,
    }))
  }

  return (
    <ConfigSection
      id="umbrales"
      title="Umbrales de control"
      description="Deciden cuándo una carga queda en revisión. Los cambios rigen para las cargas nuevas y para las que se recalculen; guardarlos no modifica lo ya calculado."
    >
      <form onSubmit={submit} noValidate className="max-w-3xl">
        <p className="mb-4 text-sm text-[var(--color-text)]">
          Una carga es atípica cuando se aleja más de <strong className="tabular-nums">{formatQty(settings.thresholdStdDevs)}</strong> desviaciones estándar del historial de su equipo.
          <span className="text-[var(--color-text-muted)]"> Este valor sale de la regla «rendimiento fuera del histórico», no se edita aquí: </span>
          <Link href="/combustibles/anomalias/reglas" className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2">cambiarlo en las reglas de anomalías</Link>.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Cargas mínimas para juzgar atípicos" htmlFor="thr-min-samples" helper="Cargas previas válidas del equipo (entre 2 y 100)." error={op.fieldError("minSamples")}>
            <Input id="thr-min-samples" inputMode="numeric" value={minSamples} onChange={(event) => setMinSamples(event.target.value)} error={!!op.fieldError("minSamples")} className="tabular-nums" />
          </Field>
          <Field label="Máximo físico (km/L)" htmlFor="thr-max-km" helper="Sobre esto es implausible (hasta 200)." error={op.fieldError("maxKmPerLiter")}>
            <Input id="thr-max-km" inputMode="decimal" value={maxKmPerLiter} onChange={(event) => setMaxKmPerLiter(event.target.value)} error={!!op.fieldError("maxKmPerLiter")} className="tabular-nums" />
          </Field>
          <Field label="Máximo físico (L/h)" htmlFor="thr-max-lh" helper="Sobre esto es implausible (hasta 2.000)." error={op.fieldError("maxLitersPerHour")}>
            <Input id="thr-max-lh" inputMode="decimal" value={maxLitersPerHour} onChange={(event) => setMaxLitersPerHour(event.target.value)} error={!!op.fieldError("maxLitersPerHour")} className="tabular-nums" />
          </Field>
          <Field label="Ventana de duplicados (minutos)" htmlFor="thr-window" helper="Misma carga llegada por dos canales (de 1 a 1.440 minutos)." error={op.fieldError("duplicateWindowMinutes")}>
            <Input id="thr-window" inputMode="numeric" value={windowMinutes} onChange={(event) => setWindowMinutes(event.target.value)} error={!!op.fieldError("duplicateWindowMinutes")} className="tabular-nums" />
          </Field>
          <Field label="Diferencia de litros en duplicados (L)" htmlFor="thr-liters" helper="Admite coma decimal (de 0 a 100 L)." error={op.fieldError("duplicateLitersTolerance")}>
            <Input id="thr-liters" inputMode="decimal" value={litersTolerance} onChange={(event) => setLitersTolerance(event.target.value)} error={!!op.fieldError("duplicateLitersTolerance")} className="tabular-nums" />
          </Field>
        </div>
        {op.message ? <p role="alert" className="mt-3 text-sm text-[var(--color-danger-ink)]">{op.message}</p> : null}
        <div className="mt-4">
          <Button type="submit" loading={op.pending}>Guardar umbrales</Button>
        </div>
      </form>
      <RecomputeSeries />
    </ConfigSection>
  )
}

function RecomputeSeries() {
  const [running, setRunning] = React.useState(false)
  const [progress, setProgress] = React.useState<{ processed: number; total: number } | null>(null)
  const stopRef = React.useRef(false)

  async function start() {
    stopRef.current = false
    setRunning(true)
    setProgress(null)
    let cursor: string | null = null
    let processed = 0
    try {
      while (!stopRef.current) {
        const result = await recomputeSeriesBatchAction({ cursor })
        if (!result.ok || !result.data) {
          toast.error(result.message ?? "No se pudo recalcular las series")
          return
        }
        processed += result.data.processed
        setProgress({ processed, total: result.data.total })
        if (result.data.done) {
          toast.success(processed === 0 ? "No hay equipos con cargas para recalcular" : `Series recalculadas: ${recomputeProgressLabel(processed, result.data.total)}`)
          return
        }
        cursor = result.data.nextCursor
      }
      toast.info("Recálculo detenido. Puedes volver a iniciarlo cuando quieras.")
    } catch {
      toast.error("Se interrumpió el recálculo. Revisa la conexión e inténtalo de nuevo.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mt-8 max-w-3xl border-t border-[var(--color-border)] pt-6">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">Recalcular series de rendimiento</h3>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Vuelve a calcular el rendimiento y las marcas de revisión de las cargas de los equipos de tus faenas con los umbrales vigentes.
        Se procesa por lotes de 25 equipos y puedes detenerlo en cualquier momento; lo ya recalculado se conserva.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={start} loading={running}>{running ? "Recalculando…" : "Recalcular series"}</Button>
        {running ? <Button variant="ghost" onClick={() => { stopRef.current = true }}>Detener</Button> : null}
      </div>
      {progress ? (
        <div className="mt-3 max-w-md" aria-live="polite">
          <Progress value={progress.processed} max={Math.max(progress.total, 1)} label={`Avance del recálculo: ${recomputeProgressLabel(progress.processed, progress.total)}`} />
          <p className="mt-1 text-xs tabular-nums text-[var(--color-text-muted)]">{recomputeProgressLabel(progress.processed, progress.total)}</p>
        </div>
      ) : null}
    </div>
  )
}
