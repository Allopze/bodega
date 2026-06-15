"use client"

import Image from "next/image"

interface BrandMarkProps {
  variant?: "dark" | "light"
  size?: number
  subtitle?: boolean | string
  titleSize?: "sm" | "base" | "lg"
  hideText?: boolean
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
  hideText   = false,
}: BrandMarkProps) {
  const isDark        = variant === "dark"
  const titleColor    = isDark ? "text-[var(--color-brand-text)]"       : "text-[var(--color-text)]"
  const subtitleColor = isDark ? "text-[var(--color-brand-text-muted)]" : "text-[var(--color-text-muted)]"
  const inlineSubtitle = typeof subtitle === "string"

  return (
    <div className="flex items-center gap-2.5">
      <Image
        src={LOGO_SRC[variant]}
        alt="Chome"
        width={size}
        height={size}
        unoptimized
        className="shrink-0 rounded-(--radius-sm)"
        style={{ width: size, height: size }}
      />
      {!hideText && (
        <div>
          {inlineSubtitle ? (
            <p className={`font-sans font-semibold ${titleColor} ${TITLE_CLASSES[titleSize]} leading-tight tracking-tight`}>
              {subtitle}
            </p>
          ) : (
            <>
              <p className={`font-sans font-semibold ${titleColor} ${TITLE_CLASSES[titleSize]} leading-tight tracking-tight`}>
                Chome
              </p>
              {subtitle === true && (
                <p className={`text-[11px] font-mono uppercase tracking-wider ${subtitleColor} leading-tight mt-0.5`}>
                  Solicitudes y Bodega
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
