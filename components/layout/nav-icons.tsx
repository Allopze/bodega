import type * as React from "react"
import type { IconWeight } from "@phosphor-icons/react"
import {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck, ArrowSquareOut,
  ChartLineUp, ChartBar, Package, Path, User, Stack, GearSix,
  Wrench, Toolbox, HardHat, Lifebuoy, ChatCircleText, GasPump,
} from "@phosphor-icons/react"

export type IconCmp = React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>

/** Mapa único de iconos para áreas e ítems de navegación (rail, panel, móvil, ⌘K). */
export const NAV_ICONS: Record<string, IconCmp> = {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck, ArrowSquareOut,
  ChartLineUp, ChartBar, Package, Path, User, Stack, GearSix,
  Wrench, Toolbox, HardHat, Lifebuoy, ChatCircleText, GasPump,
}

export function navIcon(name: string): IconCmp | undefined {
  return NAV_ICONS[name]
}
