import { SegmentedControl } from "@/components/ui/segmented-control"

export const SHIFT_VIEWS = [
  { key: "dia", label: "Día" },
  { key: "operadores", label: "Operadores" },
  { key: "equipos", label: "Equipos" },
] as const
export type ShiftView = (typeof SHIFT_VIEWS)[number]["key"]

export function isShiftView(value: unknown): value is ShiftView {
  return SHIFT_VIEWS.some((view) => view.key === value)
}

/**
 * Selector de vista (`?vista=`). Es un `SegmentedControl` con `href`: cambia sólo la query de la misma página,
 * así que navega con `replace` y sin mover el scroll. Conserva el resto de los parámetros (día, período,
 * equipo); la vista por defecto, «Día», no viaja en la URL.
 */
export function ShiftViewsTabs({ current, params }: { current: ShiftView; params: Record<string, string> }) {
  const hrefFor = (view: ShiftView) => {
    const next = new URLSearchParams(params)
    if (view === "dia") next.delete("vista")
    else next.set("vista", view)
    const query = next.toString()
    return query ? `/flota/turnos?${query}` : "/flota/turnos"
  }
  return (
    <SegmentedControl
      ariaLabel="Vista de turnos y ralentí"
      variant="segmented"
      items={SHIFT_VIEWS.map((view) => ({ key: view.key, label: view.label, active: view.key === current, href: hrefFor(view.key) }))}
    />
  )
}
