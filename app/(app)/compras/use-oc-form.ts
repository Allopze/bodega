"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { createOrderAction } from "./actions"
import { computeOrderTotals } from "@/lib/order-totals"
import { itemSupplierId, suggestedPrice, applySuggestedPrices } from "./oc-form.helpers"
import type { ActionState } from "@/lib/validation/operations"
import type { SupplierOption, WorksiteOption, PendingItemOption, OcItemRow } from "./oc-form.types"

export function useOcForm({
  suppliers,
  worksites,
  pendingItems,
  initialWorksiteId,
}: {
  suppliers:    SupplierOption[]
  worksites:    WorksiteOption[]
  pendingItems: PendingItemOption[]
  initialWorksiteId?: string
}) {
  const [supplierId,   setSupplierId]   = React.useState<string>("")
  const [worksiteId,   setWorksiteId]   = React.useState<string>(initialWorksiteId ?? worksites[0]?.id ?? "")
  const [paymentTerms, setPaymentTerms] = React.useState<string>("")
  const [estDelivery,  setEstDelivery]  = React.useState<string>("")
  const [address,      setAddress]      = React.useState<string>("")
  const [notes,        setNotes]        = React.useState<string>("")
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set())
  const [unitPrices,   setUnitPrices]   = React.useState<Record<string, number>>({})
  const [discounts,    setDiscounts]    = React.useState<Record<string, number>>({})
  const [search,       setSearch]       = React.useState("")

  const [state, action] = useActionState<ActionState, FormData>(createOrderAction, INITIAL_STATE)

  React.useEffect(() => {
    if (state.ok === false && state.message && state !== INITIAL_STATE) {
      toast.error(state.message)
    }
  }, [state])

  function handleSupplierChange(nextSupplierId: string) {
    setSupplierId(nextSupplierId)
    const nextSupplier = suppliers.find((s) => s.id === nextSupplierId)
    if (nextSupplier?.paymentTerms) setPaymentTerms(nextSupplier.paymentTerms)
    setUnitPrices((prev) => {
      const updates = applySuggestedPrices(pendingItems, nextSupplierId, (item) =>
        itemSupplierId(item, nextSupplierId),
      )
      return { ...prev, ...updates }
    })
  }

  function onSupplierValueChange(nextSupplierId: string) {
    handleSupplierChange(nextSupplierId)
  }

  function setDefaultPriceForItem(item: PendingItemOption) {
    const price = suggestedPrice(item, itemSupplierId(item, supplierId))
    if (price === undefined) return
    setUnitPrices((prev) => (
      prev[item.id] === undefined || prev[item.id] === 0
        ? { ...prev, [item.id]: price }
        : prev
    ))
  }

  function itemPrice(item: PendingItemOption) {
    return unitPrices[item.id] ?? suggestedPrice(item, itemSupplierId(item, supplierId)) ?? 0
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
  const filteredByWorksite = worksiteId
    ? pendingItems.filter((i) => i.worksiteId === worksiteId)
    : pendingItems

  // The OC creation guard rejects mixing via_oficina and directo_faena items in
  // the same order, so when a faena has pending items in both modes, the picker
  // must work one mode at a time instead of allowing a mixed selection that
  // only fails once the user submits.
  const worksiteModes = React.useMemo(
    () => [...new Set(filteredByWorksite.map((i) => i.deliveryMode))],
    [filteredByWorksite],
  )
  const [modeFilter, setModeFilter] = React.useState<PendingItemOption["deliveryMode"] | null>(null)
  React.useEffect(() => {
    if (worksiteModes.length <= 1) { setModeFilter(null); return }
    if (!modeFilter || !worksiteModes.includes(modeFilter)) setModeFilter(worksiteModes[0]!)
  }, [worksiteModes, modeFilter])

  const filteredByMode = modeFilter
    ? filteredByWorksite.filter((i) => i.deliveryMode === modeFilter)
    : filteredByWorksite

  // Client-side text search across product name, SKU, and request code
  const normalizedSearch = search.trim().toLowerCase()
  const filteredItems = normalizedSearch
    ? filteredByMode.filter((i) =>
        i.productName.toLowerCase().includes(normalizedSearch) ||
        (i.productSku ?? "").toLowerCase().includes(normalizedSearch) ||
        i.requestCode.toLowerCase().includes(normalizedSearch)
      )
    : filteredByMode

  // Auto-select suggested supplier if all filtered items share the same suggestedSupplierId
  React.useEffect(() => {
    if (supplierId) return
    const firstSuggested = filteredItems[0]?.suggestedSupplierId
    if (!firstSuggested) return
    const allSame = filteredItems.every((i) => i.suggestedSupplierId === firstSuggested)
    if (allSame) {
      setSupplierId(firstSuggested)
      const nextSupplier = suppliers.find((s) => s.id === firstSuggested)
      if (nextSupplier?.paymentTerms) setPaymentTerms(nextSupplier.paymentTerms)
      setUnitPrices((prev) => {
        const next = { ...prev }
        for (const item of filteredItems) {
          const price = item.supplierPrices[item.suggestedSupplierId || firstSuggested]
          if (price !== undefined) next[item.id] = price
        }
        return next
      })
    }
  }, [filteredItems, supplierId, suppliers])

  // A tab switch changes which items are selectable; clear the selection
  // instead of carrying over ids from the other mode (they'd fail the
  // mixing guard on submit anyway).
  function handleModeChange(mode: string) {
    setModeFilter(mode as PendingItemOption["deliveryMode"])
    setSelectedItems(new Set())
  }

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
      setUnitPrices((prev) => {
        const updates = applySuggestedPrices(filteredItems, supplierId, (item) =>
          itemSupplierId(item, supplierId),
        )
        return { ...prev, ...updates }
      })
    }
  }

  const includedItems: OcItemRow[] = filteredItems
    .filter((i) => selectedItems.has(i.id))
    .map((i) => ({
      ...i,
      unitPrice: itemPrice(i),
      discount:  itemDiscount(i.id),
      targetSupplierId: itemSupplierId(i, supplierId),
    }))

  const totals = computeOrderTotals(includedItems)
  const supplierGroupCount = new Set(includedItems.flatMap((i) => i.targetSupplierId ? [i.targetSupplierId] : [])).size

  const itemsJson = JSON.stringify(
    includedItems.map((i) => ({
      requestItemId:   i.id,
      supplierId:      i.targetSupplierId || null,
      productId:       i.productId,
      productNameFree: i.productNameFree,
      quantity:        i.quantity,
      unitOfMeasure:   i.unitOfMeasure,
      unitPrice:       i.unitPrice,
      discount:        i.discount,
      notes:           i.notes,
    }))
  )

  return {
    // State
    supplierId, worksiteId, paymentTerms, estDelivery, address, notes,
    selectedItems, unitPrices, discounts, search, state, modeFilter,
    // Setters
    setPaymentTerms, setEstDelivery, setAddress, setNotes,
    setWorksiteId, setSearch, setSupplierId,
    // Derived
    filteredByWorksite, filteredItems, worksiteModes, includedItems, totals, supplierGroupCount, itemsJson,
    // Handlers
    handleSupplierChange, onSupplierValueChange,
    setDefaultPriceForItem,
    itemPrice, itemDiscount, setItemPrice, setItemDiscount,
    toggleItem, toggleAll, handleModeChange,
    // Props passthrough
    action, suppliers, worksites, pendingItems,
  }
}
