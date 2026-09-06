"use client"

import * as React from "react"
import { PencilSimple, Plus, Power } from "@phosphor-icons/react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { FUEL_PRODUCT_CATEGORY_LABELS, FUEL_PRODUCT_UNIT_LABELS } from "@/lib/combustibles/validation"
import { setFuelProductStatusAction } from "./actions"
import { FuelProductForm, type FuelProductRow } from "./product-form"

export function FuelProductCatalog({ rows }: { rows: FuelProductRow[] }) {
  const [row, setRow] = React.useState<FuelProductRow | null>(null)
  const [open, setOpen] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  function close() { setOpen(false); setRow(null) }
  async function toggle(item: FuelProductRow) { setPendingId(item.id); const result = await setFuelProductStatusAction(item.id, !item.isActive); if (result.ok) toast.success(result.message); else toast.error(result.message); setPendingId(null) }
  return <>
    <PageHeader title="Productos de combustible" description="Catálogo canónico para TAE, facturación y compatibilidad de equipos." breadcrumb={[{ label: "Inicio", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Catálogos de flota", href: "/admin/flota-catalogos" }, { label: "Productos de combustible" }]} actions={<Button size="sm" onClick={() => setOpen(true)}><Plus size={15} />Nuevo producto</Button>} />
    <div className="overflow-x-auto border border-[var(--color-border)]"><Table className="min-w-[820px]"><TableHeader><TableRow><TableHead>Producto</TableHead><TableHead>Categoría</TableHead><TableHead>Unidad</TableHead><TableHead>Equipos</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id}><TableCell><span className="font-medium">{item.name}</span><span className="block font-mono text-xs text-[var(--color-text-muted)]">{item.code}</span></TableCell><TableCell>{FUEL_PRODUCT_CATEGORY_LABELS[item.category as keyof typeof FUEL_PRODUCT_CATEGORY_LABELS] ?? item.category}</TableCell><TableCell>{FUEL_PRODUCT_UNIT_LABELS[item.unit as keyof typeof FUEL_PRODUCT_UNIT_LABELS] ?? item.unit}</TableCell><TableCell className="font-mono">{item.vehicleCount}</TableCell><TableCell><MetaBadge meta={item.isActive ? { label: "Activo", variant: "success" } : { label: "Inactivo", variant: "default" }} /></TableCell><TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => { setRow(item); setOpen(true) }}><PencilSimple size={15} />Editar</Button><Button size="sm" variant="secondary" disabled={pendingId === item.id} onClick={() => toggle(item)}><Power size={15} />{item.isActive ? "Desactivar" : "Activar"}</Button></div></TableCell></TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-[var(--color-text-muted)]">No hay productos configurados.</TableCell></TableRow>}</TableBody></Table></div>
    <FuelProductForm key={row?.id ?? "new"} open={open} onClose={close} row={row} />
  </>
}
