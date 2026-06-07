"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "sonner"
import { Warning, Package } from "@phosphor-icons/react"
import Link from "next/link"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { createOrderAction } from "./actions"
import { formatQty, formatCLP } from "@/lib/utils"
import { computeOrderTotals } from "@/lib/order-totals"
import type { ActionState } from "@/lib/validation/operations"

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface SupplierOption {
  id:           string
  name:         string
  paymentTerms: string | null
}

export interface WorksiteOption {
  id:   string
  name: string
}

export interface PendingItemOption {
  id:            string
  requestId:     string
  requestCode:   string
  worksiteId:    string
  worksiteName:  string
  productName:   string
  productSku:    string | null
  productId:     string | null
  productNameFree: string | null
  quantity:      number
  unitOfMeasure: string
  urgency:       string
  notes:         string | null
  supplierPrices: Record<string, number>
}

/* ── Row in the OC items table ───────────────────────────────────────────────── */

interface OcItemRow extends PendingItemOption {
  unitPrice: number
  discount:  number
}

/* ── OC form ─────────────────────────────────────────────────────────────────── */

export function OcForm({
  suppliers,
  worksites,
  pendingItems,
}: {
  suppliers:    SupplierOption[]
  worksites:    WorksiteOption[]
  pendingItems: PendingItemOption[]
}) {
  const [supplierId,   setSupplierId]   = React.useState<string>("")
  const [worksiteId,   setWorksiteId]   = React.useState<string>(worksites[0]?.id ?? "")
  const [paymentTerms, setPaymentTerms] = React.useState<string>("")
  const [estDelivery,  setEstDelivery]  = React.useState<string>("")
  const [address,      setAddress]      = React.useState<string>("")
  const [notes,        setNotes]        = React.useState<string>("")
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set())
  const [unitPrices,   setUnitPrices]   = React.useState<Record<string, number>>({})
  const [discounts,    setDiscounts]    = React.useState<Record<string, number>>({})

  const [state, action] = useActionState<ActionState, FormData>(createOrderAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  function suggestedPrice(item: PendingItemOption, nextSupplierId = supplierId) {
    return nextSupplierId ? item.supplierPrices[nextSupplierId] : undefined
  }

  function applySuggestedPrices(nextSupplierId: string, items = pendingItems) {
    setUnitPrices((prev) => {
      const next = { ...prev }
      for (const item of items) {
        const price = suggestedPrice(item, nextSupplierId)
        if (price !== undefined) next[item.id] = price
      }
      return next
    })
  }

  function handleSupplierChange(nextSupplierId: string) {
    setSupplierId(nextSupplierId)
    const nextSupplier = suppliers.find((s) => s.id === nextSupplierId)
    if (nextSupplier?.paymentTerms) setPaymentTerms(nextSupplier.paymentTerms)
    applySuggestedPrices(nextSupplierId)
  }

  function setDefaultPriceForItem(item: PendingItemOption) {
    const price = suggestedPrice(item)
    if (price === undefined) return
    setUnitPrices((prev) => (
      prev[item.id] === undefined || prev[item.id] === 0
        ? { ...prev, [item.id]: price }
        : prev
    ))
  }

  function onSupplierValueChange(nextSupplierId: string) {
    handleSupplierChange(nextSupplierId)
  }

  function priceHint(item: PendingItemOption) {
    const price = suggestedPrice(item)
    if (price === undefined) return null
    return `Precio catálogo: ${formatCLP(price)}`
  }

  function itemPrice(item: PendingItemOption) {
    return unitPrices[item.id] ?? suggestedPrice(item) ?? 0
  }

  function itemDiscount(itemId: string) {
    return discounts[itemId] ?? 0
  }

  function setItemPrice(itemId: string, value: string) {
    setUnitPrices((p) => ({ ...p, [itemId]: parseFloat(value) || 0 }))
  }

  function setItemDiscount(itemId: string, value: string) {
    setDiscounts((p) => ({ ...p, [itemId]: parseFloat(value) || 0 }))
  }

  // Filter items by selected worksite
  const filteredItems = worksiteId
    ? pendingItems.filter((i) => i.worksiteId === worksiteId)
    : pendingItems

  function toggleItem(itemId: string) {
    const shouldSelect = !selectedItems.has(itemId)
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
    if (shouldSelect) {
      const item = pendingItems.find((i) => i.id === itemId)
      if (item) setDefaultPriceForItem(item)
    }
  }

  function toggleAll() {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set())
    } else {
      const next = new Set(filteredItems.map((i) => i.id))
      setSelectedItems(next)
      applySuggestedPrices(supplierId, filteredItems)
    }
  }

  const includedItems: OcItemRow[] = filteredItems
    .filter((i) => selectedItems.has(i.id))
    .map((i) => ({
      ...i,
      unitPrice: itemPrice(i),
      discount:  itemDiscount(i.id),
    }))

  const totals = computeOrderTotals(includedItems)

  // Serialize items to JSON for form submission
  const itemsJson = JSON.stringify(
    includedItems.map((i) => ({
      requestItemId:   i.id,
      productId:       i.productId,
      productNameFree: i.productNameFree,
      quantity:        i.quantity,
      unitOfMeasure:   i.unitOfMeasure,
      unitPrice:       i.unitPrice,
      discount:        i.discount,
      notes:           i.notes,
    }))
  )

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="itemsJson"  value={itemsJson} />
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="worksiteId" value={worksiteId} />

      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Faena" required>
          <Select value={worksiteId} onValueChange={setWorksiteId}>
            <SelectTrigger id="ocWorksiteId"><SelectValue placeholder="Selecciona faena" /></SelectTrigger>
            <SelectContent>
              {worksites.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Proveedor" required>
          <Select value={supplierId} onValueChange={onSupplierValueChange}>
            <SelectTrigger id="supplierId"><SelectValue placeholder="Selecciona proveedor" /></SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Condición de pago">
          <Input
            name="paymentTerms"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            placeholder="30 días, contado, etc."
          />
        </Field>

        <Field label="Entrega estimada">
          <Input
            type="date"
            name="estimatedDelivery"
            value={estDelivery}
            onChange={(e) => setEstDelivery(e.target.value)}
          />
        </Field>

        <Field label="Dirección de entrega" className="md:col-span-2">
          <Input
            name="deliveryAddress"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Dirección donde se recibirán los ítems"
          />
        </Field>

        <Field label="Notas" className="md:col-span-2">
          <Textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Instrucciones adicionales para el proveedor..."
          />
        </Field>
      </div>

      {/* Item selection */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Ítems a incluir
          </h2>
          {filteredItems.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
              {selectedItems.size === filteredItems.length ? "Deseleccionar todos" : "Seleccionar todos"}
            </Button>
          )}
        </div>

        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center border border-dashed border-[var(--color-border)] rounded-[var(--radius)]">
            <Package size={28} weight="light" className="text-[var(--color-text-subtle)]" />
            <p className="text-sm text-[var(--color-text-muted)]">
              {worksiteId
                ? "No hay ítems aprobados pendientes para esta faena."
                : "Selecciona una faena para ver los ítems disponibles."}
            </p>
          </div>
        ) : (
          <div className="border border-[var(--color-border)] rounded-[var(--radius)] divide-y divide-[var(--color-border)] overflow-hidden">
            {filteredItems.map((item) => {
              const isSelected  = selectedItems.has(item.id)
              const price       = itemPrice(item)
              const disc        = itemDiscount(item.id)
              const subtotal    = item.quantity * price * (1 - disc / 100)
              const hint        = priceHint(item)

              return (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] ${
                    isSelected ? "bg-[var(--color-primary-50)]" : "bg-[var(--color-surface)]"
                  }`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleItem(item.id)}
                    className="mt-1 h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer"
                    aria-label={`Incluir ${item.productName}`}
                  />

                  {/* Product info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.productSku && (
                        <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                          {item.productSku}
                        </span>
                      )}
                      <span className="text-sm font-medium text-[var(--color-text)]">
                        {item.productName}
                      </span>
                      <span className="text-xs text-[var(--color-text-subtle)]">
                        · SOL {item.requestCode}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {formatQty(item.quantity, item.unitOfMeasure)}
                      {item.notes && ` · ${item.notes}`}
                    </div>
                  </div>

                  {/* Pricing (only editable when selected) */}
                  {isSelected && (
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-[var(--color-text-subtle)]">
                          Precio unit.
                        </label>
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          value={price || ""}
                          onChange={(e) => setItemPrice(item.id, e.target.value)}
                          className="h-7 w-28 text-sm tabular-nums"
                          placeholder="0"
                          title={hint ?? undefined}
                        />
                        {hint && (
                          <span className="text-[10px] text-[var(--color-text-subtle)]">
                            catálogo
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-[var(--color-text-subtle)]">
                          Desc. %
                        </label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          value={disc || ""}
                          onChange={(e) => setItemDiscount(item.id, e.target.value)}
                          className="h-7 w-20 text-sm tabular-nums"
                          placeholder="0"
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-[80px] text-right">
                        <span className="text-[10px] text-[var(--color-text-subtle)]">Subtotal</span>
                        <span className="text-sm tabular-nums font-medium text-[var(--color-text)]">
                          {formatCLP(subtotal)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Totals */}
      {includedItems.length > 0 && (
        <div className="flex justify-end">
          <div className="flex flex-col gap-1 min-w-[240px] border border-[var(--color-border)] rounded-[var(--radius)] p-4">
            <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
              <span>Neto</span>
              <span className="tabular-nums">{formatCLP(totals.netAmount)}</span>
            </div>
            <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
              <span>IVA (19%)</span>
              <span className="tabular-nums">{formatCLP(totals.taxAmount)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-[var(--color-text)] pt-1 border-t border-[var(--color-border)] mt-1">
              <span>Total</span>
              <span className="tabular-nums">{formatCLP(totals.totalAmount)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {state.ok === false && state.message && state !== INITIAL_STATE && (
        <p className="text-sm text-[var(--color-danger)] flex items-center gap-1.5">
          <Warning size={14} /> {state.message}
        </p>
      )}

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
        <SubmitButton
          label={`Crear OC (${includedItems.length} ítem${includedItems.length !== 1 ? "s" : ""})`}
          loadingLabel="Creando..."
          variant="primary"
          disabled={includedItems.length === 0 || !supplierId || !worksiteId}
        />
        <Link
          href="/compras"
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          Cancelar
        </Link>
      </div>
    </form>
  )
}
