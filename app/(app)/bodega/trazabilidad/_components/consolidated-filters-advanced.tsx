"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Array<{ id: string; name: string }>
  requesters: Array<{ id: string; name: string }>
  suppliers: Array<{ id: string; name: string }>
  current: {
    categoria: string
    solicitante: string
    proveedor: string
    desde: string
    hasta: string
    pendientes: boolean
  }
  setFilter: (key: string, value: string) => void
  setFilters: (patch: Record<string, string>) => void
}

export function ConsolidatedFiltersAdvanced({
  open,
  onOpenChange,
  categories,
  requesters,
  suppliers,
  current,
  setFilter,
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

        <SheetBody className="space-y-4 py-4">
          {/* Categoría */}
          <Field label="Categoría de producto" htmlFor="filter-categoria">
            <Select
              value={current.categoria || "_all"}
              onValueChange={(val) => setFilter("categoria", val === "_all" ? "" : val)}
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

          {/* Solicitante */}
          <Field label="Solicitante" htmlFor="filter-solicitante">
            <Select
              value={current.solicitante || "_all"}
              onValueChange={(val) => setFilter("solicitante", val === "_all" ? "" : val)}
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

          {/* Proveedor */}
          <Field label="Proveedor" htmlFor="filter-proveedor">
            <Select
              value={current.proveedor || "_all"}
              onValueChange={(val) => setFilter("proveedor", val === "_all" ? "" : val)}
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

          {/* Toggle solo pendientes */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 bg-slate-50/50">
            <div>
              <p className="text-sm font-medium text-slate-900">Solo con pendientes</p>
              <p className="text-xs text-slate-500">
                Ocultar solicitudes y materiales 100% entregados
              </p>
            </div>
            <input
              type="checkbox"
              id="filter-pendientes"
              checked={current.pendientes}
              onChange={(e) => setFilter("pendientes", e.target.checked ? "true" : "")}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha desde" htmlFor="filter-desde">
              <Input
                type="date"
                id="filter-desde"
                value={current.desde}
                onChange={(e) => setFilter("desde", e.target.value)}
              />
            </Field>
            <Field label="Fecha hasta" htmlFor="filter-hasta">
              <Input
                type="date"
                id="filter-hasta"
                value={current.hasta}
                onChange={(e) => setFilter("hasta", e.target.value)}
              />
            </Field>
          </div>
        </SheetBody>

        <SheetFooter className="flex items-center justify-between gap-2 border-t pt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setFilters({
                categoria: "",
                solicitante: "",
                proveedor: "",
                pendientes: "",
                desde: "",
                hasta: "",
              })
            }}
          >
            Restablecer
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Ver resultados
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
