import Link from "next/link"
import { Truck } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

/** Lo que el Panel ya cargó del alcance elegido. `null` = esa consulta no corrió o falló: no prueba que esté vacío. */
export interface PanelScopeCounts {
  equipment: number | null
  inWorkshop: number | null
  records: number | null
  workOrders: number | null
}

/**
 * Sin equipos en el alcance, el panel entero está vacío por UNA causa: una franja en
 * cero y secciones de gráficos vacías eran varios avisos para un solo problema
 * (auditoría UX-13, 2026-11-07). Sólo cuenta como vacío lo que se pudo consultar: si la
 * flota o los registros fallaron, el aviso de datos degradados lo dice y el panel se
 * dibuja con lo que hay. Con registros, órdenes o equipos en taller el panel sigue siendo
 * útil aunque la flota activa sea cero (por ejemplo, equipos dados de baja con historial).
 */
export function hasNoEquipmentInScope({ equipment, inWorkshop, records, workOrders }: PanelScopeCounts): boolean {
  return equipment === 0 && inWorkshop === 0 && records === 0 && (workOrders === null || workOrders === 0)
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
