import Link from "next/link"
import { Truck } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import type { PanelData } from "@/lib/services/mantencion/panel"

/**
 * Sin equipos en el alcance, el panel entero está vacío por UNA causa: tiles en
 * cero, una tira de ceros y cinco tarjetas vacías eran siete avisos para un solo
 * problema (auditoría UX-13, 2026-11-07). La causa raíz sale de lo que la página
 * ya cargó: ningún equipo activo, ningún registro en el período y ningún equipo
 * detenido. Con registros o equipos en taller el panel sigue siendo útil aunque la
 * flota activa sea cero (por ejemplo, equipos dados de baja con historial).
 */
export function hasNoEquipmentInScope(data: PanelData): boolean {
  return data.fleet.active === 0 && data.records.total === 0 && data.workshop.rows.length === 0
}

/**
 * Un solo estado vacío en lugar del panel. Los filtros de período y faena quedan
 * arriba (los pone la página): otra faena puede tener equipos.
 *
 * `canManage` (`mant:equipment:manage`) decide si la frase manda a agregar los
 * equipos o a pedirlo; el enlace a Equipos sirve a cualquiera que vea el panel
 * (la lista pide los mismos permisos de lectura).
 */
export function PanelEmptyState({ canManage }: { canManage: boolean }) {
  return (
    <EmptyState
      icon={<Truck size={24} aria-hidden />}
      title="Todavía no hay equipos en mantención para estas faenas"
      description={canManage
        ? "Agrega o importa los equipos desde Equipos: con ellos el panel mostrará cuáles necesitan mantención, qué está en taller y cuánto se ha registrado."
        : "Cuando se agreguen los equipos, el panel mostrará cuáles necesitan mantención, qué está en taller y cuánto se ha registrado. Pide a quien administra la mantención que los agregue."}
      action={<Button asChild><Link href="/mantencion/equipos">Ir a Equipos</Link></Button>}
    />
  )
}
