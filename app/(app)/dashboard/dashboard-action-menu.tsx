"use client"

import Link from "next/link"
import {
  CaretDown,
  ChartBar,
  CheckSquare,
  ClipboardText,
  Package,
  ShoppingCart,
  Truck,
  Warehouse,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Action = { key: string; label: string; href: string }

const ACTION_ICONS = {
  "new-request": ClipboardText,
  approvals: CheckSquare,
  "new-oc": ShoppingCart,
  receiving: Truck,
  delivery: Warehouse,
  warehouse: Package,
  reports: ChartBar,
} as const

/** Menú cliente aislado: recibe sólo destinos ya filtrados por permisos. */
export function DashboardActionMenu({ secondary, actions }: { secondary?: Action; actions: Action[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label="Más acciones">
          Más acciones
          <CaretDown size={14} weight="bold" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {secondary && <ActionItem action={secondary} className="sm:hidden" />}
        {actions.map((action) => <ActionItem key={action.key} action={action} />)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ActionItem({ action, className }: { action: Action; className?: string }) {
  const Icon = ACTION_ICONS[action.key as keyof typeof ACTION_ICONS] ?? ClipboardText
  return (
    <DropdownMenuItem asChild className={className}>
      <Link href={action.href} className="gap-2">
        <Icon size={15} />
        {action.label}
      </Link>
    </DropdownMenuItem>
  )
}
