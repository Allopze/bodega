"use client"

import Image from "next/image"

/* ── BrandMark ─────────────────────────────────────────────────────────────
   Muestra el logo de Chome + el nombre + subtítulo opcional.

   variant "dark"  → logo blanco, texto claro  (fondos oscuros: sidebar, login-desktop)
   variant "light" → logo verde,  texto oscuro (fondos claros: login-móvil, registro)
   ─────────────────────────────────────────────────────────────────────── */

interface BrandMarkProps {
  /** "dark" para fondos oscuros (brand-surface), "light" para fondos claros */
  variant?: "dark" | "light"
  /** Tamaño del logo en px (ancho y alto). Default 32. */
  size?: number
  /**
   * Muestra el subtítulo "Solicitudes y Bodega".
   * - `true`   → texto en dos líneas (Chome / Solicitudes y Bodega)
   * - `string` → texto en una sola línea junto al título
   * - `false`  → solo muestra "Chome"
   */
  subtitle?: boolean | string
  /** Override del tamaño del título. Default "sm". */
  titleSize?: "sm" | "base" | "lg"
}

const LOGO_SRC = {
  dark:  "/chome_logo_white.svg",
  light: "/chome_logo.svg",
} as const

const TITLE_CLASSES = {
  sm:   "text-sm",
  base: "text-base",
  lg:   "text-lg",
} as const

export function BrandMark({
  variant    = "dark",
  size       = 32,
  subtitle   = false,
  titleSize  = "sm",
}: BrandMarkProps) {
  const isDark      = variant === "dark"
  const titleColor  = isDark ? "text-[var(--color-brand-text)]"       : "text-[var(--color-text)]"
  const subtitleColor = isDark ? "text-[var(--color-brand-text-muted)]" : "text-[var(--color-text-muted)]"

  /* subtitle como string → se muestra inline junto al título en una sola línea */
  const inlineSubtitle = typeof subtitle === "string"

  return (
    <div className="flex items-center gap-2.5">
      <Image
        src={LOGO_SRC[variant]}
        alt="Chome"
        width={size}
        height={size}
        unoptimized
        className="shrink-0"
        style={{ width: size, height: size }}
      />
      <div>
        {inlineSubtitle ? (
          <p className={`font-display font-bold ${titleColor} ${TITLE_CLASSES[titleSize]} leading-tight tracking-tight`}>
            {subtitle}
          </p>
        ) : (
          <>
            <p className={`font-display font-bold ${titleColor} ${TITLE_CLASSES[titleSize]} leading-tight tracking-tight`}>
              Chome
            </p>
            {subtitle === true && (
              <p className={`text-[10px] ${subtitleColor} leading-tight`}>
                Solicitudes y Bodega
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
