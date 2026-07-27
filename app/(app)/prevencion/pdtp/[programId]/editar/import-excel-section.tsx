"use client"

/**
 * Sección de importación de un programa PDTP desde Excel.
 *
 * Extraída de `builder-tabs.tsx` para poder reutilizarla desde la página de
 * detalle del programa (`/prevencion/pdtp/[programId]`) — donde el botón de
 * importación es realmente visible — sin duplicar ~230 líneas de lógica de
 * stage/apply/cancel contra `/api/prevencion/pdtp/import`.
 *
 * Va contra una API route, no un Server Action: el workbook real
 * ("PROGRAMA DE TRABAJO PREVENTIVO SG-SST.xlsx") pesa ~4-5 MB y Next.js
 * limita el body de los Server Actions a 1 MB por defecto — con un
 * Server Action esto fallaba en runtime con "Body exceeded 1 MB limit"
 * para cualquier archivo real (mismo patrón que pdtp-execution-form.tsx).
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileInput } from "@/components/ui/file-input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type ImportPreview = {
  batchId: string
  status: string
  source: { fileName: string; checksumSha256: string; sizeBytes: number }
  counts: {
    objectives: number; activities: number; plannedCells: number; plannedQuantity: number
    executedCells: number; executedQuantity: number; views: number
    creates: number; updates: number; unchanged: number; existingExtraActivitiesPreserved: number
    calendarCellsAdded: number; calendarCellsUpdated: number; calendarCellsRemoved: number
    scheduleRowsReplaced: number; viewMembershipsAdded: number; viewMembershipsRemoved: number
    viewMembershipRowsReplaced: number; checklistBindingsPreserved: number; sourceLinksPreserved: number
    checklistBindingsLost: number; sourceLinksLost: number; scheduleClassificationsPending: number
  }
  calendarChanges: Array<{ activityNumber: number; added: number; updated: number; removed: number }>
  executions: Array<{ activityNumber: number; month: number; week: number; executedQuantity: number; sourceCell: string }>
  metadata?: { documentCode?: string | null; indicatorTarget?: number | null; indicatorPeriodicity?: string | null } | null
  warnings: string[]
  blockingErrors: string[]
}

export type ImportExcelSectionProps = {
  programId: string
  visibleWorksites: Array<{ id: string; name: string; code: string }>
}

export function ImportExcelSection({ programId, visibleWorksites }: ImportExcelSectionProps) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [state, setState] = React.useState<{ ok: boolean; message: string } | null>(null)
  const [preview, setPreview] = React.useState<ImportPreview | null>(null)
  const [worksiteId, setWorksiteId] = React.useState(visibleWorksites.length === 1 ? visibleWorksites[0]!.id : "")
  const [acceptMissingEvidence, setAcceptMissingEvidence] = React.useState(false)
  const [acceptanceReason, setAcceptanceReason] = React.useState("")
  const [confirmCancel, setConfirmCancel] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState("")

  async function handleStage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setPending(true)
    setState(null)
    try {
      const fd = new FormData()
      fd.set("mode", "stage")
      fd.set("programId", programId)
      fd.set("file", file)
      const res = await fetch("/api/prevencion/pdtp/import", { method: "POST", body: fd })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setState({ ok: false, message: json.error ?? "Error al importar el Excel." })
      } else {
        const json = await res.json()
        setState({ ok: true, message: json.message })
        setPreview(json.preview as ImportPreview)
        formRef.current?.reset()
      }
    } catch {
      setState({ ok: false, message: "Error de red al importar el Excel." })
    } finally {
      setPending(false)
    }
  }

  async function handleApply() {
    if (!preview) return
    setPending(true)
    setState(null)
    try {
      const fd = new FormData()
      fd.set("mode", "apply")
      fd.set("batchId", preview.batchId)
      if (worksiteId) fd.set("worksiteId", worksiteId)
      fd.set("acceptMissingEvidence", String(acceptMissingEvidence))
      fd.set("acceptanceReason", acceptanceReason)
      const res = await fetch("/api/prevencion/pdtp/import", { method: "POST", body: fd })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setState({ ok: false, message: json.error ?? "No se pudo aplicar el lote." })
      } else {
        const json = await res.json()
        setState({ ok: true, message: json.message })
        setPreview(null)
        router.refresh()
      }
    } catch {
      setState({ ok: false, message: "Error de red al aplicar el lote." })
    } finally {
      setPending(false)
    }
  }

  async function handleCancel() {
    if (!preview || cancelReason.trim().length < 10) {
      setState({ ok: false, message: "Indica un motivo de cancelación de al menos 10 caracteres." })
      return
    }
    setPending(true)
    setState(null)
    try {
      const fd = new FormData()
      fd.set("mode", "cancel")
      fd.set("batchId", preview.batchId)
      fd.set("reason", cancelReason)
      const res = await fetch("/api/prevencion/pdtp/import", { method: "POST", body: fd })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setState({ ok: false, message: json.error ?? "No se pudo cancelar el lote." })
      } else {
        const json = await res.json()
        setState({ ok: true, message: json.message })
        setPreview(null)
        setConfirmCancel(false)
        setCancelReason("")
      }
    } catch {
      setState({ ok: false, message: "Error de red al cancelar el lote." })
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Migrar un programa desde Excel</h3>
      <p className="mb-3 max-w-2xl text-xs leading-5 text-[var(--color-text-muted)]">
        El archivo se analiza primero y no cambia el programa hasta que confirmes el preview. El adaptador traduce su contenido al modelo general; no convierte la planilla en la interfaz de trabajo.
      </p>
      {!preview ? (
        <form ref={formRef} onSubmit={handleStage} className="max-w-md space-y-3">
          <FileInput ref={fileRef} name="file" accept=".xlsx" required />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Analizando..." : "Analizar Excel"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">Preview listo: {preview.source.fileName}</p>
              <p className="mt-1 font-mono text-[11px] text-[var(--color-text-subtle)]">SHA-256 {preview.source.checksumSha256.slice(0, 16)}…</p>
            </div>
            <Badge variant="info" size="sm">Sin aplicar</Badge>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Objetivos", preview.counts.objectives], ["Actividades", preview.counts.activities],
              ["Vistas", preview.counts.views], ["Celdas P", preview.counts.plannedCells],
              ["Total P", preview.counts.plannedQuantity], ["Por clasificar", preview.counts.scheduleClassificationsPending],
            ].map(([label, value]) => <div key={label} className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2"><dt className="text-xs text-[var(--color-text-muted)]">{label}</dt><dd className="mt-0.5 font-semibold text-[var(--color-text)]">{value}</dd></div>)}
          </dl>
          <p className="text-xs text-[var(--color-text-muted)]">
            {preview.counts.creates} altas · {preview.counts.updates} actualizaciones · {preview.counts.unchanged} sin cambios · {preview.counts.existingExtraActivitiesPreserved} actividad(es) adicionales preservadas.
          </p>
          <div className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 text-xs sm:grid-cols-2">
            <div>
              <p className="font-semibold text-[var(--color-text)]">Impacto en calendario y vistas</p>
              <p className="mt-1 leading-5 text-[var(--color-text-muted)]">
                Calendario: +{preview.counts.calendarCellsAdded} · ~{preview.counts.calendarCellsUpdated} · −{preview.counts.calendarCellsRemoved}. Se reemplazarán {preview.counts.scheduleRowsReplaced} fila(s) existentes.
              </p>
              <p className="leading-5 text-[var(--color-text-muted)]">
                Vistas: +{preview.counts.viewMembershipsAdded} · −{preview.counts.viewMembershipsRemoved}. Se reemplazarán {preview.counts.viewMembershipRowsReplaced} membresía(s) existentes.
              </p>
            </div>
            <div>
              <p className="font-semibold text-[var(--color-text)]">Relaciones protegidas</p>
              <p className="mt-1 leading-5 text-[var(--color-text-muted)]">
                {preview.counts.checklistBindingsPreserved} checklist(s) y {preview.counts.sourceLinksPreserved} vínculo(s) de fuente se conservan. Pérdidas previstas: {preview.counts.checklistBindingsLost + preview.counts.sourceLinksLost}.
              </p>
            </div>
            {preview.calendarChanges.length > 0 && (
              <details className="sm:col-span-2">
                <summary className="cursor-pointer font-medium text-[var(--color-text)]">Ver {preview.calendarChanges.length} actividad(es) con cambio de calendario</summary>
                <ul className="mt-2 max-h-36 overflow-y-auto space-y-1 text-[var(--color-text-subtle)]">
                  {preview.calendarChanges.map((change) => <li key={change.activityNumber}>Actividad {change.activityNumber}: +{change.added} · ~{change.updated} · −{change.removed}</li>)}
                </ul>
              </details>
            )}
          </div>
          {preview.warnings.length > 0 && <ul className="space-y-1 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">{preview.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>}

          {preview.counts.executedCells > 0 && (
            <div className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 md:grid-cols-2">
              <Field label="Faena de las cantidades ejecutadas" htmlFor="pdtp-import-worksite" required>
                <Select value={worksiteId} onValueChange={setWorksiteId}>
                  <SelectTrigger id="pdtp-import-worksite"><SelectValue placeholder="Selecciona una faena autorizada" /></SelectTrigger>
                  <SelectContent>{visibleWorksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name} · {worksite.code}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Motivo de aceptación" htmlFor="pdtp-import-reason" helper="Se conservará junto al lote y las celdas de origen.">
                <Textarea id="pdtp-import-reason" value={acceptanceReason} onChange={(event) => setAcceptanceReason(event.target.value)} rows={2} placeholder="Ej.: histórico validado por Jefatura de Prevención" />
              </Field>
              <label className="flex items-start gap-2 text-xs text-[var(--color-text-muted)] md:col-span-2">
                <input type="checkbox" className="mt-0.5" checked={acceptMissingEvidence} onChange={(event) => setAcceptMissingEvidence(event.target.checked)} />
                Acepto migrar {preview.counts.executedCells} celda(s) E como reportadas sin evidencia adjunta; no se inventará un archivo ni un ejecutor histórico.
              </label>
              <ul className="max-h-32 overflow-y-auto text-xs text-[var(--color-text-subtle)] md:col-span-2">
                {preview.executions.map((execution) => <li key={execution.sourceCell}>Actividad {execution.activityNumber} · mes {execution.month}, semana {execution.week} · {execution.executedQuantity} · celda {execution.sourceCell}</li>)}
              </ul>
            </div>
          )}
          {confirmCancel && (
            <div className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3">
              <Field label="Motivo para cancelar el preview" htmlFor="pdtp-import-cancel-reason" helper="El lote quedará en el historial; el programa seguirá intacto.">
                <Textarea id="pdtp-import-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} placeholder="Ej.: el archivo no corresponde a la versión vigente" />
              </Field>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-3">
            {confirmCancel ? (
              <>
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setConfirmCancel(false); setCancelReason("") }}>Volver</Button>
                <Button type="button" variant="destructive" size="sm" disabled={pending || cancelReason.trim().length < 10} onClick={handleCancel}>{pending ? "Cancelando..." : "Confirmar cancelación"}</Button>
              </>
            ) : (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setConfirmCancel(true); setState(null) }}>Cancelar preview</Button>
            )}
            <Button type="button" size="sm" disabled={pending || preview.blockingErrors.length > 0 || (preview.counts.executedCells > 0 && (!worksiteId || !acceptMissingEvidence || acceptanceReason.trim().length < 10))} onClick={handleApply}>
              {pending ? "Aplicando..." : "Aplicar lote"}
            </Button>
          </div>
        </div>
      )}
      {state?.message && (
        <p role="status" className={`mt-3 rounded-[var(--radius)] border px-3 py-2 text-sm ${state.ok
          ? "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success)]"
          : "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger)]"}`}>
          {state.message}
        </p>
      )}
    </div>
  )
}
