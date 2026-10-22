"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ExportButton } from "@/components/ui/export-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { CONTROL_IMPORT_KIND_LABELS, MAX_IMPORT_FILE_BYTES, type ControlImportKind } from "@/lib/combustibles/control/imports/constants"
import type { ControlImportPreview, ControlImportResult } from "@/lib/combustibles/control/imports/service"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { ImportFileDropzone } from "../../importar/import-wizard-primitives"
import { confirmControlImportAction, downloadImportTemplateAction, previewControlImportAction } from "./actions"
import { ImportDone, ImportPreviewStep } from "./import-preview"
import type { MediumOption } from "./import-types"

type Step = "form" | "preview" | "done"

const COPY: Record<ControlImportKind, { title: string; description: string; helper: string }> = {
  telemetry: {
    title: "Importar telemetría diaria",
    description: "Una fila por equipo y día. Reimportar días ya cargados de la misma fuente los actualiza, no los duplica.",
    helper: "Excel (.xlsx) de hasta 10 MB con las columnas de la plantilla",
  },
  supply_inputs: {
    title: "Importar entradas de surtidor o tarjeta",
    description: "Una fila por despacho. La guía o folio evita duplicar un despacho al reimportar.",
    helper: "Excel (.xlsx) de hasta 10 MB con las columnas de la plantilla",
  },
}

export function ImportWizard({ kind, media, open, onOpenChange }: {
  kind: ControlImportKind
  media: MediumOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [step, setStep] = React.useState<Step>("form")
  const [file, setFile] = React.useState<File | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [dragActive, setDragActive] = React.useState(false)
  const [source, setSource] = React.useState("VisionLink")
  const [mediumId, setMediumId] = React.useState("")
  const [preview, setPreview] = React.useState<ControlImportPreview | null>(null)
  const [result, setResult] = React.useState<ControlImportResult | null>(null)
  const { pending, message, setMessage, run } = useOperation()
  const copy = COPY[kind]

  function reset() {
    setStep("form")
    setFile(null)
    setFileError(null)
    setPreview(null)
    setResult(null)
    setMessage("")
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (pending) return
      // Tras importar, la lista de lotes de la página debe mostrar el nuevo.
      if (step === "done") router.refresh()
      reset()
    }
    onOpenChange(next)
  }

  function handleFile(next: File | undefined) {
    if (!next) return
    if (!/\.xlsx$/i.test(next.name)) { setFileError("Solo se aceptan archivos .xlsx"); return }
    if (next.size > MAX_IMPORT_FILE_BYTES) { setFileError("El archivo no puede superar los 10 MB"); return }
    setFile(next)
    setFileError(null)
    setMessage("")
  }

  function buildFormData(): FormData | null {
    if (!file) { setMessage("Selecciona un archivo Excel", "error"); return null }
    if (kind === "supply_inputs" && !mediumId) { setMessage("Elige el medio de suministro del archivo", "error"); return null }
    if (kind === "telemetry" && !source.trim()) { setMessage("Indica la fuente de la telemetría", "error"); return null }
    const formData = new FormData()
    formData.set("kind", kind)
    formData.set("file", file)
    if (kind === "telemetry") formData.set("source", source.trim())
    else formData.set("supplyMediumId", mediumId)
    return formData
  }

  function review() {
    const formData = buildFormData()
    if (!formData) return
    run(async () => {
      const response = await previewControlImportAction(formData)
      if (!response.ok) return { ok: false, message: response.message }
      setPreview(response.data)
      return { ok: true }
    }, () => setStep("preview"))
  }

  function confirm() {
    const formData = buildFormData()
    if (!formData) return
    run(async () => {
      const response = await confirmControlImportAction(formData)
      if (!response.ok) return { ok: false, message: response.message }
      setResult(response.data)
      return { ok: true }
    }, () => {
      setStep("done")
      toast.success("Importación terminada")
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{step === "preview" ? "Revisa antes de importar" : step === "done" ? "Importación terminada" : copy.title}</DialogTitle>
          <DialogDescription>
            {step === "form" ? copy.description : `${CONTROL_IMPORT_KIND_LABELS[kind]} · ${file?.name ?? ""}`}
          </DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <div className="flex flex-col gap-4">
            {kind === "telemetry" ? (
              <Field label="Fuente de la telemetría" helper="Se guarda en minúsculas. Una misma fecha y equipo puede tener una fila por fuente." required>
                <Input value={source} onChange={(event) => setSource(event.target.value)} maxLength={60} />
              </Field>
            ) : (
              <Field label="Medio de suministro" helper="Todas las filas del archivo se asocian a este medio. Se administran en Configuración." required>
                <OptionSelect
                  aria-label="Medio de suministro"
                  options={media.map((medium) => ({ value: medium.id, label: medium.name }))}
                  value={mediumId}
                  onValueChange={setMediumId}
                  placeholder="Elige un medio"
                />
              </Field>
            )}
            <ImportFileDropzone
              file={file}
              fileError={fileError}
              dragActive={dragActive}
              onDragActiveChange={setDragActive}
              onFile={handleFile}
              onClear={() => setFile(null)}
              helperText={copy.helper}
            />
            <div className="flex items-center justify-between gap-3">
              <ExportButton action={downloadImportTemplateAction} filters={kind} label="Descargar plantilla" variant="ghost" />
              <p className="text-xs text-[var(--color-text-muted)]">La plantilla trae los encabezados exactos y una hoja de instrucciones.</p>
            </div>
            {message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{message}</p> : null}
            <DialogFooter>
              <Button variant="secondary" onClick={() => handleOpenChange(false)}>Cancelar</Button>
              <Button onClick={review} loading={pending} disabled={!file}>Revisar archivo</Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === "preview" && preview ? (
          <ImportPreviewStep
            preview={preview}
            pending={pending}
            message={message}
            onBack={() => { setStep("form"); setMessage("") }}
            onConfirm={confirm}
          />
        ) : null}

        {step === "done" && result ? (
          <ImportDone kind={kind} result={result} onAnother={reset} onClose={() => handleOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
