import * as React from "react"
import { BrandMark } from "@/components/layout/brand-mark"

/**
 * Shell compartido de las 4 pantallas de `(auth)` (login, recuperar,
 * recuperar/[token], registro). Server Component: ninguna necesita cliente
 * en el chrome, solo en el form.
 *
 * `hero` decide el layout, no es un flag arbitrario: con hero (login), el
 * panel de marca ya separa el formulario del resto y la tarjeta sobra; sin
 * hero (las otras 3), la tarjeta es lo que define la región del formulario
 * sobre el lienzo gris.
 */
interface AuthShellProps {
  title: string
  subtitle?: React.ReactNode
  hero?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}

export function AuthShell({ title, subtitle, hero, children, footer }: AuthShellProps) {
  const body = (
    <>
      <h1 className="text-display text-[var(--color-text)]">{title}</h1>
      {subtitle != null && <p className="mt-2 text-sub">{subtitle}</p>}

      <div className="mt-8">{children}</div>

      {footer != null && (
        <div className="mt-6 pt-5 border-t border-border text-center text-xs text-text-subtle space-y-2">
          {footer}
        </div>
      )}
    </>
  )

  if (hero) {
    return (
      <div className="auth-grid min-h-[100dvh] grid lg:grid-cols-[2fr_3fr]">
        {hero}

        <main className="flex items-center justify-center px-6 py-12 lg:justify-start lg:px-16 bg-[var(--color-surface)]">
          <div className="w-full max-w-[22rem]">
            {/* Sin el hero (bajo `lg`) la marca desaparecería de la pantalla. */}
            <div className="mb-8 lg:hidden">
              <BrandMark variant="light" size={48} subtitle titleSize="base" />
            </div>
            {body}
          </div>
        </main>
      </div>
    )
  }

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-[var(--color-bg)] px-6 py-12">
      <div className="w-full max-w-[26rem] rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-8">
        <div className="mb-8">
          <BrandMark variant="light" size={48} subtitle titleSize="base" />
        </div>
        {body}
      </div>
    </main>
  )
}
