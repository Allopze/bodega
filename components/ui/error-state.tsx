"use client"

import * as React from "react"
import { Warning, ArrowCounterClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ErrorStateProps {
  title?:        string
  description?:  string
  cause?:        string
  icon?:         React.ReactNode
  action?:       React.ReactNode
  onRetry?:      () => void
  className?:    string
  compact?:      boolean
}

export function ErrorState({
  title = "Error al cargar",
  description = "No se pudo obtener la información. Revisa la conexión y vuelve a intentar.",
  cause,
  icon,
  action,
  onRetry,
  className,
  compact = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        "animate-in fade-in slide-in-from-bottom-3 duration-[var(--duration-default)] ease-[var(--ease-out)]",
        compact ? "py-10 px-4" : "py-16 px-8",
        className,
      )}
    >
      {icon ?? (
        <div className={cn(
          "flex items-center justify-center rounded-xl",
          "bg-[var(--color-danger-tint)] text-[var(--color-danger)]",
          compact ? "h-11 w-11 mb-3" : "h-14 w-14 mb-4",
        )}>
          <Warning size={compact ? 22 : 24} weight="fill" />
        </div>
      )}
      <p className={cn(
        "font-sans font-semibold text-[var(--color-text)]",
        compact ? "text-sm" : "text-base",
      )}>
        {title}
      </p>
      <p className={cn(
        "mt-1 text-[var(--color-text-subtle)] max-w-[48ch]",
        compact ? "text-xs" : "text-sm",
      )}>
        {description}
      </p>
      {cause && (
        <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-3 py-2 text-xs font-mono text-[var(--color-text-muted)] max-w-[64ch] break-all">
          {cause}
        </p>
      )}
      {onRetry && !action && (
        <div className="mt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
          >
            <ArrowCounterClockwise size={14} />
            Reintentar
          </Button>
        </div>
      )}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  )
}
