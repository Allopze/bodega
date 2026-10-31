"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { recomputeProgressLabel, recomputeSummaryText, type RecomputeSummary } from "@/lib/combustibles/control/catalogs"
import type { PerformanceControlSettings } from "@/lib/combustibles/control/contracts"
import { fuelInboxHref, FUEL_PATHS } from "@/lib/combustibles/routes"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { formatQty } from "@/lib/utils"
import { recomputeSeriesBatchAction, savePerformanceThresholdsAction } from "../actions-thresholds"

const decimalText = (value: number) => String(value).replace(".", ",")

export function ThresholdsForm({ settings }: { settings: PerformanceControlSettings }) {
  const save = useOperation()
  const [minSamples, setMinSamples] = React.useState(decimalText(settings.minSamples))
  const [maxKmPerLiter, setMaxKmPerLiter] = React.useState(decimalText(settings.maxKmPerLiter))
  const [maxLitersPerHour, setMaxLitersPerHour] = React.useState(decimalText(settings.maxLitersPerHour))
  const [windowMinutes, setWindowMinutes] = React.useState(decimalText(settings.duplicateWindowMinutes))
  const [litersTolerance, setLitersTolerance] = React.useState(decimalText(settings.duplicateLitersTolerance))

  const [running, setRunning] = React.useState(false)
  const [progress, setProgress] = React.useState<{ processed: number; total: number } | null>(null)
  const [summary, setSummary] = React.useState<RecomputeSummary | null>(null)
  const stopRef = React.useRef(false)

  /**
   * Recorre los equipos por lotes (cada solicitud es corta) y suma lo que
   * cambió. Se puede detener: lo ya recalculado se conserva.
   */
  async function recompute() {
    stopRef.current = false
    setRunning(true)
    setProgress(null)
    setSummary(null)
    let cursor: string | null = null
    const totals = { equipment: 0, changedLoads: 0, flagged: 0, released: 0 }
    try {
      while (!stopRef.current) {
        const result = await recomputeSeriesBatchAction({ cursor })
        if (!result.ok || !result.data) {
          toast.error(result.message ?? "No se pudo recalcular las cargas anteriores")
          if (totals.equipment > 0) setSummary({ ...totals, stopped: true })
          return
        }
        totals.equipment += result.data.processed
        totals.changedLoads += result.data.changedLoads
        totals.flagged += result.data.flagged
        totals.released += result.data.released
        setProgress({ processed: totals.equipment, total: result.data.total })
        if (result.data.done) {
          setSummary({ ...totals, stopped: false })
          return
        }
        cursor = result.data.nextCursor
      }
      setSummary({ ...totals, stopped: true })
    } catch {
      toast.error("Se interrumpió el recálculo. Revisa la conexión e inténtalo de nuevo.")
      if (totals.equipment > 0) setSummary({ ...totals, stopped: true })
    } finally {
      setRunning(false)
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    save.run(
      () => savePerformanceThresholdsAction({
        minSamples,
        maxKmPerLiter,
        maxLitersPerHour,
        duplicateWindowMinutes: windowMinutes,
        duplicateLitersTolerance: litersTolerance,
      }),
      (result) => {
        toast.success(result.message ?? "Umbrales guardados.")
        // Sólo se recalcula lo anterior cuando algún valor cambió de verdad.
        if (result.data?.changed) void recompute()
      },
    )
  }

  const busy = save.pending || running

  return (
    <div className="max-w-3xl space-y-8">
      <form onSubmit={submit} noValidate>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field label="Cargas mínimas para juzgar un rendimiento raro" htmlFor="thr-min-samples" helper="Con menos cargas, la plataforma no compara contra el historial del equipo. Entre 2 y 100." error={save.fieldError("minSamples")}>
            <Input id="thr-min-samples" inputMode="numeric" value={minSamples} onChange={(event) => setMinSamples(event.target.value)} error={!!save.fieldError("minSamples")} className="max-w-36 font-mono tabular-nums" />
          </Field>
          <div className="flex flex-col gap-0">
            <p className="mb-1.5 text-sm font-medium leading-tight text-[var(--color-text)]">Rendimiento atípico</p>
            <p className="font-mono text-sm tabular-nums text-[var(--color-text)]">{formatQty(settings.thresholdStdDevs)} veces su variación normal</p>
            <p className="mt-1.5 text-xs leading-tight text-[var(--color-text-subtle)]">
              Se comparte con la regla «Rendimiento fuera del historial del equipo».{" "}
              <Link href={FUEL_PATHS.ajustesReglas} className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2">Cambiarlo en las reglas de detección</Link>.
            </p>
          </div>
          <Field label="Máximo posible, en kilómetros por litro" htmlFor="thr-max-km" helper="Sobre esto, la lectura está mal casi seguro (hasta 200)." error={save.fieldError("maxKmPerLiter")}>
            <Input id="thr-max-km" inputMode="decimal" value={maxKmPerLiter} onChange={(event) => setMaxKmPerLiter(event.target.value)} error={!!save.fieldError("maxKmPerLiter")} className="max-w-36 font-mono tabular-nums" />
          </Field>
          <Field label="Máximo posible, en litros por hora" htmlFor="thr-max-lh" helper="Sobre esto, la lectura está mal casi seguro (hasta 2.000)." error={save.fieldError("maxLitersPerHour")}>
            <Input id="thr-max-lh" inputMode="decimal" value={maxLitersPerHour} onChange={(event) => setMaxLitersPerHour(event.target.value)} error={!!save.fieldError("maxLitersPerHour")} className="max-w-36 font-mono tabular-nums" />
          </Field>
          <Field label="Duplicadas: minutos de diferencia" htmlFor="thr-window" helper="Dos cargas del mismo equipo dentro de este margen… (de 1 a 1.440 minutos)." error={save.fieldError("duplicateWindowMinutes")}>
            <Input id="thr-window" inputMode="numeric" value={windowMinutes} onChange={(event) => setWindowMinutes(event.target.value)} error={!!save.fieldError("duplicateWindowMinutes")} className="max-w-36 font-mono tabular-nums" />
          </Field>
          <Field label="Duplicadas: litros de diferencia" htmlFor="thr-liters" helper="…y con esta diferencia de litros se consideran la misma carga. Admite coma decimal (de 0 a 100)." error={save.fieldError("duplicateLitersTolerance")}>
            <Input id="thr-liters" inputMode="decimal" value={litersTolerance} onChange={(event) => setLitersTolerance(event.target.value)} error={!!save.fieldError("duplicateLitersTolerance")} className="max-w-36 font-mono tabular-nums" />
          </Field>
        </div>
        {save.message ? <p role="alert" className="mt-3 text-sm text-[var(--color-danger-ink)]">{save.message}</p> : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.pending} disabled={running}>Guardar</Button>
          <Button type="button" variant="secondary" onClick={() => void recompute()} loading={running} disabled={busy}>
            {running ? "Recalculando…" : "Recalcular las cargas anteriores"}
          </Button>
          {running ? <Button type="button" variant="ghost" onClick={() => { stopRef.current = true }}>Detener</Button> : null}
        </div>
        <p className="mt-2 max-w-2xl text-xs text-[var(--color-text-subtle)]">
          Al guardar un valor distinto, la plataforma vuelve a revisar las cargas anteriores de tus faenas con los umbrales nuevos y te dice cuántas cambiaron.
          Se hace por lotes de 25 equipos y puedes detenerlo cuando quieras: lo ya recalculado se conserva.
        </p>
      </form>

      <div aria-live="polite" className="space-y-3">
        {progress && running ? (
          <div className="max-w-md">
            <Progress value={progress.processed} max={Math.max(progress.total, 1)} label={`Avance del recálculo: ${recomputeProgressLabel(progress.processed, progress.total)}`} />
            <p className="mt-1 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{recomputeProgressLabel(progress.processed, progress.total)}</p>
          </div>
        ) : null}
        {summary && !running ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text)]">
            <p>{recomputeSummaryText(summary)}</p>
            {summary.flagged > 0 ? (
              <p className="mt-2">
                <Link href={fuelInboxHref({ tipo: "carga" })} className="font-medium text-[var(--color-primary-ink)] underline underline-offset-2">Ver las cargas por decidir</Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
