"use client"

import { useActionState, useEffect } from "react"
import { UploadSimple } from "@phosphor-icons/react"
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/admin/sheet"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/lib/toast"
import { importProductsXlsx } from "./actions"

interface ProductImportPanelProps {
  open: boolean
  onClose: () => void
}

interface ImportResultData {
  totalRows?: number
  created?: number
  updated?: number
  suppliersCreated?: number
  categoriesCreated?: number
  errors?: string[]
  totalErrors?: number
}

export function ProductImportPanel({ open, onClose }: ProductImportPanelProps) {
  const [state, formAction] = useActionState(importProductsXlsx, INITIAL_STATE)
  const data = state.data as ImportResultData | undefined

  useEffect(() => {
    if (!state.message) return
    if (state.ok) toast.success(state.message)
    else if (!state.fieldErrors) toast.error(state.message)
  }, [state])

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <div>
            <SheetTitle>Importar EPP desde XLSX</SheetTitle>
            <SheetDescription>
              Carga productos EPP al catálogo. Los SKU existentes se actualizan.
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>

        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          <SheetBody>
            <FieldGroup>
              <Field
                label="Archivo XLSX"
                htmlFor="product-import-file"
                required
                error={state.fieldErrors?.file?.[0]}
                helper="Columnas reconocidas: SKU, Nombre, Proveedor, Precio, Atributos, Descripción, Categoría, Unidad, Notas."
              >
                <Input
                  id="product-import-file"
                  name="file"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  error={!!state.fieldErrors?.file}
                />
              </Field>

              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-text-muted)]">
                <p className="font-medium text-[var(--color-text)]">Formato de atributos</p>
                <p className="mt-1 font-mono">Talla: M; Color: Blanco; Modelo: Premium</p>
              </div>

              {data && state.ok && (
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] p-3 text-sm">
                  <p className="font-medium text-[var(--color-success)]">Importación completada</p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
                    <SummaryItem label="Filas" value={data.totalRows} />
                    <SummaryItem label="Creados" value={data.created} />
                    <SummaryItem label="Actualizados" value={data.updated} />
                    <SummaryItem label="Proveedores nuevos" value={data.suppliersCreated} />
                    <SummaryItem label="Categorías nuevas" value={data.categoriesCreated} />
                  </dl>
                </div>
              )}

              {data?.errors && data.errors.length > 0 && (
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] p-3 text-sm">
                  <p className="font-medium text-[var(--color-danger)]">
                    Errores encontrados{data.totalErrors ? ` (${data.totalErrors})` : ""}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
                    {data.errors.map((error, index) => (
                      <li key={`${error}-${index}`}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
            <SubmitButton label="Importar XLSX" loadingLabel="Importando...">
              <UploadSimple size={16} />
            </SubmitButton>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function SummaryItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="font-mono text-[var(--color-text)]">{String(value ?? 0)}</dd>
    </div>
  )
}
