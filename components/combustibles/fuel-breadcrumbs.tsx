import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/page-header"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Migas de Combustible: «Control operacional › Combustible › …». Sin `items`, es el Panel. */
export function FuelBreadcrumbs({ items = [] }: { items?: BreadcrumbItem[] }) {
  return (
    <Breadcrumbs
      items={[
        { label: "Control operacional", href: "/control-operacional" },
        items.length ? { label: "Combustible", href: FUEL_PATHS.panel } : { label: "Combustible" },
        ...items,
      ]}
    />
  )
}
