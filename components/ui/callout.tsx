import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Aviso contextual dentro del contenido de una página (warning/danger/success/info).
 *
 * Reemplaza el patrón copiado a mano en ~50 archivos:
 * `rounded-* border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3 text-sm text-[var(--color-warning-ink)]`,
 * que había acumulado tres defectos entre copias: bordes `warning` (fallan sobre
 * tints claros) en vez de `warning-line`, radios inconsistentes (md→2xl) y
 * `role` ausente o incorrecto.
 *
 * Los tokens `-ink` son obligatorios para el texto: los tokens base miden
 * 2.3–2.7:1 sobre fondo claro y fallan WCAG AA (regla 8 del estándar visual).
 *
 * Componente de servidor: no usa hooks ni eventos.
 */
export type CalloutTone = "warning" | "danger" | "success" | "info"

const TONE_CLASS: Record<CalloutTone, string> = {
  warning: "border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] text-[var(--color-warning-ink)]",
  danger: "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]",
  success: "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success-ink)]",
  info: "border-[var(--color-info-line)] bg-[var(--color-info-tint)] text-[var(--color-info-ink)]",
}

interface CalloutProps {
  /** Tono semántico. `warning` por defecto: es el aviso más común del dominio. */
  tone?: CalloutTone
  /** `status` (default) para avisos pasivos; `alert` para lo que exige acción; `none` para containers presentacionales. */
  role?: "status" | "alert" | "none"
  /** Ícono decorativo (se oculta a lectores); el tono ya comunica semántica. */
  icon?: React.ReactNode
  /** Encabezado corto en negrita; el detalle va en `children`. */
  title?: React.ReactNode
  children?: React.ReactNode
  className?: string
  /** Ancla para navegación interna (`#brechas`, `#bloqueos`). */
  id?: string
}

export function Callout({ tone = "warning", role = "status", icon, title, children, className, id }: CalloutProps) {
  const body = (
    <>
      {title != null && <p className="font-semibold">{title}</p>}
      {children != null && (title != null ? <div className="mt-1">{children}</div> : children)}
    </>
  )
  return (
    <div
      id={id}
      role={role === "none" ? undefined : role}
      className={cn("rounded-[var(--radius-lg)] border p-3 text-sm", TONE_CLASS[tone], className)}
    >
      {icon ? (
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0 flex-1">{body}</div>
        </div>
      ) : (
        body
      )}
    </div>
  )
}
