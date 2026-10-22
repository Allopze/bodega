"use client"

import * as React from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { BigChoice, BigInput } from "./big-controls"
import { vehicleOf } from "./validate"
import type { StepViewProps } from "./step-props"

const VISIBLE_VEHICLES = 40

function vehicleLabel(vehicle: { code: string | null; plate: string }) {
  return vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate
}

/** Paso 1: ¿a qué equipo? Una lista de botones grandes, con búsqueda por código o patente. */
/**
 * `shellSearch`: dentro de la app autenticada el filtro de texto es el de la
 * barra superior (regla de búsqueda del repositorio: ninguna página agrega su
 * propio input). La PWA pública no tiene barra y usa su propio campo.
 */
export function StepVehicle({ config, draft, errors, patch, shellSearch }: StepViewProps & { shellSearch: boolean }) {
  const [localQuery, setLocalQuery] = React.useState("")
  const shell = useSafeShellHeader()
  const query = shellSearch ? shell.searchQuery : localQuery
  const vehicle = vehicleOf(config, draft)
  const term = query.trim().toLocaleUpperCase("es-CL").replace(/[\s-]/g, "")
  const matches = config.vehicles.filter((item) =>
    !term || `${item.code ?? ""}${item.plate}`.toLocaleUpperCase("es-CL").replace(/[\s-]/g, "").includes(term))
  const visible = matches.slice(0, VISIBLE_VEHICLES)
  const productOptions = (vehicle?.products ?? []).map((product) => ({ value: product.id, label: product.name, description: product.unit === "liter" ? "Litros" : product.unit }))
  const mediumOptions = config.supplyMedia.map((medium) => ({ value: medium.id, label: medium.name }))

  function chooseVehicle(id: string) {
    const next = config.vehicles.find((item) => item.id === id)
    // Un único combustible compatible no se pregunta: queda elegido.
    patch({ vehicleId: id, productId: next?.products.length === 1 ? next.products[0]!.id : "" })
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="field-vehicle-title">
        <h3 id="field-vehicle-title" className="text-lg font-semibold">¿A qué equipo le cargaste?</h3>
        {vehicle ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border-2 border-[var(--color-primary)] bg-[var(--color-primary-tint)] px-4 py-3">
            <span className="text-xl font-semibold">{vehicleLabel(vehicle)}</span>
            <button type="button" className="min-h-14 px-3 text-base font-semibold text-[var(--color-primary-ink)] underline" onClick={() => patch({ vehicleId: "", productId: "" })}>Cambiar</button>
          </div>
        ) : (
          <>
            {shellSearch ? (
              <p className="text-sm text-[var(--color-text-muted)]">Para encontrarlo más rápido, escribe parte del código o la patente en el filtro de arriba.</p>
            ) : (
              <div className="relative">
                <MagnifyingGlass size={22} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <BigInput id="tae-vehicle-search" aria-label="Buscar equipo por código o patente" placeholder="Busca por código o patente" value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} className="pl-11" autoComplete="off" />
              </div>
            )}
            <div role="listbox" id="tae-vehicle" aria-label="Equipos de la faena" className="grid gap-2">
              {visible.map((item) => (
                <button key={item.id} type="button" role="option" aria-selected={false} onClick={() => chooseVehicle(item.id)}
                  className="min-h-14 w-full cursor-pointer rounded-[var(--radius-md)] border-2 border-[var(--color-border-control)] bg-[var(--color-surface)] px-4 py-3 text-left text-lg font-semibold hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                  {vehicleLabel(item)}
                </button>
              ))}
              {matches.length === 0 && <p className="text-base text-[var(--color-text-muted)]">Ningún equipo coincide. Revisa lo que escribiste.</p>}
              {matches.length > visible.length && <p className="text-sm text-[var(--color-text-muted)]">Hay {matches.length - visible.length} equipos más. Escribe parte del código o la patente para encontrarlo.</p>}
            </div>
          </>
        )}
        {errors.vehicleId && <p role="alert" className="text-base font-medium text-[var(--color-danger-ink)]">{errors.vehicleId}</p>}
      </section>

      {vehicle && productOptions.length > 1 && (
        <section className="space-y-3" aria-labelledby="field-product-title">
          <h3 id="field-product-title" className="text-lg font-semibold">¿Qué combustible?</h3>
          <BigChoice label="Combustible" value={draft.productId} options={productOptions} onChange={(value) => patch({ productId: value })} />
        </section>
      )}
      {vehicle && productOptions.length === 1 && (
        <p className="text-base text-[var(--color-text-muted)]">Combustible: <strong className="text-[var(--color-text)]">{productOptions[0]!.label}</strong></p>
      )}
      {errors.productId && <p role="alert" className="text-base font-medium text-[var(--color-danger-ink)]">{errors.productId}</p>}

      <section className="space-y-3" aria-labelledby="field-medium-title">
        <h3 id="field-medium-title" className="text-lg font-semibold">¿Con qué medio se cargó?</h3>
        {mediumOptions.length === 0
          ? <p role="alert" className="text-base font-medium text-[var(--color-danger-ink)]">No hay medios de suministro disponibles. Avisa a tu supervisor.</p>
          : <BigChoice label="Medio de suministro" value={draft.supplyMediumId} options={mediumOptions} onChange={(value) => patch({ supplyMediumId: value })} />}
        {errors.supplyMediumId && <p role="alert" className="text-base font-medium text-[var(--color-danger-ink)]">{errors.supplyMediumId}</p>}
      </section>
    </div>
  )
}
