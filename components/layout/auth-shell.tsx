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
        /* La alineación sigue a la variante, no al gusto. Con hero, la columna
           ya tiene un eje izquierdo propio (título, labels, campos) y centrar
           el footer lo rompe; la regla tampoco separa nada, porque el panel de
           marca es lo que delimita la región del formulario. Sin hero, el
           footer es un único enlace de vuelta bajo un bloque centrado dentro de
           la tarjeta, y ahí la regla sí marca dónde termina el formulario. */
        <div
          className={
            hero
              ? "mt-8 text-xs text-text-subtle space-y-2"
              : "mt-6 pt-5 border-t border-border text-center text-xs text-text-subtle space-y-2"
          }
        >
          {footer}
        </div>
      )}
    </>
  )

  if (hero) {
    return (
      /* Mitades iguales, cada una centrando su contenido. Antes era `2fr_3fr`
         con el formulario anclado a la costura (`lg:justify-start`): a 1920px
         el panel blanco crecía hasta dejar ~730px de vacío a su derecha, y la
         composición se leía sin terminar. Anclarlo y encoger el panel sólo
         movía el desequilibrio al otro lado (el hero se comía el 70%). Con
         50/50 y ambos contenidos centrados el margen del formulario queda
         simétrico (~300px por lado a 1920, ~80px a 1024) y ninguna mitad
         domina. */
      <div className="auth-grid min-h-[100dvh] grid lg:grid-cols-2">
        {hero}

        <main className="flex items-center justify-center px-6 py-12 lg:px-16 bg-[var(--color-surface)]">
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
