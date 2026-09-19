import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Un ítem navega (`href`, renderiza `<Link>`) o alterna sin navegar (`onClick`,
 * renderiza `<button aria-pressed>`) — nunca las dos cosas. `aria-current="page"`
 * sólo tiene sentido para el primer caso: es la semántica de "estás en esta
 * página", no la de "este filtro está activo". Mezclarlas en un solo tipo con
 * ambos campos opcionales permitía declarar los dos a la vez sin que nada lo
 * impidiera.
 */
type SegmentedControlItem =
  | {
      key: string
      label: string
      active: boolean
      /** Navigation URL (renders as Link) */
      href: string
      onClick?: never
    }
  | {
      key: string
      label: string
      active: boolean
      /** Alterna sin navegar (renders as button[aria-pressed]) */
      onClick: () => void
      href?: never
    }

interface SegmentedControlProps {
  /** Items to render */
  items: SegmentedControlItem[]
  /** Layout variant: pills = wrap with gap, segmented = inline with shared border */
  variant?: "pills" | "segmented"
  /** Accessible label for the group */
  ariaLabel: string
  /** Optional eyebrow label above the control */
  eyebrow?: string
  className?: string
}

function itemClassName(item: SegmentedControlItem, variant: "pills" | "segmented", i: number, total: number) {
  if (variant === "segmented") {
    return cn(
      "px-4 py-1.5 text-sm transition-colors",
      i === 0 && "rounded-l-md",
      i > 0 && "border-l border-[var(--color-border)]",
      i === total - 1 && "rounded-r-md",
      item.active
        ? "bg-[var(--color-primary-tint)] text-[var(--color-text)] font-medium"
        : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
    )
  }
  return cn(
    "rounded-md border px-3 py-1.5 text-sm transition-colors",
    item.active
      ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
  )
}

function SegmentedControlLink({ item, className }: { item: Extract<SegmentedControlItem, { href: string }>; className: string }) {
  return (
    <Link href={item.href} className={className} aria-current={item.active ? "page" : undefined}>
      {item.label}
    </Link>
  )
}

function SegmentedControlButton({ item, className }: { item: Extract<SegmentedControlItem, { onClick: () => void }>; className: string }) {
  return (
    <button type="button" onClick={item.onClick} className={className} aria-pressed={item.active}>
      {item.label}
    </button>
  )
}

/**
 * Control segmentado reutilizable, en dos modos:
 * - `href`: selector de navegación sincronizado con la URL (el uso original).
 * - `onClick`: alternador de una sola vista, sin navegar — `role="tab"` de
 *   Radix `Tabs` prometía un panel asociado que estos casos nunca tuvieron
 *   (axe `aria-valid-attr-value`); `aria-pressed` no promete nada que no exista.
 *
 * Los cuatro consumidores existentes (todos `href`) quedan byte-idénticos: el
 * modo `onClick` es aditivo.
 */
export function SegmentedControl({
  items,
  variant = "pills",
  ariaLabel,
  eyebrow,
  className,
}: SegmentedControlProps) {
  return (
    <div className={cn("space-y-1", className)}>
      {eyebrow && (
        <p className="text-eyebrow pl-0.5 text-[var(--color-text-faint)]">{eyebrow}</p>
      )}
      <nav aria-label={ariaLabel} role="group">
        <div className={variant === "segmented"
          ? "inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
          : "flex flex-wrap gap-2"}
        >
          {items.map((item, i) => {
            const itemClass = itemClassName(item, variant, i, items.length)
            return item.href !== undefined
              ? <SegmentedControlLink key={item.key} item={item} className={itemClass} />
              : <SegmentedControlButton key={item.key} item={item} className={itemClass} />
          })}
        </div>
      </nav>
    </div>
  )
}
