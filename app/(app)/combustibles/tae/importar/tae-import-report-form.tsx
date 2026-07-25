"use client"

import { useReducer } from "react"
import { FileXls, Upload } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import type { TaeImportMappingDecision, TaeImportPreview } from "@/lib/combustibles/tae-import-service"
import { generateTaeImportReportAction, importTaeHistoryAction } from "./actions"

type ImportResult = { importedRows: number; validatedRows: number; observedRows: number; invalidRows: number; totalLiters: number }
type ImportState = { file: File | null; loading: boolean; reportGenerated: boolean; confirmed: boolean; preview: TaeImportPreview | null; decisions: Record<string, string | null>; result: ImportResult | null }
type ImportAction =
  | { type: "fileSelected"; file: File | null }
  | { type: "loading"; value: boolean }
  | { type: "previewReady"; preview: TaeImportPreview }
  | { type: "confirmed"; value: boolean }
  | { type: "decision"; key: string; value: string }
  | { type: "result"; value: ImportResult }

const initialState: ImportState = { file: null, loading: false, reportGenerated: false, confirmed: false, preview: null, decisions: {}, result: null }

function reducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case "fileSelected": return { ...initialState, file: action.file }
    case "loading": return { ...state, loading: action.value }
    case "previewReady": return { ...state, reportGenerated: true, confirmed: false, preview: action.preview, decisions: {}, result: null }
    case "confirmed": return { ...state, confirmed: action.value }
    case "decision": {
      const decisions = { ...state.decisions }
      if (!action.value) delete decisions[action.key]
      else decisions[action.key] = action.value === "__none__" ? null : action.value
      return { ...state, confirmed: false, decisions }
    }
    case "result": return { ...state, loading: false, result: action.value }
  }
}

export function TaeImportReportForm() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const { file, loading, reportGenerated, confirmed, preview, decisions, result } = state

  function updateDecision(key: string, value: string) {
    dispatch({ type: "decision", key, value })
  }

  async function handleGenerate() {
    if (!file) { toast.error("Selecciona el archivo Excel del histórico TAE"); return }
    dispatch({ type: "loading", value: true })
    try {
      const formData = new FormData()
      formData.set("file", file)
      const result = await generateTaeImportReportAction(formData)
      if (result.ok && result.data) {
        const link = document.createElement("a")
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data.base64}`
        link.download = result.data.filename
        link.click()
        dispatch({ type: "previewReady", preview: result.data.preview })
        toast.success("Reporte generado. Revisa el archivo antes de aprobar cualquier match.")
      } else {
        toast.error(result.message ?? "No se pudo generar el reporte")
      }
    } catch {
      toast.error("No se pudo generar el reporte")
    } finally {
      dispatch({ type: "loading", value: false })
    }
  }

  async function handleImport() {
    if (!file || !confirmed || !reportGenerated) return
    dispatch({ type: "loading", value: true })
    try {
      const formData = new FormData()
      formData.set("file", file)
      formData.set("confirmation", "IMPORTAR")
      const manualMappings: TaeImportMappingDecision[] = Object.entries(decisions).flatMap(([key, targetId]) => {
        const item = preview?.reviewItems.find((candidate) => candidate.key === key)
        return item ? [{ kind: item.kind, worksiteId: item.worksiteId, legacyValue: item.legacyValue, targetId }] : []
      })
      formData.set("manualMappings", JSON.stringify(manualMappings))
      const response = await importTaeHistoryAction(formData)
      if (response.ok && response.data) {
        dispatch({ type: "result", value: response.data })
        toast.success(response.message)
      } else toast.error(response.message ?? "No se pudo importar el histórico")
    } catch {
      toast.error("No se pudo importar el histórico")
    } finally { dispatch({ type: "loading", value: false }) }
  }

  const pendingDecisions = preview?.reviewItems.filter((item) => !Object.prototype.hasOwnProperty.call(decisions, item.key)).length ?? 0

  return (
    <div className="space-y-4 border border-(--color-border) bg-(--color-surface) p-5">
      <div>
        <p className="text-eyebrow">Reporte de mapeo sugerido</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Sube el Excel del control manual TAE. Se genera un Excel de solo lectura con la faena, equipo, conductor y
          supervisor sugeridos para cada fila (con nivel de confianza), más observaciones de continuidad de sello y
          lecturas. Descarga y revisa ese reporte antes de habilitar la importación definitiva.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 border border-dashed border-(--color-border-strong) bg-(--color-surface-2) px-4 py-3 text-sm">
          <Upload size={16} />
          {file ? file.name : "Seleccionar archivo .xlsx"}
          <input type="file" accept=".xlsx" className="sr-only" onChange={(event) => dispatch({ type: "fileSelected", file: event.target.files?.[0] ?? null })} />
        </label>
        <Button onClick={handleGenerate} disabled={loading || !file}>
          <FileXls className="mr-1 h-4 w-4" />
          {loading ? "Generando..." : "Generar reporte"}
        </Button>
      </div>
      {reportGenerated && preview && !result && <section className="space-y-4 border-t border-(--color-border) pt-4" aria-labelledby="tae-preview-title">
        <div className="grid gap-3 sm:grid-cols-4">
          <PreviewMetric label="Filas válidas" value={preview.summary.validRows} />
          <PreviewMetric label="Litros válidos" value={`${preview.summary.totalLiters.toLocaleString("es-CL")} L`} />
          <PreviewMetric label="Sello observadas" value={preview.sealObservations} />
          <PreviewMetric label="Filas rechazadas" value={preview.planned.rejectedRows} />
        </div>
        <div>
          <h2 id="tae-preview-title" className="text-sm font-semibold">Revisión previa a la importación</h2>
          <p className="mt-1 text-sm text-(--color-text-muted)">
            El dry-run dejó {preview.reviewItems.length.toLocaleString("es-CL")} identidades ambiguas. Cada una debe quedar asignada a su catálogo o marcada explícitamente como “Sin equivalente”.
          </p>
        </div>
        {preview.reviewItems.length > 0 && <ul className="space-y-2" aria-label="Identidades históricas pendientes de mapeo">
          {preview.reviewItems.map((item) => {
            const hasDecision = Object.prototype.hasOwnProperty.call(decisions, item.key)
            const currentValue = hasDecision ? (decisions[item.key] ?? "__none__") : ""
            return <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 border border-(--color-border) p-3 text-sm">
              <div className="min-w-56">
                <p className="text-xs text-(--color-text-muted)">{KIND_LABEL[item.kind]} · {item.worksiteName} · {item.occurrences.toLocaleString("es-CL")} filas</p>
                <p className="font-medium">{item.legacyValue}</p>
                <p className="text-xs text-(--color-text-muted)">Sugerencia: {item.suggestedLabel ?? "Sin match"} · {item.confidence}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`mapping-${item.key}`}>Destino de {item.legacyValue}</label>
                <Select value={currentValue} onValueChange={(v) => updateDecision(item.key, v)}>
                  <SelectTrigger id={`mapping-${item.key}`} className="h-9 min-w-64">
                    {/* El placeholder lo pinta Radix cuando el valor es "": no
                        hace falta (ni se permite) un SelectItem con value="". */}
                    <SelectValue placeholder="Selecciona una decisión…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin equivalente</SelectItem>
                    {item.options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </li>
          })}
        </ul>}
        {preview.reviewItems.length === 0 && <p className="border border-(--color-success-line) bg-(--color-success-tint) p-3 text-sm text-(--color-success-ink)">No hay identidades ambiguas pendientes. El plan usa sólo coincidencias confiables o decisiones ya guardadas.</p>}
        <div className="border-t border-(--color-border) pt-4">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => dispatch({ type: "confirmed", value: event.target.checked })} disabled={pendingDecisions > 0} /><span>Revisé el reporte y las decisiones anteriores. Confirmo importar las filas con faena válida; las cargas que conserven observaciones de lectura, sello o identidad quedarán en estado <strong>Observada</strong>.</span></label>
          {pendingDecisions > 0 && <p className="mt-2 text-xs text-(--color-warning-ink)">Faltan {pendingDecisions.toLocaleString("es-CL")} decisiones de mapeo.</p>}
          <Button className="mt-3" variant="destructive" onClick={handleImport} disabled={loading || !confirmed || pendingDecisions > 0}>{loading ? "Importando…" : "Importar histórico definitivamente"}</Button>
        </div>
      </section>}
      {result && <section aria-live="polite" className="border border-[var(--color-success-line)] bg-[var(--color-success-tint)] p-4 text-sm text-[var(--color-success-ink)]"><p className="font-medium">Importación completada</p><p className="mt-1">{result.importedRows.toLocaleString("es-CL")} filas · {result.validatedRows.toLocaleString("es-CL")} validadas · {result.observedRows.toLocaleString("es-CL")} observadas · {result.invalidRows.toLocaleString("es-CL")} no importadas · {Number(result.totalLiters).toLocaleString("es-CL")} L</p>{preview && <div className="mt-3 border-t border-current/20 pt-3"><p className="font-medium">Comparación dry-run → definitiva</p><p className="mt-1">Validadas: {preview.planned.validatedRows.toLocaleString("es-CL")} → {result.validatedRows.toLocaleString("es-CL")} · Observadas: {preview.planned.observedRows.toLocaleString("es-CL")} → {result.observedRows.toLocaleString("es-CL")} · Rechazadas: {preview.planned.rejectedRows.toLocaleString("es-CL")} → {result.invalidRows.toLocaleString("es-CL")}</p></div>}</section>}
    </div>
  )
}

const KIND_LABEL: Record<TaeImportPreview["reviewItems"][number]["kind"], string> = { vehicle: "Equipo", driver: "Conductor", supervisor: "Supervisor" }

function PreviewMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="border border-(--color-border) bg-(--color-surface-2) p-3"><p className="text-xs text-(--color-text-muted)">{label}</p><p className="mt-1 font-mono text-sm font-semibold">{typeof value === "number" ? value.toLocaleString("es-CL") : value}</p></div>
}
