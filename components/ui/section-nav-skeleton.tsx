import { cn } from "@/lib/utils"
import { Skeleton } from "./skeleton"

/**
 * Anchos de las etiquetas fantasma. Varían para que la barra no se lea como una
 * regla gris; el ancho real de cada pestaña no importa, la altura sí.
 */
const LABEL_WIDTHS = ["w-24", "w-32", "w-20", "w-28", "w-16", "w-24"] as const

/**
 * Esqueleto de `SectionNav` para los `loading.tsx` de las pantallas que la
 * pintan. Sin él, la barra aparece al resolverse la página y empuja todo lo de
 * abajo 64 px (44 de barra + 20 de margen): el contenido que el usuario ya
 * estaba leyendo salta.
 *
 * Replica a propósito las clases de caja de `section-nav.tsx` (`-mx-4 mb-5
 * border-b px-4`, `min-h-11`, `border-b-2`, `-mb-px`): si allá cambia la
 * geometría, esto debe cambiar igual. `section-nav-skeleton.test.tsx` fija el
 * contrato de altura.
 *
 * Es un componente de servidor y es decorativo (`aria-hidden`): no declara un
 * `<nav>` vacío que los lectores de pantalla anunciarían como un hito sin
 * destinos. Va donde iría la barra: justo después del `PageHeader`.
 *
 * `tabs` es la cantidad de pestañas de la sección (consumo 6, TAE 4, revisión y
 * facturas 2); sólo afecta cuántos huecos se dibujan, no la altura.
 */
export function SectionNavSkeleton({ tabs = 4 }: { tabs?: number }) {
  return (
    <div
      aria-hidden="true"
      data-testid="section-nav-skeleton"
      className="-mx-4 mb-5 overflow-x-auto border-b border-[var(--color-border)] px-4 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-max gap-1">
        {Array.from({ length: tabs }, (_, index) => (
          <li key={index}>
            <div className="-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm">
              <Skeleton className={cn("h-4", LABEL_WIDTHS[index % LABEL_WIDTHS.length])} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
