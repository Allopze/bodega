"use client"

import * as React from "react"
import { Package, MagnifyingGlass } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatQty, formatCLP } from "@/lib/utils"
import { priceHint, suggestedSupplierLabel } from "./oc-form.helpers"
import type { SupplierOption, PendingItemOption } from "./oc-form.types"

const MODE_LABELS: Record<string, string> = {
  via_oficina:   "Vía oficina",
  directo_faena: "Directo a faena",
}

interface OcFormItemsProps {
  filteredItems:      PendingItemOption[]
  filteredByWorksite: PendingItemOption[]
  selectedItems:      Set<string>
  suppliers:          SupplierOption[]
  worksiteId:         string
  search:             string
  worksiteModes:      string[]
  modeFilter:         string | null
  onModeChange:       (mode: string) => void
  onToggle:           (itemId: string) => void
  onToggleAll:        () => void
  onSearchChange:     (value: string) => void
  itemPrice:          (item: PendingItemOption) => number
  itemDiscount:       (itemId: string) => number
  setItemPrice:       (itemId: string, value: string) => void
  setItemDiscount:    (itemId: string, value: string) => void
  itemQuantity:       (item: PendingItemOption) => number
  setItemQuantity:    (item: PendingItemOption, value: string) => void
  resolveItemSupplierId: (item: PendingItemOption) => string
  setItemSupplier:    (itemId: string, supplierId: string) => void
}

export function OcFormItems({
  filteredItems, filteredByWorksite, selectedItems, suppliers,
  worksiteId, search, worksiteModes, modeFilter, onModeChange, onToggle, onToggleAll, onSearchChange,
  itemPrice, itemDiscount, setItemPrice, setItemDiscount, itemQuantity, setItemQuantity,
  resolveItemSupplierId, setItemSupplier,
}: OcFormItemsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-h2 text-[var(--color-text)]">
          Ítems a incluir
        </h2>
        {filteredItems.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onToggleAll}>
            {selectedItems.size === filteredItems.length ? "Deseleccionar todos" : "Seleccionar todos"}
          </Button>
        )}
      </div>

      {/* This faena has pending items in more than one modo de despacho — the OC
          guard rejects mixing them, so the picker works one mode at a time. */}
      {worksiteModes.length > 1 && modeFilter && (
        <Tabs value={modeFilter} onValueChange={onModeChange}>
          <TabsList>
            {worksiteModes.map((mode) => {
              const modeCount = filteredByWorksite.filter((i) => i.deliveryMode === mode).length
              return (
                <TabsTrigger key={mode} value={mode}>
                  {MODE_LABELS[mode] ?? mode} ({modeCount})
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
      )}

      {filteredByWorksite.length > 10 && (
        <div className="relative">
          <MagnifyingGlass size={16} weight="bold" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por producto, SKU o código de solicitud..."
            className="w-full h-9 pl-10 pr-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            aria-label="Buscar ítems para incluir en la OC"
          />
        </div>
      )}

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
            const isSelected   = selectedItems.has(item.id)
            const price        = itemPrice(item)
            const disc         = itemDiscount(item.id)
            const qty          = itemQuantity(item)
            const isPartial    = qty < item.quantity
            const subtotal     = qty * price * (1 - disc / 100)
            const supplierForItem = resolveItemSupplierId(item)
            const hint         = priceHint(item, supplierForItem)
            const supLabel     = suggestedSupplierLabel(item, suppliers)

            return (
              <div
                key={item.id}
                className={`flex items-start gap-3 px-4 py-3 transition-colors duration-[var(--duration-fast)] ${
                  isSelected ? "bg-[var(--color-primary-tint)]" : "bg-[var(--color-surface)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(item.id)}
                  className="mt-1 h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer"
                  aria-label={`Incluir ${item.productName}`}
                />

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
                    <Badge variant="outline" size="sm" className="font-normal shrink-0 text-[11px]">
                      {MODE_LABELS[item.deliveryMode] ?? item.deliveryMode}
                    </Badge>
                    {supLabel && (
                      <Badge variant="warning" size="sm" className="font-normal shrink-0">
                        Sugerido: {supLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Aprobado: {formatQty(item.quantity, item.unitOfMeasure)}
                    {item.notes && ` · ${item.notes}`}
                    {isSelected && isPartial && (
                      <span className="text-[var(--color-warning-ink)]">
                        {" "}· El remanente ({formatQty(item.quantity - qty, item.unitOfMeasure)}) vuelve pendiente de OC
                      </span>
                    )}
                  </div>
                </div>

                {isSelected && (
                  <div className="flex items-start gap-2 shrink-0">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`qty-${item.id}`} className="text-[10px] text-[var(--color-text-subtle)]">
                        Cantidad
                      </label>
                      <Input
                        id={`qty-${item.id}`}
                        type="number" step="0.01" min="0.01" max={item.quantity}
                        value={qty}
                        onChange={(e) => setItemQuantity(item, e.target.value)}
                        className="h-7 w-20 text-sm tabular-nums"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`supplier-${item.id}`} className="text-[10px] text-[var(--color-text-subtle)]">
                        Proveedor
                      </label>
                      <Select value={supplierForItem} onValueChange={(v) => setItemSupplier(item.id, v)}>
                        <SelectTrigger id={`supplier-${item.id}`} className="h-7 w-36 text-xs">
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`price-${item.id}`} className="text-[10px] text-[var(--color-text-subtle)]">
                        Precio unit.
                      </label>
                      <Input
                        id={`price-${item.id}`}
                        type="number" step="1" min="0"
                        value={price || ""}
                        onChange={(e) => setItemPrice(item.id, e.target.value)}
                        className="h-7 w-28 text-sm tabular-nums"
                        placeholder="0"
                        title={hint ?? undefined}
                      />
                      {hint && (
                        <span className="text-[10px] text-[var(--color-text-subtle)]">catálogo</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`disc-${item.id}`} className="text-[10px] text-[var(--color-text-subtle)]">
                        Desc. %
                      </label>
                      <Input
                        id={`disc-${item.id}`}
                        type="number" step="0.1" min="0" max="100"
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
  )
}
