"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { FileText, WarningCircle, CheckCircle, ArrowLeft, ArrowDown, ArrowUp } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { formatCLP, formatQty } from "@/lib/utils"
import { previewConsumptionImportAction, confirmConsumptionImportAction, type ConsumptionPreviewData, type ConsumptionImportResult } from "../actions-consumos"
import { Stat } from "@/lib/combustibles/wizard-helpers"
import { ImportDuplicateConfirmation, ImportErrorList, ImportFileDropzone } from "./import-wizard-primitives"

/**
 * Extrae el período desde el nombre del archivo siguiendo el patrón:
 *   ...Periodo_2026-06-01_al_2026-06-30...
 * Devuelve { desde, hasta } en formato YYYY-MM-DD, o null si no se detecta.
 */
function parsePeriodFromFileName(name: string): { desde: string; hasta: string } | null {
  const match = name.match(/Periodo[\s_]?(\d{4}-\d{2}-\d{2})[\s_]?(?:al|[a-z]+)[\s_]?(\d{4}-\d{2}-\d{2})/i)
  if (!match) return null
  const desde = match[1]!
  const hasta = match[2]!
  if (desde > hasta) return null  // fecha inválida
  return { desde, hasta }
}

type Step = "form" | "preview" | "done"

interface Worksite { id: string; name: string }

export function ImportWizard({ worksites, canImportAllWorksites }: { worksites: Worksite[]; canImportAllWorksites: boolean }) {
  const [step, setStep] = useState<Step>("form")
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [worksiteId, setWorksiteId] = useState(canImportAllWorksites ? "all" : worksites[0]?.id ?? "")
  const [periodoDesde, setPeriodoDesde] = useState("")
  const [periodoHasta, setPeriodoHasta] = useState("")
  const [notas, setNotas] = useState("")
  const [loading, setLoading] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dateFromFile, setDateFromFile] = useState(false)
  const [preview, setPreview] = useState<ConsumptionPreviewData | null>(null)
  const [confirmDuplicates, setConfirmDuplicates] = useState(false)
  const [result, setResult] = useState<ConsumptionImportResult | null>(null)

  function buildFormData(): FormData | null {
    if (!file) { toast.error("Selecciona un archivo Excel"); return null }
    if (!worksiteId) { toast.error("Selecciona la faena"); return null }
    if (!periodoDesde || !periodoHasta) { toast.error("Indica el período"); return null }
    const fd = new FormData()
    fd.set("file", file)
    fd.set("worksiteId", worksiteId)
    fd.set("periodoDesde", periodoDesde)
    fd.set("periodoHasta", periodoHasta)
    fd.set("fuente", "Copec")
    fd.set("notas", notas)
    return fd
  }

  async function handlePreview() {
    const fd = buildFormData()
    if (!fd) return
    setLoading(true)
    try {
      const res = await previewConsumptionImportAction(fd)
      if (!res.ok) { toast.error(res.message); return }
      setPreview(res.data)
      setConfirmDuplicates(false)
      setStep("preview")
    } catch {
      toast.error("Error al leer el archivo")
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    const fd = buildFormData()
    if (!fd) return
    if ((preview?.archivoDuplicado || preview?.loteDuplicado) && confirmDuplicates) {
      fd.set("confirmDuplicates", "true")
    }
    setLoading(true)
    try {
      const res = await confirmConsumptionImportAction(fd)
      if (!res.ok) { toast.error(res.message); return }
      setResult(res.data)
      setStep("done")
      toast.success(`${res.data.imported} registros importados`)
    } catch {
      toast.error("Error al importar")
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setStep("form")
    setFile(null)
    setPreview(null)
    setResult(null)
    setConfirmDuplicates(false)
  }

  function handleFile(f: File | undefined) {
    if (!f) return
    if (!/\.xlsx$/i.test(f.name)) {
      setFileError("Solo se aceptan archivos .xlsx")
      return
    }
    if (f.size > 5 * 1024 * 1024) {
      setFileError("El archivo no puede superar los 5 MB")
      return
    }
    setFile(f)
    setFileError(null)
    setDateFromFile(false)

    const detected = parsePeriodFromFileName(f.name)
    if (detected) {
      setPeriodoDesde(detected.desde)
      setPeriodoHasta(detected.hasta)
      setDateFromFile(true)
    }
  }

  const hasDuplicateWarning = preview && (preview.archivoDuplicado || preview.loteDuplicado)
  const canConfirm = !!preview && preview.totales.totalFilas > 0 && (!hasDuplicateWarning || confirmDuplicates)

  if (step === "done" && result) {
    return (
      <Card>
        <CardContent className="text-center space-y-4 py-8">
          <CheckCircle className="h-12 w-12 mx-auto text-[var(--color-success)]" />
          <div>
            <p className="text-2xl font-bold">{result.imported}</p>
            <p className="text-[var(--color-text-muted)]">registros de consumo importados exitosamente</p>
          </div>
          <ImportErrorList errors={result.errors} filename="errores-importacion.xlsx" title={`${result.errors.length} filas omitidas por errores:`} maxVisible={20} />
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={reset}>Importar otro archivo</Button>
            <Button asChild><a href={`/combustibles/importar/${result.batchId}`}>Ver lote</a></Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (step === "preview" && preview) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Revisar antes de importar</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setStep("form")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Filas válidas" value={formatQty(preview.totales.totalFilas)} icon={<CheckCircle className="h-5 w-5 text-[var(--color-success)]" />} />
            <Stat label="Filas rechazadas" value={formatQty(preview.errores.length)} icon={<WarningCircle className="h-5 w-5 text-[var(--color-danger)]" />} />
            <Stat label="Duplicados en archivo" value={formatQty(preview.duplicadosEnArchivo)} icon={<WarningCircle className="h-5 w-5 text-[var(--color-warning-ink)]" />} />
            <Stat label="Patentes únicas" value={formatQty(preview.totales.totalPatentes)} icon={<FileText className="h-5 w-5 text-[var(--color-text-muted)]" />} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Cantidad total" value={formatQty(Math.round(preview.totales.totalCantidad), "L")} />
            <Stat label="Monto total" value={formatCLP(preview.totales.totalMonto)} />
            <Stat label="Con vehículo" value={formatQty(preview.patentesConVehiculo)} />
            <Stat label="Sin vehículo" value={formatQty(preview.patentesSinVehiculo)} />
          </div>

          <ImportErrorList errors={preview.errores} filename="errores-preview.xlsx" />

          {worksiteId === "all" && preview.patentesSinVehiculo > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-[var(--color-warning-tint)] p-3 text-sm">
              <WarningCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning-ink)]" />
              <p>{preview.patentesSinVehiculo} patente(s) no están vinculadas a un vehículo y se omitirán en esta importación general.</p>
            </div>
          )}

          {hasDuplicateWarning && <ImportDuplicateConfirmation
            messages={[
              ...(preview.archivoDuplicado ? ["Este archivo ya fue importado antes."] : []),
              ...(preview.loteDuplicado ? ["Ya existe un lote para esta faena, período y fuente."] : []),
            ]}
            checked={confirmDuplicates}
            onCheckedChange={setConfirmDuplicates}
          />}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep("form")}>Volver</Button>
            <Button onClick={handleConfirm} disabled={loading || !canConfirm}>
              {loading ? "Importando..." : `Confirmar (${preview.totales.totalFilas} registros)`}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subir un archivo</CardTitle>
        <CardDescription>Ya tienes un reporte de tarjetas de combustible (.xlsx) en tu equipo y quieres importarlo directamente.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {worksites.length === 0 && !canImportAllWorksites ? (
          <p className="text-sm text-[var(--color-text-muted)]">No tienes faenas asignadas. Contacta a un administrador para que te asigne una faena.</p>
        ) : (
          <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">Faena</Label>
            <Select value={worksiteId} onValueChange={setWorksiteId}>
              <SelectTrigger aria-label="Selecciona faena"><SelectValue placeholder="Selecciona faena" /></SelectTrigger>
              <SelectContent>
                {canImportAllWorksites && <SelectItem value="all">Todas las faenas (según patente)</SelectItem>}
                {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Período desde</Label>
              {dateFromFile && file && <span className="text-[10px] rounded-full bg-[var(--color-primary-tint)] text-[var(--color-primary)] px-1.5 py-0.5 font-medium">Detectado del archivo</span>}
            </div>
            <DatePicker value={periodoDesde} onChange={setPeriodoDesde} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Período hasta</Label>
            <DatePicker value={periodoHasta} onChange={setPeriodoHasta} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: reporte semanal" />
          </div>
        </div>
        {worksiteId === "all" && (
          <p className="text-xs text-[var(--color-text-muted)]">Cada consumo se asignará a la faena del vehículo registrado.</p>
        )}

        <ImportFileDropzone
          file={file}
          fileError={fileError}
          dragActive={dragActive}
          onDragActiveChange={setDragActive}
          onFile={handleFile}
          onClear={() => { setFile(null); setFileError(null); setDateFromFile(false) }}
          helperText="Reporte de tarjetas de combustible (.xlsx)"
        />

        <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setColumnsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] rounded-t-[var(--radius-lg)]"
          >
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[var(--color-text-muted)]" />
              Columnas esperadas
            </span>
            {columnsOpen ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </button>
          {columnsOpen && (
            <div className="border-t border-[var(--color-border)] px-3.5 py-3">
              <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                Patente, N° Tarjetas, N° Transacciones, Cantidad (Unidad), Monto ($), Rendimiento Promedio
              </p>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button onClick={handlePreview} disabled={loading}>
            {loading ? "Leyendo..." : "Revisar"}
          </Button>
        </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
