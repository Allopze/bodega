"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { ALL_WORKSITES_LABEL } from "@/lib/auth/worksite-label"

/**
 * Faena de un tablero de Control operacional. Viaja en la URL (`faena`) y se aplica al cambiar,
 * con `router.replace` + `scroll: false` (patrón de filtros de AGENTS.md). Sólo aparece si quien
 * mira ve más de una faena; si ve una, el chip «Tu faena» de la TopBar ya la nombra en este mismo
 * lugar, y mientras el selector existe ese chip se oculta (dos rótulos de faena distintos en la
 * misma barra se leían como una contradicción: crítica 2026-11-15).
 */
export function BoardWorksiteSelect({
  worksites,
  worksiteId,
  allLabel = ALL_WORKSITES_LABEL,
}: {
  worksites: ReadonlyArray<{ id: string; name: string }>
  /** Faena elegida; `null` = todas las visibles. */
  worksiteId: string | null
  /** Rótulo de «todas»: lo resuelve el servidor con `allWorksitesLabel(alcance)` («Todas tus faenas» si el alcance es limitado). */
  allLabel?: string
}) {
  const show = worksites.length > 1
  useWorksiteFilterPresence(show)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  if (!show) return null

  return (
    <WorksiteSelect
      worksites={worksites as Array<{ id: string; name: string }>}
      value={worksiteId ?? ""}
      includeAll
      allLabel={allLabel}
      disabled={pending}
      aria-label="Faena del tablero"
      // Mismo alto que el control de período a su lado (36 px con su borde; 44 en pantalla táctil).
      triggerClassName="h-11 sm:h-9 w-full sm:w-48 text-[13px]"
      onChange={(value) => {
        const params = new URLSearchParams(searchParams.toString())
        if (value) params.set("faena", value)
        else params.delete("faena")
        const query = params.toString()
        startTransition(() => {
          router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
        })
      }}
    />
  )
}

/**
 * Las acciones de cabecera de un tablero (Panel de mantención, Indicadores GPS; el Panel de
 * combustible usa `FuelHeaderActions` con el mismo orden): primero **lo que acota el tablero**
 * —faena y período—, después las acciones propias y la exportación. Va en `PageHeader.actions`,
 * así que en escritorio queda en la TopBar y en móvil bajo el título, con la faena y el período en
 * su propia fila.
 */
export function BoardHeaderActions({
  worksites,
  worksiteId,
  period,
  allLabel,
  children,
}: {
  worksites: ReadonlyArray<{ id: string; name: string }>
  worksiteId: string | null
  /** Rótulo de «todas las faenas» según el alcance de quien mira (`allWorksitesLabel`). */
  allLabel?: string
  /** El control del período (`PeriodControl`, o `FuelPeriodControl` en Combustible). */
  period: React.ReactNode
  /** Acciones propias del tablero y «Exportar Excel», en ese orden. */
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      <BoardScope worksites={worksites} worksiteId={worksiteId} period={period} allLabel={allLabel} />
      {children}
    </div>
  )
}

/**
 * Faena y período juntos: en móvil ocupan una fila cada uno, a todo el ancho (el período estira su
 * rótulo entre las flechas); desde `sm`, uno al lado del otro con su ancho propio.
 */
export function BoardScope({
  worksites,
  worksiteId,
  period,
  allLabel,
}: {
  worksites: ReadonlyArray<{ id: string; name: string }>
  worksiteId: string | null
  period: React.ReactNode
  /** Rótulo de «todas las faenas» según el alcance de quien mira (`allWorksitesLabel`). */
  allLabel?: string
}) {
  return (
    <>
      {worksites.length > 1 ? (
        <div className="max-sm:w-full">
          <BoardWorksiteSelect worksites={worksites} worksiteId={worksiteId} allLabel={allLabel} />
        </div>
      ) : null}
      <div className="max-sm:w-full max-sm:*:flex max-sm:*:w-full">{period}</div>
    </>
  )
}
