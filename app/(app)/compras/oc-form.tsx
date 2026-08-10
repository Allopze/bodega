"use client"

import * as React from "react"
import { Warning } from "@phosphor-icons/react"
import Link from "next/link"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { useOcForm } from "./use-oc-form"
import { OcFormItems } from "./oc-form-items"
import { OcFormSummary } from "./oc-form-summary"
import { PAYMENT_TERMS_OPTIONS } from "./oc-form.types"
import type { SupplierOption, WorksiteOption, PendingItemOption } from "./oc-form.types"

export type { SupplierOption, WorksiteOption, PendingItemOption }

export function OcForm({
  suppliers,
  worksites,
  pendingItems,
  initialWorksiteId,
  initialItemIds,
}: {
  suppliers:    SupplierOption[]
  worksites:    WorksiteOption[]
  pendingItems: PendingItemOption[]
  initialWorksiteId?: string
  initialItemIds?: string[]
}) {
  const f = useOcForm({ suppliers, worksites, pendingItems, initialWorksiteId, initialItemIds })

  return (
    <form action={f.action} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <input type="hidden" name="itemsJson"  value={f.itemsJson} />
      <input type="hidden" name="supplierId" value={f.supplierId} />
      <input type="hidden" name="worksiteId" value={f.worksiteId} />

      <div className="space-y-6">
        {/* Header fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Faena" required htmlFor="ocWorksiteId">
          <Select value={f.worksiteId} onValueChange={f.setWorksiteId}>
            <SelectTrigger id="ocWorksiteId"><SelectValue placeholder="Selecciona faena" /></SelectTrigger>
            <SelectContent>
              {f.worksites.map((w: WorksiteOption) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Proveedor por defecto" htmlFor="supplierId">
          <Select value={f.supplierId} onValueChange={f.onSupplierValueChange}>
            <SelectTrigger id="supplierId"><SelectValue placeholder="Selecciona proveedor (opcional)" /></SelectTrigger>
            <SelectContent>
              {f.suppliers.map((s: SupplierOption) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* A-30: era texto libre y los datos ya divergen ("30 días", "Contado",
            "CREDITO"). No se convirtió en `Select` a propósito: rechazaría los
            valores que ya existen en proveedores y OC históricas. Un `datalist`
            nativo guía hacia el vocabulario canónico sin bloquear lo demás, y el
            valor que trae el proveedor sigue autocompletándose. */}
        <Field label="Condición de pago" htmlFor="paymentTerms" helper="Elige una opción o escribe la condición acordada.">
          <Input
            id="paymentTerms"
            name="paymentTerms"
            list="payment-terms-options"
            value={f.paymentTerms}
            onChange={(e) => f.setPaymentTerms(e.target.value)}
            placeholder="30 días, contado, etc."
          />
          <datalist id="payment-terms-options">
            {PAYMENT_TERMS_OPTIONS.map((term) => <option key={term} value={term} />)}
          </datalist>
        </Field>

        <Field label="Entrega estimada" htmlFor="estimatedDelivery">
          <DatePicker
            id="estimatedDelivery"
            name="estimatedDelivery"
            value={f.estDelivery}
            onChange={f.setEstDelivery}
          />
        </Field>

        <Field label="Dirección de entrega" className="md:col-span-2" htmlFor="deliveryAddress">
          <Input
            id="deliveryAddress"
            name="deliveryAddress"
            value={f.address}
            onChange={(e) => f.setAddress(e.target.value)}
            placeholder="Dirección donde se recibirán los ítems"
          />
        </Field>

        <Field label="Notas" className="md:col-span-2" htmlFor="ocNotes">
          <Textarea
            id="ocNotes"
            name="notes"
            value={f.notes}
            onChange={(e) => f.setNotes(e.target.value)}
            rows={2}
            placeholder="Instrucciones adicionales para el proveedor..."
          />
        </Field>
        </div>

        {/* Item selection */}
        <OcFormItems
          filteredItems={f.filteredItems}
          filteredByWorksite={f.filteredByWorksite}
          selectedItems={f.selectedItems}
          suppliers={f.suppliers}
          worksiteId={f.worksiteId}
          search={f.search}
          worksiteModes={f.worksiteModes}
          modeFilter={f.modeFilter}
          onModeChange={f.handleModeChange}
          onToggle={f.toggleItem}
          onToggleAll={f.toggleAll}
          onSearchChange={f.setSearch}
          itemPrice={f.itemPrice}
          itemDiscount={f.itemDiscount}
          setItemPrice={f.setItemPrice}
          setItemDiscount={f.setItemDiscount}
          itemQuantity={f.itemQuantity}
          setItemQuantity={f.setItemQuantity}
          resolveItemSupplierId={f.resolveItemSupplierId}
          setItemSupplier={f.setItemSupplier}
        />

        {/* Error */}
        {f.state.ok === false && f.state.message && f.state !== INITIAL_STATE && (
          <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
            <Warning size={14} /> {f.state.message}
          </p>
        )}

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
          <Link
            href="/compras"
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Cancelar
          </Link>
          <SubmitButton
            label={`Crear OC (${f.includedItems.length} ítem${f.includedItems.length !== 1 ? "s" : ""})`}
            loadingLabel="Creando..."
            variant="primary"
            disabled={f.includedItems.length === 0 || !f.worksiteId}
          />
        </div>
      </div>

      <OcFormSummary
        includedItems={f.includedItems}
        worksiteId={f.worksiteId}
        supplierId={f.supplierId}
        supplierGroupCount={f.supplierGroupCount}
        totals={f.totals}
      />
    </form>
  )
}
