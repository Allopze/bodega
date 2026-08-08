"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Upload } from "@phosphor-icons/react"
import { parseFuelExcel } from "@/lib/combustibles/import"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { UploadStep } from "./import-fuel-modal-upload"
import { PreviewStep } from "./import-fuel-modal-preview"
import { DoneStep } from "./import-fuel-modal-done"
import type { Worksite, Step } from "./import-fuel-modal.helpers"
import { autoMatchWorksite, resetImportState, STEP_LABELS } from "./import-fuel-modal.helpers"
import type { ImportResult } from "./import-fuel-modal.helpers"
import type { ParsedFuelLoad, ImportError } from "@/lib/combustibles/import"

export function ImportFuelLoadsModal({ worksites }: { worksites: Worksite[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState("")
  const [loads, setLoads] = useState<ParsedFuelLoad[]>([])
  const [errors, setErrors] = useState<ImportError[]>([])
  const [duplicates, setDuplicates] = useState<number[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [createMissing, setCreateMissing] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [faenaMap, setFaenaMap] = useState<Record<string, string>>({})

  const distinctFaenas = Array.from(
    loads.reduce((m, l) => m.set(l.worksite, (m.get(l.worksite) ?? 0) + 1), new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1])
  const allFaenasMapped = distinctFaenas.every(([f]) => faenaMap[f])

  function handleOpen(value: boolean) {
    if (!value) {
      const s = resetImportState()
      setStep(s.step)
      setFileName(s.fileName)
      setLoads(s.loads)
      setErrors(s.errors)
      setDuplicates(s.duplicates)
      setImporting(s.importing)
      setResult(s.result)
      setCreateMissing(s.createMissing)
      setFaenaMap({})
    }
    setOpen(value)
  }

  function processFile(file: File) {
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error("El archivo debe ser .xlsx o .xls")
      return
    }
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const buffer = ev.target?.result as ArrayBuffer
        const parsed = await parseFuelExcel(buffer)
        setLoads(parsed.loads)
        setErrors(parsed.errors)
        setDuplicates(parsed.duplicates)
        const distinct = Array.from(new Set(parsed.loads.map(l => l.worksite)))
        setFaenaMap(Object.fromEntries(distinct.map(f => [f, autoMatchWorksite(f, worksites)])))
        setStep("preview")
      } catch (err) {
        console.error("parseFuelExcel failed:", err)
        toast.error(`Error al leer el Excel: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    reader.onerror = () => {
      console.error("FileReader error:", reader.error)
      toast.error(`No se pudo leer el archivo: ${reader.error?.message ?? "error desconocido"}`)
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  async function handleConfirm() {
    if (loads.length === 0) {
      toast.error("No hay cargas válidas para importar")
      return
    }
    if (!allFaenasMapped) {
      toast.error("Asigna todas las faenas del Excel antes de importar")
      return
    }

    setImporting(true)
    try {
      const response = await fetch("/api/combustibles/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loads, createMissing, faenaMapping: faenaMap }),
      })
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        toast.error(errData.message ?? "Error al importar")
        return
      }
      const data = await response.json()
      if (data.ok) {
        setResult({ imported: data.imported, errors: data.errors ?? [], created: data.created ?? [] })
        setStep("done")
        toast.success(`${data.imported} cargas importadas`)
      } else {
        toast.error(data.message ?? "Error al importar")
      }
    } catch (err) {
      console.error("import request failed:", err)
      toast.error(`Error al importar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  function handleClose() {
    if (step === "done") router.refresh()
    handleOpen(false)
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-1.5" />
        Importar Excel
      </Button>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className={cn("w-[calc(100%-2rem)]", step === "preview" ? "max-w-4xl" : "max-w-xl")}>
          <DialogHeader>
            <DialogTitle>Importar cargas desde Excel</DialogTitle>
            <DialogDescription>Sube el archivo Excel de TCT Copec</DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-4">
            {(["upload", "preview", "done"] as const).map((s, i) => {
              const active = step === s
              const isLast = i === 2
              return (
                <div key={s} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 text-sm ${active ? `font-semibold ${isLast ? "text-[var(--color-success)]" : "text-[var(--color-primary)]"}` : "text-[var(--color-text-muted)]"}`}>
                    {/* `--color-surface-2`/`-3` son casi blancos: el círculo se perdía
                        contra el fondo. `--color-border` es el gris de referencia para
                        elementos inactivos junto a colores saturados (primary/success). */}
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${active ? (isLast ? "bg-[var(--color-success)] text-white" : "bg-[var(--color-primary)] text-white") : "bg-[var(--color-border)]"}`}>
                      {i + 1}
                    </span>
                    {STEP_LABELS[i]}
                  </div>
                  {i < 2 && <div className="w-8 h-px bg-[var(--color-border)]" />}
                </div>
              )
            })}
          </div>

          {step === "upload" && (
            <UploadStep
              dragActive={dragActive}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onFileChange={handleFile}
            />
          )}

          {step === "preview" && (
            <PreviewStep
              fileName={fileName}
              loads={loads}
              errors={errors}
              duplicates={duplicates}
              importing={importing}
              createMissing={createMissing}
              distinctFaenas={distinctFaenas}
              faenaMap={faenaMap}
              allFaenasMapped={allFaenasMapped}
              worksites={worksites}
              onBack={() => setStep("upload")}
              onConfirm={handleConfirm}
              onToggleCreateMissing={setCreateMissing}
              onFaenaMapChange={(faena, value) => setFaenaMap((m) => ({ ...m, [faena]: value }))}
            />
          )}

          {step === "done" && result && (
            <DoneStep
              result={result}
              onImportAnother={() => {
                const s = resetImportState()
                setStep(s.step)
                setFileName(s.fileName)
                setLoads(s.loads)
                setErrors(s.errors)
                setResult(s.result)
              }}
              onClose={handleClose}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
