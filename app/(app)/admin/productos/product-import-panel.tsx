"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
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
import { FileInput } from "@/components/ui/file-input"
import { toast } from "@/lib/toast"
import { importProductsXlsx } from "./actions"

interface ProductImportPanelProps {
  open: boolean
  onClose: () => void
}

interface ImportResultData {
  batchId?: string
  totalRows?: number
  blocked?: number
  pending?: number
  ready?: number
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
  const router = useRouter()

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
            <SheetTitle>Importar equipos de protección (EPP)</SheetTitle>
            <SheetDescription>
              Analiza y normaliza el archivo; cada fila se revisa antes de incorporarse al catálogo.
            </SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>

        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          <SheetBody>
            <FieldGroup>
              <Field
                label="Archivo Excel"
                htmlFor="product-import-file"
                required
                error={state.fieldErrors?.file?.[0]}
                helper="Columnas reconocidas: Nombre, Código, Proveedor, Precio, Atributos, Talla, Color, Marca, Modelo, Descripción, Categoría, Unidad, Notas."
              >
                <FileInput
                  id="product-import-file"
                  name="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  error={!!state.fieldErrors?.file}
                />
              </Field>

              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-text-muted)]">
                <p className="font-medium text-[var(--color-text)]">Formato de atributos</p>
                <p className="mt-1 font-mono">Talla: M; Color: Blanco; Modelo: Premium</p>
              </div>

              {data && state.ok && (() => {
                const needsReview = (data.blocked ?? 0) + (data.pending ?? 0)
                return (
                  <div className={needsReview > 0
                    ? "rounded-[var(--radius-lg)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm"
                    : "rounded-[var(--radius-lg)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] p-3 text-sm"}
                  >
                    <p className={needsReview > 0 ? "font-medium text-[var(--color-warning-ink)]" : "font-medium text-[var(--color-success)]"}>
                      {needsReview > 0 ? "Requiere revisión antes de confirmar" : "Análisis listo para confirmar"}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
                      <SummaryItem label="Filas" value={data.totalRows} />
                      <SummaryItem label="Listas para crear" value={data.ready} />
                      <SummaryItem label="Bloqueantes" value={data.blocked} />
                      <SummaryItem label="Por resolver (posible duplicado)" value={data.pending} />
                    </dl>
                    {data.batchId && <Button type="button" size="sm" className="mt-3" onClick={() => router.push(`/admin/productos/importar/${data.batchId}`)}>Revisar lote</Button>}
                  </div>
                )
              })()}

              {data?.errors && data.errors.length > 0 && (
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] p-3 text-sm">
                  <p className="font-medium text-[var(--color-danger)]">
                    Errores encontrados{data.totalErrors ? ` (${data.totalErrors})` : ""}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
                    {data.errors.map((error) => {
                      const batchMatch = error.match(/lote ([\w-]+)\.?$/)
                      const existingBatchId = batchMatch?.[1]
                      return (
                        <li key={error}>
                          <span>{error}</span>
                          {existingBatchId && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="mt-1"
                              onClick={() => router.push(`/admin/productos/importar/${existingBatchId}`)}
                            >
                              Ir al lote existente
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
            <SubmitButton label="Importar Excel" loadingLabel="Importando...">
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
