"use client"

import * as React from "react"
import { Paperclip } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface FileInputProps {
  id?: string
  name?: string
  accept?: string
  required?: boolean
  disabled?: boolean
  error?: boolean
  className?: string
  /** Allow selecting more than one file. Use `onFilesChange` to read the selection. */
  multiple?: boolean
  /** Called with the selected file (or null if cleared). Ignored when `multiple`. */
  onChange?: (file: File | null) => void
  /** Called with the selected files when `multiple` is set. */
  onFilesChange?: (files: File[]) => void
}

/**
 * Styled replacement for `<input type="file">`. The native file button
 * can't be restyled with CSS — it renders the browser/OS chrome ("Choose
 * File" / "No file chosen"), breaking the design system. This hides the
 * real input (`sr-only`, still focusable/validatable) behind a normal
 * `Button` that forwards clicks to it, and shows the selected filename
 * next to it. Uncontrolled + FormData/server-action compatible via `name`,
 * same as `Input`/`DatePicker`.
 */
export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  ({ id, name, accept, required, disabled, error, className, multiple, onChange, onFilesChange }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null)
    const [fileName, setFileName] = React.useState<string | null>(null)

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      if (multiple) {
        const files = Array.from(e.target.files ?? [])
        setFileName(files.length === 0 ? null : files.length === 1 ? files[0]!.name : `${files.length} archivos seleccionados`)
        onFilesChange?.(files)
        return
      }
      const file = e.target.files?.[0] ?? null
      setFileName(file?.name ?? null)
      onChange?.(file)
    }

    return (
      <div className={cn("flex items-center gap-2.5", className)}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={error ? "border-[var(--color-danger)]" : undefined}
        >
          <Paperclip size={14} />
          Seleccionar archivo
        </Button>
        <span
          className={cn(
            "truncate text-sm",
            fileName ? "text-[var(--color-text)]" : "text-[var(--color-text-subtle)]",
          )}
        >
          {fileName ?? "Ningún archivo seleccionado"}
        </span>
        <input
          ref={(node) => {
            inputRef.current = node
            if (typeof ref === "function") ref(node)
            else if (ref) ref.current = node
          }}
          id={id}
          name={name}
          type="file"
          accept={accept}
          required={required}
          disabled={disabled}
          multiple={multiple}
          onChange={handleChange}
          className="sr-only"
          tabIndex={-1}
        />
      </div>
    )
  },
)
FileInput.displayName = "FileInput"
