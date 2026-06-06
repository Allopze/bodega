import type { Metadata } from "next"
import { Suspense } from "react"
import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "Iniciar sesión",
}

export default function LoginPage() {
  return (
    <div className="min-h-[100dvh] flex items-stretch">
      {/* ── Brand panel (dark forest — brand moment) ── */}
      <div className={[
        "hidden lg:flex lg:w-96 lg:shrink-0 lg:flex-col",
        "bg-[var(--color-brand-surface)]",
        "px-10 py-12",
        "justify-between",
      ].join(" ")}>
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-[var(--radius)] bg-[var(--color-primary)] flex items-center justify-center">
            <span className="font-display font-bold text-white text-base leading-none">SF</span>
          </div>
          <div>
            <p className="font-display font-bold text-[var(--color-brand-text)] text-lg leading-tight">StockFlow</p>
            <p className="text-xs text-[var(--color-brand-text-muted)]">Chome</p>
          </div>
        </div>

        {/* Tagline */}
        <div>
          <p className="font-display text-2xl font-semibold text-[var(--color-brand-text)] leading-snug">
            Control total del abastecimiento
          </p>
          <p className="mt-3 text-sm text-[var(--color-brand-text-muted)] leading-relaxed max-w-[32ch]">
            Desde la solicitud de faena hasta la factura conciliada — sin perder un solo ítem.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[
              { n: "100%",  label: "Trazabilidad" },
              { n: "0",     label: "Ítems perdidos" },
              { n: "Nivel 1", label: "Bodega activa" },
            ].map(({ n, label }) => (
              <div key={label} className="rounded-[var(--radius)] bg-[var(--color-brand-surface-raised)] p-3">
                <p className="font-mono font-semibold text-[var(--color-brand-text)] text-base leading-none">{n}</p>
                <p className="mt-1 text-[10px] text-[var(--color-brand-text-muted)]">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-[10px] text-[var(--color-brand-text-muted)]">
          Sistema interno Chome — uso exclusivo del personal autorizado.
        </p>
      </div>

      {/* ── Login form (light panel) ── */}
      <div className="flex flex-1 items-center justify-center px-6 py-12 bg-[var(--color-bg)]">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--color-primary)] flex items-center justify-center">
              <span className="font-display font-bold text-white text-sm">SF</span>
            </div>
            <p className="font-display font-bold text-[var(--color-text)] text-base">StockFlow — Chome</p>
          </div>

          <h1 className="font-display text-xl font-semibold text-[var(--color-text)] mb-1">
            Iniciar sesión
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mb-6">
            Ingresa con tus credenciales de acceso.
          </p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
