"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createSupplierLinkAction } from "./actions"
import { IT_SUPPLIER_CATEGORIES } from "@/lib/validation/ti"
import { IT_SUPPLIER_CATEGORY_META } from "@/lib/services/ti/constants"
import { formatCLP } from "@/lib/utils"
import { Plus } from "@phosphor-icons/react"

interface LinkRow {
  id: string
  supplierId: string
  category: string
  notes: string | null
  supplierName: string
  supplierRut: string | null
  supplierEmail: string | null
  supplierPhone: string | null
  assetCount: number
  maintenanceCount: number
  maintenanceCost: number
  licenseCount: number
}

interface SupplierLinksPanelProps {
  links: LinkRow[]
  canManage: boolean
  suppliers: { id: string; name: string }[]
}

export function SupplierLinksPanel({ links, canManage, suppliers }: SupplierLinksPanelProps) {
  const [open, setOpen] = React.useState(false)
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createSupplierLinkAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Proveedor TI registrado")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h2">Proveedores TI</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Reutiliza el catálogo de proveedores de CHOME; acá se identifica qué categorías TI atiende cada uno.
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} className="mr-1.5" /> Vincular proveedor
          </Button>
        )}
      </div>

      {links.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-text-subtle)] italic">
          Aún no hay proveedores identificados como TI. Vínculalos desde el catálogo existente.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {links.map((link) => (
            <li key={link.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">{link.supplierName}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {IT_SUPPLIER_CATEGORY_META[link.category] ?? link.category}
                    {link.supplierRut && ` · ${link.supplierRut}`}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)] sm:grid-cols-4">
                <div><dt>Activos</dt><dd className="font-semibold text-[var(--color-text)]">{link.assetCount}</dd></div>
                <div><dt>Reparaciones</dt><dd className="font-semibold text-[var(--color-text)]">{link.maintenanceCount}</dd></div>
                <div><dt>Costo reparaciones</dt><dd className="font-semibold text-[var(--color-text)]">{formatCLP(link.maintenanceCost)}</dd></div>
                <div><dt>Licencias</dt><dd className="font-semibold text-[var(--color-text)]">{link.licenseCount}</dd></div>
              </dl>
              {(link.supplierEmail || link.supplierPhone) && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  {[link.supplierEmail, link.supplierPhone].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <SheetContent className="sm:max-w-md">
          <form action={formAction} className="flex flex-col flex-1 min-h-0">
            <SheetHeader>
              <div>
                <SheetTitle>Vincular proveedor TI</SheetTitle>
                <SheetDescription>Identifica a qué categorías TI atiende este proveedor del catálogo.</SheetDescription>
              </div>
              <SheetCloseButton />
            </SheetHeader>
            <SheetBody className="space-y-4">
              {state.message && !state.ok && !state.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
              )}
              <FieldGroup>
                <Field label="Proveedor" required error={state.fieldErrors?.supplierId?.[0]}>
                  <Select name="supplierId">
                    <SelectTrigger aria-label="Proveedor">
                      <SelectValue placeholder="Selecciona del catálogo" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Categoría TI" required error={state.fieldErrors?.category?.[0]}>
                  <Select name="category">
                    <SelectTrigger aria-label="Categoría TI">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_SUPPLIER_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{IT_SUPPLIER_CATEGORY_META[c] ?? c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Notas">
                  <Textarea name="notes" maxLength={300} rows={3} />
                </Field>
              </FieldGroup>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <SubmitButton label="Vincular" loadingLabel="Guardando..." />
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  )
}
