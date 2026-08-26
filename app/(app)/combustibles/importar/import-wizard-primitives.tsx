"use client"

import { Upload, WarningCircle, X } from "@phosphor-icons/react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { downloadErrorsXlsx, importErrorKey } from "@/lib/combustibles/wizard-helpers"

export interface ImportRowError {
  rowIndex: number
  field: string
  message: string
}

export function ImportErrorList({
  errors,
  filename,
  title = "Filas con errores (no se importarán):",
  maxVisible = 30,
}: {
  errors: ImportRowError[]
  filename: string
  title?: string
  maxVisible?: number
}) {
  if (errors.length === 0) return null
  return (
    <div className="rounded-md bg-[var(--color-warning-tint)] p-3 text-sm">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-medium">{title}</p>
        <button type="button" onClick={() => downloadErrorsXlsx(errors, filename)} className="text-xs text-[var(--color-primary)] hover:underline">
          Descargar errores (.xlsx)
        </button>
      </div>
      <div className="max-h-40 space-y-0.5 overflow-y-auto">
        {errors.slice(0, maxVisible).map((error) => (
          <p key={importErrorKey(error)} className="text-[var(--color-danger)]">Fila {error.rowIndex}, {error.field}: {error.message}</p>
        ))}
        {errors.length > maxVisible && (
          <p className="text-xs text-[var(--color-text-muted)]">…y {errors.length - maxVisible} errores más. Usa el botón de arriba para descargar la lista completa.</p>
        )}
      </div>
    </div>
  )
}

export function ImportDuplicateConfirmation({
  messages,
  checked,
  onCheckedChange,
  id = "confirmDuplicates",
}: {
  messages: string[]
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
}) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-[var(--color-danger-tint)] p-3 text-sm">
      <WarningCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
      <div className="space-y-2">
        <p>{messages.join(" ")}</p>
        <Checkbox
          id={id}
          label="Entiendo e igualmente quiero importar (puede duplicar datos)"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
      </div>
    </div>
  )
}

export function ImportFileDropzone({
  file,
  fileError,
  dragActive,
  onDragActiveChange,
  onFile,
  onClear,
  helperText,
  inputLabel = "Seleccionar archivo Excel",
}: {
  file: File | null
  fileError: string | null
  dragActive: boolean
  onDragActiveChange: (active: boolean) => void
  onFile: (file: File | undefined) => void
  onClear: () => void
  helperText: string
  inputLabel?: string
}) {
  return (
    <label
      onDragOver={(event) => { event.preventDefault(); onDragActiveChange(true) }}
      onDragLeave={() => onDragActiveChange(false)}
      onDrop={(event) => { event.preventDefault(); onDragActiveChange(false); onFile(event.dataTransfer.files?.[0]) }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-xl)] border-2 border-dashed px-6 py-10 text-center",
        fileError
          ? "border-[var(--color-danger)] bg-[var(--color-danger-tint)]"
          : dragActive
            ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)]"
            : "border-[var(--color-border)] hover:border-[var(--color-primary-line)] hover:bg-[var(--color-surface-2)]",
      )}
    >
      <div className={cn("flex h-12 w-12 items-center justify-center rounded-full", fileError ? "bg-[var(--color-danger-tint)]" : "bg-[var(--color-primary-tint)]")}>
        {fileError ? <WarningCircle className="h-6 w-6 text-[var(--color-danger)]" weight="bold" /> : <Upload className="h-6 w-6 text-[var(--color-primary)]" weight="bold" />}
      </div>
      <div>
        {fileError ? <p className="text-sm font-medium text-[var(--color-danger)]">{fileError}</p> : file ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--color-text)]">{file.name}</span>
            <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClear() }} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" aria-label="Quitar archivo"><X className="h-4 w-4" /></button>
          </div>
        ) : <p className="text-sm font-medium text-[var(--color-text)]">Arrastra tu archivo aquí o <span className="text-[var(--color-primary)]">haz clic para buscar</span></p>}
        {!fileError && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{helperText}</p>}
      </div>
      <input type="file" accept=".xlsx" onChange={(event) => onFile(event.target.files?.[0])} className="sr-only" aria-label={inputLabel} />
    </label>
  )
}
