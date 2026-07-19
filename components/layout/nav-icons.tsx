import type * as React from "react"
import type { IconWeight } from "@phosphor-icons/react"
import {
  Books,
  Certificate,
  ChatsCircle,
  FolderOpen,
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Drop,
  Fire,
  Heartbeat,
  MagnifyingGlass,
  Siren,
  ShieldWarning,
  Scales,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck, ArrowSquareOut,
  ChartLineUp, ChartBar, Package, Path, User, Stack, GearSix,
  UsersThree,
  WarningDiamond,
  Wrench, Toolbox, HardHat, Lifebuoy, ChatCircleText, GasPump, Car, Upload, QrCode,
} from "@phosphor-icons/react"

export type IconCmp = React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>

/** Mapa único de iconos para áreas e ítems de navegación (rail, panel, móvil, ⌘K). */
export const NAV_ICONS: Record<string, IconCmp> = {
  Books,
  Certificate,
  ChatsCircle,
  FolderOpen,
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Drop,
  Fire,
  Heartbeat,
  MagnifyingGlass,
  Siren,
  ShieldWarning,
  Scales,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck, ArrowSquareOut,
  ChartLineUp, ChartBar, Package, Path, User, Stack, GearSix,
  UsersThree,
  WarningDiamond,
  Wrench, Toolbox, HardHat, Lifebuoy, ChatCircleText, GasPump, Car, Upload, QrCode,
}

export function navIcon(name: string): IconCmp | undefined {
  return NAV_ICONS[name]
}
