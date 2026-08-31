"use client"

import type { CSSProperties } from "react"
import { CheckCircle, Info, Warning, WarningCircle, X } from "@phosphor-icons/react"
import { Toaster, type ToasterProps } from "sonner"

interface AppToasterProps {
  position?: ToasterProps["position"]
}

/**
 * Configuración visual única para todas las notificaciones de la plataforma.
 *
 * Sonner posiciona su cierre por defecto fuera del borde superior izquierdo.
 * Aquí la X queda dentro de la superficie, el texto no transforma el toast en
 * un modal accidental y los mismos estados se ven igual en layouts públicos y
 * autenticados.
 */
export function AppToaster({ position = "top-right" }: AppToasterProps) {
  return (
    <Toaster
      position={position}
      visibleToasts={4}
      expand
      closeButton
      offset={16}
      mobileOffset={12}
      gap={8}
      containerAriaLabel="Notificaciones"
      style={{ "--width": "min(400px, calc(100vw - 24px))" } as CSSProperties}
      icons={{
        success: <CheckCircle aria-hidden size={18} weight="fill" className="text-[var(--color-success)]" />,
        error: <WarningCircle aria-hidden size={18} weight="fill" className="text-[var(--color-danger)]" />,
        info: <Info aria-hidden size={18} weight="fill" className="text-[var(--color-info)]" />,
        warning: <Warning aria-hidden size={18} weight="fill" className="text-[var(--color-warning-ink)]" />,
        close: <X aria-hidden size={14} weight="bold" />,
      }}
      toastOptions={{
        duration: 4000,
        closeButtonAriaLabel: "Cerrar notificación",
        classNames: {
          toast:
            "!max-h-32 !items-start !gap-3 !overflow-hidden !rounded-[var(--radius-lg)] " +
            "!border-[var(--color-border)] !bg-[var(--color-surface)] !px-4 !py-3.5 !pr-12 " +
            "font-sans text-sm text-[var(--color-text)] shadow-[var(--shadow-md)] " +
            "data-[swipe=end]:opacity-0 data-[swipe=end]:translate-x-full " +
            "!transition-all !duration-[var(--duration-default)] !ease-[var(--ease-out)]",
          content: "min-w-0 flex-1 gap-1 overflow-hidden",
          icon: "!mt-0.5 !ml-0 !mr-0 !h-5 !w-5 !shrink-0 !self-start !justify-center",
          title: "line-clamp-3 break-words text-sm font-medium leading-5 text-[var(--color-text)]",
          description: "line-clamp-3 break-words text-xs leading-4 text-[var(--color-text-muted)]",
          closeButton:
            "!left-auto !right-1 !top-1 !h-11 !w-11 !transform-none !rounded-[var(--radius-md)] " +
            "!border-0 !bg-transparent !text-[var(--color-text-muted)] hover:!bg-[var(--color-surface-2)] " +
            "hover:!text-[var(--color-text)] focus-visible:!outline-2 focus-visible:!outline-offset-1 " +
            "focus-visible:!outline-[var(--color-primary)] sm:!right-2 sm:!top-2 sm:!h-7 sm:!w-7",
        },
      }}
    />
  )
}
