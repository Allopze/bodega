"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
  SheetCloseButton,
} from "@/components/admin/sheet"
import { Field } from "@/components/ui/field"

interface AdvancedFilterValues {
  categoria: string
  solicitante: string
  proveedor: string
  desde: string
  hasta: string
  pendientes: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
  suppliers: Array<{ id: string; name: string }>
  current: AdvancedFilterValues
  setFilters: (patch: Record<string, string>) => void
}

export function ConsolidatedFiltersAdvanced({
  open,
  onOpenChange,
  categories,
  requesters,
  suppliers,
  current,
  setFilters,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filtros avanzados</SheetTitle>
          <SheetDescription>
            Filtra por solicitante, proveedor, categoría o rangos de fecha para la faena activa.
          </SheetDescription>
          <SheetCloseButton />
        </SheetHeader>

        {/* Se monta al abrir para que el borrador arranque siempre desde los
            filtros vigentes; al cerrar se desmonta y no queda estado viejo. */}
        {open && (
          <AdvancedFiltersForm
            categories={categories}
            requesters={requesters}
            suppliers={suppliers}
            initial={current}
            onApply={(values) => {
              setFilters({
                categoria: values.categoria,
                solicitante: values.solicitante,
                proveedor: values.proveedor,
                pendientes: values.pendientes ? "true" : "",
                desde: values.desde,
                hasta: values.hasta,
              })
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

const EMPTY: AdvancedFilterValues = {
  categoria: "",
  solicitante: "",
  proveedor: "",
  desde: "",
  hasta: "",
  pendientes: false,
}

/**
 * El panel arma un borrador y lo aplica al confirmar.
 *
 * Antes cada `Select` navegaba en el momento: abrir el panel y tocar tres
 * filtros disparaba tres recargas del servidor, y el botón "Ver resultados"
 * sólo cerraba el panel aunque prometiera aplicar.
 */
function AdvancedFiltersForm({
  categories,
  requesters,
  suppliers,
  initial,
  onApply,
}: {
  categories: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
  suppliers: Array<{ id: string; name: string }>
  initial: AdvancedFilterValues
  onApply: (values: AdvancedFilterValues) => void
}) {
  const [draft, setDraft] = React.useState<AdvancedFilterValues>(initial)
  const patch = <K extends keyof AdvancedFilterValues>(key: K, value: AdvancedFilterValues[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  // Un rango invertido no devuelve nada y la pantalla no sabía explicar por
  // qué: los propios inputs se acotan entre sí y además se avisa.
  const invalidRange = Boolean(draft.desde && draft.hasta && draft.desde > draft.hasta)

  return (
    <>
      <SheetBody className="space-y-4 py-4">
        <Field label="Categoría de producto" htmlFor="filter-categoria">
          <Select
            value={draft.categoria || "_all"}
            onValueChange={(val) => patch("categoria", val === "_all" ? "" : val)}
          >
            <SelectTrigger id="filter-categoria">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todas las categorías</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Solicitante" htmlFor="filter-solicitante">
          <Select
            value={draft.solicitante || "_all"}
            onValueChange={(val) => patch("solicitante", val === "_all" ? "" : val)}
          >
            <SelectTrigger id="filter-solicitante">
              <SelectValue placeholder="Todos los solicitantes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todos los solicitantes</SelectItem>
              {requesters.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Proveedor" htmlFor="filter-proveedor">
          <Select
            value={draft.proveedor || "_all"}
            onValueChange={(val) => patch("proveedor", val === "_all" ? "" : val)}
          >
            <SelectTrigger id="filter-proveedor">
              <SelectValue placeholder="Todos los proveedores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Todos los proveedores</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="rounded-lg border border-[var(--color-border)] p-3 bg-[var(--color-surface-2)]">
          <Checkbox
            id="filter-pendientes"
            checked={draft.pendientes}
            onChange={(e) => patch("pendientes", e.target.checked)}
            label={
              <span>
                <span className="block text-sm font-medium text-[var(--color-text)]">Solo con pendientes</span>
                <span className="block text-xs text-[var(--color-text-muted)]">
                  Ocultar solicitudes y materiales 100% entregados
                </span>
              </span>
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha desde" htmlFor="filter-desde">
            <Input
              type="date"
              id="filter-desde"
              value={draft.desde}
              max={draft.hasta || undefined}
              onChange={(e) => patch("desde", e.target.value)}
            />
          </Field>
          <Field label="Fecha hasta" htmlFor="filter-hasta">
            <Input
              type="date"
              id="filter-hasta"
              value={draft.hasta}
              min={draft.desde || undefined}
              onChange={(e) => patch("hasta", e.target.value)}
            />
          </Field>
        </div>
        {invalidRange && (
          <p role="alert" className="text-xs font-medium text-[var(--color-signal-ink)]">
            La fecha «desde» es posterior a «hasta»: ningún movimiento puede caer en ese rango.
          </p>
        )}
      </SheetBody>

      <SheetFooter className="flex items-center justify-between gap-2 border-t pt-4">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setDraft(EMPTY)}
        >
          Restablecer
        </Button>
        <Button type="button" size="sm" disabled={invalidRange} onClick={() => onApply(draft)}>
          Ver resultados
        </Button>
      </SheetFooter>
    </>
  )
}
