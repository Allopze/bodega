"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CaretDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MiperWorksiteTarget } from "@/lib/prevention/miper/portfolio"
import { listMiperWorksiteTargetsAction } from "../actions"
import { beforeForwardNavigation } from "./workspace-memory"

function labelOf(target: MiperWorksiteTarget) {
  return target.matrixId ? `${target.worksiteName} · ${target.period ?? "sin período"}` : `${target.worksiteName} · sin MIPER`
}

/**
 * «Cambiar de faena» (spec §2.3, Fase B).
 *
 * - La lista se pide al ABRIR el menú: es una lectura bajo demanda, no una
 *   consulta en cada render del espacio de trabajo. Se guarda mientras la página
 *   siga montada.
 * - Cambiar de faena es salir de esta MIPER, y eso necesita datos del servidor:
 *   va con `router.push`, precedido de `beforeForwardNavigation` como toda
 *   navegación hacia adelante del espacio de trabajo (spec §3).
 * - Una faena sin MIPER lleva a la portada acotada a ella, donde está «Crear MIPER».
 */
export function WorksiteSwitcher({ currentMatrixId }: { currentMatrixId: string }) {
  const router = useRouter()
  const operation = useOperation()
  const [targets, setTargets] = useState<MiperWorksiteTarget[] | null>(null)
  const load = () => operation.run(() => listMiperWorksiteTargetsAction({}), (result) => setTargets((result.data?.targets ?? []) as MiperWorksiteTarget[]))
  const go = (href: string) => {
    beforeForwardNavigation(href)
    router.push(href)
  }
  return (
    <DropdownMenu onOpenChange={(open) => { if (open && targets === null && !operation.pending) load() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">Cambiar de faena<CaretDown aria-hidden className="ml-1 size-3.5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>Faenas a tu alcance</DropdownMenuLabel>
        {operation.pending && <DropdownMenuItem disabled>Cargando faenas…</DropdownMenuItem>}
        {!operation.pending && operation.message && (
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); load() }}>{operation.message} Reintentar</DropdownMenuItem>
        )}
        {targets?.map((target) => (target.matrixId === currentMatrixId ? (
          <DropdownMenuItem key={target.worksiteId} disabled>{labelOf(target)} (actual)</DropdownMenuItem>
        ) : (
          <DropdownMenuItem key={target.worksiteId}
            onSelect={() => go(target.matrixId ? `/prevencion/miper/${target.matrixId}` : `/prevencion/miper?faena=${encodeURIComponent(target.worksiteId)}`)}>
            {labelOf(target)}
          </DropdownMenuItem>
        )))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go("/prevencion/miper")}>Ver todas las faenas</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
