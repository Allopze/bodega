import type { ReactNode } from "react"
import { IconAlert } from "./icons"

/** Error de campo: ícono + texto (nunca sólo color) y `role="alert"` para que se lea al aparecer. */
export function FieldError({ message, id }: { message?: string | undefined; id?: string }) {
  if (!message) return null
  return (
    <div className="err" role="alert" id={id}>
      <IconAlert />
      <span>{message}</span>
    </div>
  )
}

/** Rótulo de un campo, con su aclaración en gris. */
export function Label({ htmlFor, children, hint, size }: { htmlFor?: string; children: ReactNode; hint?: string; size?: "sm" }) {
  return (
    <label className={size === "sm" ? "lbl lbl-sm" : "lbl"} htmlFor={htmlFor}>
      {children}
      {hint ? <small> · {hint}</small> : null}
    </label>
  )
}

/** Aviso en una franja: ámbar para lo que pide atención, verde para lo resuelto. */
export function Banner({ tone = "warn", children, action }: { tone?: "warn" | "ok"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={tone === "ok" ? "banner okb" : "banner"}>
      <div className="banner-text">{children}</div>
      {action}
    </div>
  )
}

/** Casilla visible de selección múltiple (el estado se dice con `aria-pressed`, no sólo con el color). */
export function CheckBox({ on }: { on: boolean }) {
  return (
    <span className="bx" aria-hidden="true">
      {on ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      ) : null}
    </span>
  )
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}
