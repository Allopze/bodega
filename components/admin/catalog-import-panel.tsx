"use client"

import { useActionState, useEffect } from "react"
import { UploadSimple } from "@phosphor-icons/react"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent,
  SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/admin/sheet"
import { INITIAL_STATE, type ActionState } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { FileInput } from "@/components/ui/file-input"
import { toast } from "@/lib/toast"

interface ImportResultData {
  created?: number
  updated?: number
  skipped?: number
  errors?: string[]
  totalErrors?: number
}

interface CatalogImportPanelProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  action: (_prev: ActionState, formData: FormData) => Promise<ActionState>
  helperText?: string
}

export function CatalogImportPanel({ open, onClose, title, description, action, helperText }: CatalogImportPanelProps) {
  const [state, formAction] = useActionState(action, INITIAL_STATE)
  const data = state.data as ImportResultData | undefined

  useEffect(() => {
    if (!state.message) return
    if (state.ok) toast.success(state.message)
    else if (!state.fieldErrors) toast.error(state.message)
  }, [state])

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <div>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          <SheetBody>
            <FieldGroup>
              <Field label="Archivo XLSX" htmlFor="catalog-import-file" required
                error={state.fieldErrors?.file?.[0]}
                helper={helperText}>
                <FileInput id="catalog-import-file" name="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  error={!!state.fieldErrors?.file} />
              </Field>
              {data && (
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] p-3 text-sm">
                  <dl className="grid grid-cols-3 gap-2 text-xs text-[var(--color-text-muted)]">
                    <div><span className="block font-medium text-[var(--color-text)]">{data.created ?? 0}</span>Creados</div>
                    <div><span className="block font-medium text-[var(--color-text)]">{data.updated ?? 0}</span>Actualizados</div>
                    <div><span className="block font-medium text-[var(--color-text)]">{data.skipped ?? 0}</span>Omitidos</div>
                  </dl>
                </div>
              )}

              {data?.errors && data.errors.length > 0 && (
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm">
                  <p className="font-medium text-[var(--color-warning-ink)]">
                    Filas omitidas{data.totalErrors ? ` (${data.totalErrors})` : ""}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
                    {data.errors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                </div>
              )}
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <SubmitButton label="Importar XLSX" loadingLabel="Importando...">
              <UploadSimple size={16} />
            </SubmitButton>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
