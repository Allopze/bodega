"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CaretDown } from "@phosphor-icons/react"
import { useWorksiteFilterPresence } from "@/components/layout/header-context"
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
 * - «(actual)» se decide por FAENA, no por MIPER, y se muestra SIN período: la
 *   lista trae la MIPER principal de cada faena, que no es la que se mira si se
 *   está en la vigente 2026 con un borrador 2027 («Planta · 2027 (actual)»
 *   nombraba un período que no era el de la pantalla).
 * - Declara la presencia del selector para que el TopBar oculte «Tu faena»: en
 *   una MIPER de Biodiversa, «Tu faena: Oficina Central» junto a «Cambiar de
 *   faena» se leía como la faena de la pantalla (auditoría UI 2026-10-04, n.º 1).
 */
export function WorksiteSwitcher({ currentWorksiteId }: { currentWorksiteId: string }) {
  useWorksiteFilterPresence()
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
        {/* Bajo xl se lee «Faena»: con el título y cinco botones la cabecera truncaba el
            nombre del documento a 1024 px. El nombre accesible sigue completo. */}
        <Button variant="secondary" aria-label="Cambiar de faena"><span className="xl:hidden">Faena</span><span className="hidden xl:inline">Cambiar de faena</span><CaretDown aria-hidden className="ml-1 size-3.5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel>Faenas a tu alcance</DropdownMenuLabel>
        {operation.pending && <DropdownMenuItem disabled>Cargando faenas…</DropdownMenuItem>}
        {!operation.pending && operation.message && (
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); load() }}>{operation.message} Reintentar</DropdownMenuItem>
        )}
        {targets?.map((target) => (target.worksiteId === currentWorksiteId ? (
          <DropdownMenuItem key={target.worksiteId} disabled>{target.worksiteName} (actual)</DropdownMenuItem>
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
