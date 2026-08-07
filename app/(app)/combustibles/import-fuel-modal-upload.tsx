"use client"

import { Upload, FileText, WarningCircle } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

interface UploadStepProps {
  dragActive: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function UploadStep({
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
}: UploadStepProps) {
  return (
    <div className="space-y-3">
      <label
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-3 cursor-pointer text-center",
          "rounded-[var(--radius-xl)] border-2 border-dashed px-6 py-10",
          "transition-[border-color,background-color] duration-[var(--duration-fast)]",
          dragActive
            ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)]"
            : "border-[var(--color-border)] hover:border-[var(--color-primary-line)] hover:bg-[var(--color-surface-2)]",
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary-tint)]">
          <Upload className="h-6 w-6 text-[var(--color-primary)]" weight="bold" />
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--color-text)]">
            Arrastra tu archivo aquí o{" "}
            <span className="text-[var(--color-primary)]">haz clic para buscar</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Excel de TCT Copec (.xlsx o .xls)
          </p>
        </div>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={onFileChange}
          className="sr-only"
        />
      </label>

      <details className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3.5 py-2.5">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Formato esperado
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Columnas: MES-AÑO, SERVICIO, VEHICULO, PROVEEDOR, CLIENTE, FAENA,
          PRODUCTO, FACTURA, LITROS, IEC Fijo, IEC Variable, Base Afecta,
          IMPUESTO IEC, IVA, TOTAL FACTURA A PAGAR
        </p>
      </details>

      <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 text-sm">
        <WarningCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          Los vehículos, proveedores y faenas deben existir previamente en el
          sistema. Podrás revisar los datos antes de confirmar.
        </p>
      </div>
    </div>
  )
}
