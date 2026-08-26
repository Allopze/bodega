"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/lib/form-state"
import { createOrderAction } from "./actions"
import { computeOrderTotals } from "@/lib/order-totals"
import { itemSupplierId, suggestedPrice, applySuggestedPrices } from "./oc-form.helpers"
import type { ActionState } from "@/lib/validation/operations"
import type { SupplierOption, WorksiteOption, PendingItemOption, OcItemRow } from "./oc-form.types"

/** Identidad estable: un `[]` nuevo por render reiniciaría los inicializadores. */
const EMPTY_ITEM_IDS: string[] = []

export function useOcForm({
  suppliers,
  worksites,
  pendingItems,
  initialWorksiteId,
  initialItemIds = EMPTY_ITEM_IDS,
}: {
  suppliers:    SupplierOption[]
  worksites:    WorksiteOption[]
  pendingItems: PendingItemOption[]
  initialWorksiteId?: string
  /**
   * Ítems que trae el CTA de origen. Uno cuando viene de una tarea de "Mis
   * pendientes" (`?item=…`), todos los pendientes de una solicitud cuando viene
   * de "Generar OC" en la cola de Compras (`?solicitud=…`). Llegar con la lista
   * entera sin marcar obligaba a reencontrar a mano lo que se acababa de pulsar
   * (auditoría UI/UX 2026-07-29, A-06).
   */
  initialItemIds?: string[]
}) {
  const [supplierId,   setSupplierId]   = React.useState<string>("")
  const [worksiteId,   setWorksiteId]   = React.useState<string>(initialWorksiteId ?? worksites[0]?.id ?? "")
  const [paymentTerms, setPaymentTerms] = React.useState<string>("")
  const [estDelivery,  setEstDelivery]  = React.useState<string>("")
  const [address,      setAddress]      = React.useState<string>("")
  const [notes,        setNotes]        = React.useState<string>("")
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(
    () => new Set(initialItemIds.filter((id) => pendingItems.some((item) => item.id === id))),
  )
  // `null` = costo pendiente elegido explícitamente (campo vaciado en un servicio).
  const [unitPrices,   setUnitPrices]   = React.useState<Record<string, number | null>>({})
  const [discounts,    setDiscounts]    = React.useState<Record<string, number>>({})
  const [quantities,   setQuantities]   = React.useState<Record<string, number>>({})
  const [itemSuppliers, setItemSuppliers] = React.useState<Record<string, string>>({})
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
        resolveItemSupplierId(item, nextSupplierId),
      )
      return { ...prev, ...updates }
    })
  }

  function onSupplierValueChange(nextSupplierId: string) {
    handleSupplierChange(nextSupplierId)
  }

  function resolveItemSupplierId(item: PendingItemOption, globalSupplierId = supplierId) {
    return itemSuppliers[item.id] || item.suggestedSupplierId || globalSupplierId || ""
  }

  function setItemSupplier(itemId: string, supplierId: string) {
    setItemSuppliers((prev) => {
      const next = { ...prev }
      if (supplierId) next[itemId] = supplierId
      else delete next[itemId]
      return next
    })
    // When changing a per-item supplier, also auto-apply the supplier's catalog price if available
    const item = pendingItems.find((i) => i.id === itemId)
    if (item && supplierId) {
      const catalogPrice: number | undefined = item.supplierPrices[supplierId]
      if (catalogPrice !== undefined) {
        setUnitPrices((prev) => ({
          ...prev,
          [itemId]: catalogPrice,
        }))
      }
    }
  }

  function setDefaultPriceForItem(item: PendingItemOption) {
    const supplierForItem = resolveItemSupplierId(item)
    const price = suggestedPrice(item, supplierForItem)
    if (price === undefined) return
    setUnitPrices((prev) => (
      prev[item.id] === undefined || prev[item.id] === 0
        ? { ...prev, [item.id]: price }
        : prev
    ))
  }

  /**
   * Precio de la línea. `null` significa **costo pendiente**, y sólo puede
   * pasarle a un servicio: un ítem normal sin precio cargado sigue valiendo 0,
   * que es el comportamiento de siempre. Un 0 explícito en un servicio también
   * se respeta (servicio sin costo), por eso se distingue `null` de `0`.
   */
  function itemPrice(item: PendingItemOption): number | null {
    const explicit = unitPrices[item.id]
    if (explicit !== undefined) return explicit
    const suggested = suggestedPrice(item, resolveItemSupplierId(item))
    if (suggested !== undefined) return suggested
    return item.isService ? null : 0
  }

  function itemDiscount(itemId: string) {
    return discounts[itemId] ?? 0
  }

  // Cantidad a comprar por línea — por defecto la cantidad aprobada completa.
  // El remanente (si se compra menos) vuelve al consolidado de ítems sin OC.
  function itemQuantity(item: PendingItemOption) {
    return quantities[item.id] ?? item.quantity
  }

  function setItemPrice(itemId: string, value: string) {
    // Vaciar el campo de un servicio es la forma de decir "todavía no se sabe";
    // en cualquier otro ítem sigue significando 0, como antes.
    if (value.trim() === "") {
      const item = pendingItems.find((i) => i.id === itemId)
      setUnitPrices((p) => ({ ...p, [itemId]: item?.isService ? null : 0 }))
      return
    }
    setUnitPrices((p) => ({ ...p, [itemId]: parseFloat(value) || 0 }))
  }

  function setItemDiscount(itemId: string, value: string) {
    setDiscounts((p) => ({ ...p, [itemId]: parseFloat(value) || 0 }))
  }

  function setItemQuantity(item: PendingItemOption, value: string) {
    // Vaciar el campo dejaba la cantidad completa de vuelta, así que para
    // escribir "5" sobre "10" había que seleccionar todo y sobreescribir: el
    // primer borrado se deshacía solo. Un campo vacío se conserva vacío (0) y
    // el resto de la validación decide si se puede enviar.
    if (value.trim() === "") {
      setQuantities((p) => ({ ...p, [item.id]: 0 }))
      return
    }
    const parsed = parseFloat(value)
    const clamped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), item.quantity) : item.quantity
    setQuantities((p) => ({ ...p, [item.id]: clamped }))
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
  // Si la faena tiene ítems en ambos modos, arrancar en el modo del ítem que
  // traía el CTA: si no, el efecto de abajo elegiría `worksiteModes[0]` y el
  // ítem preseleccionado quedaría filtrado fuera de la vista (A-06).
  const [modeFilter, setModeFilter] = React.useState<PendingItemOption["deliveryMode"] | null>(
    // Todos los ítems preseleccionados vienen de la misma solicitud, así que
    // comparten modo de despacho: basta el primero.
    () => pendingItems.find((i) => initialItemIds.includes(i.id))?.deliveryMode ?? null,
  )
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
      quantity:                itemQuantity(i),
      unitPrice:               itemPrice(i),
      discount:                itemDiscount(i.id),
      targetSupplierId:        resolveItemSupplierId(i),
      itemSupplierOverrideId:  itemSuppliers[i.id],
    }))

  const totals = computeOrderTotals(includedItems)
  const supplierGroupCount = new Set(includedItems.flatMap((i) => i.targetSupplierId ? [i.targetSupplierId] : [])).size

  const itemsJson = JSON.stringify(
    includedItems.map((i) => ({
      requestItemId:   i.id,
      supplierId:      i.targetSupplierId || null,
      isSupplierOverride: !!itemSuppliers[i.id],
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
    selectedItems, unitPrices, discounts, quantities, itemSuppliers, search, state, modeFilter,
    // Setters
    setPaymentTerms, setEstDelivery, setAddress, setNotes,
    setWorksiteId, setSearch, setSupplierId, setItemSupplier,
    // Derived
    filteredByWorksite, filteredItems, worksiteModes, includedItems, totals, supplierGroupCount, itemsJson,
    // Handlers
    handleSupplierChange, onSupplierValueChange,
    setDefaultPriceForItem, resolveItemSupplierId,
    itemPrice, itemDiscount, setItemPrice, setItemDiscount,
    itemQuantity, setItemQuantity,
    toggleItem, toggleAll, handleModeChange,
    // Props passthrough
    action, suppliers, worksites, pendingItems,
  }
}
