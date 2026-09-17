"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { CaretRight } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

/**
 * Wrapper around Radix Trigger that adds suppressHydrationWarning.
 * Needed because DropdownMenuTrigger asChild + Button creates a Slot/SlotClone
 * chain that produces slightly different HTML during SSR vs CSR (Radix merges
 * child attrs at runtime). Without this, Next.js reports a hydration mismatch
 * on every DropdownMenu whose trigger wraps a <Button>.
 */
const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ ...props }, ref) => (
  <DropdownMenuPrimitive.Trigger ref={ref} suppressHydrationWarning {...props} />
))
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName

const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[14rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-[var(--color-text)] shadow-[var(--shadow-md)]",
        // Emil: origin-aware — scale from trigger, not center
        "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        // Menús pequeños merecen 180ms, no 140ms: la curva ease-out de la
        // cabecera global termina antes que el ojo rastree el contenido,
        // y la siguiente interacción (hover sobre un ítem) llega con
        // el menú todavía "apareciendo".
        "duration-[var(--duration-default)] ease-[var(--ease-out)]",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-[var(--radius-lg)] px-2.5 py-2 text-sm outline-none transition-colors",
      "focus:bg-[var(--color-surface-2)] focus:text-[var(--color-text)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

/**
 * Disparador de un submenú (ej. un preset que necesita parámetros antes de
 * poder aplicarse): mismo trato visual que `DropdownMenuItem`, con la flecha
 * que indica que abre contenido adicional en vez de ejecutar la acción.
 */
const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center justify-between gap-2 rounded-[var(--radius-lg)] px-2.5 py-2 text-sm outline-none transition-colors",
      "focus:bg-[var(--color-surface-2)] focus:text-[var(--color-text)]",
      "data-[state=open]:bg-[var(--color-surface-2)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <CaretRight aria-hidden size={12} className="shrink-0 text-[var(--color-text-faint)]" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

/**
 * Contenido de un submenú: pensado tanto para una lista de ítems como para un
 * mini-formulario (inputs + botón "Aplicar") cuando el preset necesita
 * parámetros — a diferencia de `DropdownMenuItem`, el contenido no está
 * limitado a `role="menuitem"`, así que un `<input>` dentro no dispara el
 * cierre del menú ni el typeahead de Radix.
 */
const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[16rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[var(--color-text)] shadow-[var(--shadow-md)]",
      "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
      "duration-[var(--duration-default)] ease-[var(--ease-out)]",
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-muted)]",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1.5 my-1.5 h-px bg-[var(--color-border)]", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuRadioGroup,
}
