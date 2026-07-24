"use client"

import * as React from "react"
import { UploadSimple, FileXls } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface FileDropzoneProps {
  onFileSelect: (file: File) => void
  accept?: string
  acceptLabel?: string
  title?: string
  description?: string
  disabled?: boolean
  className?: string
  id?: string
  name?: string
}

export function FileDropzone({
  onFileSelect,
  accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls",
  acceptLabel = "Archivos Excel (.xlsx, .xls)",
  title = "Selecciona o arrastra tu archivo aquí",
  description = "Formatos soportados: .xlsx, .xls (máximo 10 MB)",
  disabled = false,
  className,
  id = "file-dropzone-input",
  name = "file",
}: FileDropzoneProps) {
  const [dragActive, setDragActive] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    if (disabled) return
    onFileSelect(file)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      onClick={() => {
        if (!disabled) inputRef.current?.click()
      }}
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed p-6 text-center cursor-pointer transition-[border-color,background-color] duration-[var(--duration-fast)]",
        dragActive
          ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)]",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={handleChange}
        aria-label={title || "Subir archivo"}
        className="sr-only"
        tabIndex={-1}
      />
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-primary)]">
        <FileXls size={28} weight="duotone" />
      </div>
      <p className="mt-3 text-sm font-medium text-[var(--color-text)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{description}</p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        className="mt-4 pointer-events-none"
      >
        <UploadSimple size={14} className="mr-1.5" />
        {acceptLabel}
      </Button>
    </div>
  )
}
