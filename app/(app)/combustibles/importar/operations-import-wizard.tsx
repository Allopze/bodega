"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, WarningCircle, CheckCircle, ArrowLeft, ArrowUp, ArrowDown } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { formatCLP, formatQty } from "@/lib/utils"
import {
  previewOperationsImportAction,
  confirmOperationsImportAction,
  type OperationsPreviewData,
  type OperationsImportResultSummary,
} from "../actions-operaciones"
import { Stat } from "@/lib/combustibles/wizard-helpers"
import { ImportDuplicateConfirmation, ImportErrorList, ImportFileDropzone } from "./import-wizard-primitives"

type Step = "form" | "preview" | "done"

export function OperationsImportWizard() {
  const [step, setStep] = useState<Step>("form")
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [notas, setNotas] = useState("")
  const [autoCreateVehicles, setAutoCreateVehicles] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [preview, setPreview] = useState<OperationsPreviewData | null>(null)
  const [confirmDuplicates, setConfirmDuplicates] = useState(false)
  const [result, setResult] = useState<OperationsImportResultSummary | null>(null)

  function buildFormData(): FormData | null {
    if (!file) { toast.error("Selecciona un archivo Excel"); return null }
    const fd = new FormData()
    fd.set("file", file)
    fd.set("notas", notas)
    return fd
  }

  async function handlePreview() {
    const fd = buildFormData()
    if (!fd) return
    setLoading(true)
    try {
      const res = await previewOperationsImportAction(fd)
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
    if (preview?.archivoDuplicado && confirmDuplicates) fd.set("confirmDuplicates", "true")
    if (autoCreateVehicles) fd.set("autoCreateVehicles", "true")
    setLoading(true)
    try {
      const res = await confirmOperationsImportAction(fd)
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
    // El servidor acepta hasta 10 MB (actions-operaciones.ts MAX_FILE_BYTES) —
    // este límite de 5 MB rechazaba en cliente archivos de 5-10 MB que el
    // servidor sí habría aceptado. Ojo: el wizard hermano (import-wizard.tsx,
    // consumos) SÍ debe quedarse en 5 MB — su propio servidor acepta sólo eso
    // (actions-consumos.ts MAX_FILE_BYTES).
    if (f.size > 10 * 1024 * 1024) {
      setFileError("El archivo no puede superar los 10 MB")
      return
    }
    setFile(f)
    setFileError(null)
  }

  const canConfirm = !!preview && preview.totales.totalFilas > 0 && (!preview.archivoDuplicado || confirmDuplicates)

  if (step === "done" && result) {
    return (
      <Card>
        <CardContent className="text-center space-y-4 py-8">
          <CheckCircle className="h-12 w-12 mx-auto text-[var(--color-success)]" />
          <div>
            <p className="text-2xl font-bold">{result.imported}</p>
            <p className="text-[var(--color-text-muted)]">registros de log operacional importados exitosamente</p>
            {result.duplicateRows > 0 && (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{result.duplicateRows} {result.duplicateRows === 1 ? "fila ya estaba" : "filas ya estaban"} importada{result.duplicateRows === 1 ? "" : "s"} de un lote anterior y se omitieron.</p>
            )}
          </div>
          <ImportErrorList errors={result.errors} filename="errores-operaciones.xlsx" title={`${result.errors.length} filas omitidas por errores:`} maxVisible={20} />
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={reset}>Importar otro archivo</Button>
            <Button asChild><a href={`/combustibles/importar/operaciones/${result.batchId}`}>Ver lote</a></Button>
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
            <Stat label="Equipos únicos" value={formatQty(preview.totales.totalEquipos)} icon={<FileText className="h-5 w-5 text-[var(--color-text-muted)]" />} />
            <Stat label="Período" value={`${preview.totales.periodoDesde} a ${preview.totales.periodoHasta}`} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Litros totales" value={formatQty(Math.round(preview.totales.totalLitros), "L")} />
            <Stat label="Monto total" value={formatCLP(preview.totales.totalMonto)} />
            <Stat label="Con vehículo" value={formatQty(preview.equiposConVehiculo)} />
            <Stat label="Sin vehículo" value={formatQty(preview.equiposSinVehiculo)} />
          </div>

          {preview.faenasSinMatch.length > 0 && (
            <div className="p-3 bg-[var(--color-warning-tint)] rounded-md text-sm">
              <p className="font-medium mb-1">Faenas sin match ({preview.faenasSinMatch.length}). Se podrán vincular manualmente después:</p>
              <p className="text-[var(--color-text-muted)]">{preview.faenasSinMatch.join(", ")}</p>
            </div>
          )}
          {preview.proveedoresSinMatch.length > 0 && (
            <div className="p-3 bg-[var(--color-warning-tint)] rounded-md text-sm">
              <p className="font-medium mb-1">Proveedores sin match ({preview.proveedoresSinMatch.length}):</p>
              <p className="text-[var(--color-text-muted)]">{preview.proveedoresSinMatch.join(", ")}</p>
            </div>
          )}

          <ImportErrorList errors={preview.errores} filename="errores-preview-operaciones.xlsx" />

          {preview.equiposSinVehiculo > 0 && (
            <Checkbox
              id="autoCreateVehicles"
              label={`Crear automáticamente los ${preview.equiposSinVehiculo} vehículos sin catálogo (con la faena y tipo detectados)`}
              checked={autoCreateVehicles}
              onChange={(e) => setAutoCreateVehicles(e.target.checked)}
            />
          )}

          {/* Distinto de "archivoDuplicado": esto es por-fila, no exige confirmación
              porque las filas duplicadas simplemente se omiten al confirmar. */}
          {preview.duplicateRows > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-[var(--color-surface-2)] text-sm">
              <WarningCircle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--color-text-muted)]" />
              <p>{preview.duplicateRows} de {preview.totales.totalFilas} filas ya están importadas en un lote vigente y se omitirán automáticamente al confirmar.</p>
            </div>
          )}

          {preview.archivoDuplicado && <ImportDuplicateConfirmation
            messages={["Este archivo ya fue importado antes."]}
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
      <CardHeader><CardTitle>Nueva importación de log operacional</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--color-text-muted)]">
          Carga el consolidado de cargas de combustible por transacción (fecha, horómetro,
          operador, proveedor y rendimiento por carga). A diferencia del reporte de
          consumos por patente, este archivo abarca varias faenas y periodos a la vez:
          se detectan automáticamente desde las columnas FECHA y FAENA de cada fila.
        </p>
        <div className="grid gap-3 sm:grid-cols-1 max-w-sm">
          <div className="grid gap-1.5">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: consolidado octubre-junio" />
          </div>
        </div>

        <ImportFileDropzone
          file={file}
          fileError={fileError}
          dragActive={dragActive}
          onDragActiveChange={setDragActive}
          onFile={handleFile}
          onClear={() => { setFile(null); setFileError(null) }}
          helperText="Consolidado de cargas de combustible (.xlsx)"
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
                Codigo, Patente, Fecha, Hora Carga, Faena, Tipo Equipo, Marca, Modelo, Año,
                Horometro/Odometro, Medido Por (Km/Hora), LT, Operador, Supervisor Turno,
                Suministro entregado por, Rendimiento, Tipo de Rendimiento, $/lt, Monto ($)
              </p>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button onClick={handlePreview} disabled={loading}>
            {loading ? "Leyendo..." : "Revisar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
