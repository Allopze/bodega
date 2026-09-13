"use client"

import * as React from "react"
import { UploadSimple, FileXls } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

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
    // El contenedor sólo aporta el marco y el arrastre. Lo que abre el selector es el
    // <label>, porque un label asociado activa su input de forma nativa con click, Enter
    // y Espacio: antes era un <div onClick> con el input en `tabIndex={-1}`, así que con
    // teclado no había forma de elegir un archivo. El anillo de foco se pinta acá con
    // `has-[:focus-visible]` porque el input que recibe el foco es visualmente oculto.
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={cn(
        "rounded-[var(--radius-lg)] border-2 border-dashed transition-[border-color,background-color] duration-[var(--duration-fast)]",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary)]",
        dragActive
          ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)]",
        disabled && "opacity-50",
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
        className="sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          "flex flex-col items-center justify-center p-6 text-center",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-primary)]">
          <FileXls size={28} weight="duotone" />
        </div>
        <p className="mt-3 text-sm font-medium text-[var(--color-text)]">{title}</p>
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{description}</p>
        {/* Decorativo, y por eso un <span> y no un <Button>: el label ya es el control.
            Un <button> real acá sería un segundo punto de tabulación que no hace nada al
            pulsarlo y, al vivir dentro del <label>, además se robaría su nombre accesible
            (un <button> es un elemento etiquetable). */}
        <span
          aria-hidden="true"
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4 pointer-events-none")}
        >
          <UploadSimple size={14} className="mr-1.5" />
          {acceptLabel}
        </span>
      </label>
    </div>
  )
}
