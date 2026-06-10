import type { Metadata } from "next"
import { Suspense } from "react"
import { BrandMark } from "@/components/layout/brand-mark"
import { getUserCount } from "@/lib/auth/bootstrap"
import { LoginForm } from "./login-form"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Iniciar sesión",
}

export default async function LoginPage() {
  const userCount = await getUserCount()

  return (
    <div className="min-h-[100dvh] flex items-stretch">
      {/* ── Brand panel (dark forest — brand moment) ── */}
      <div
        className="hidden lg:flex lg:w-115 lg:shrink-0 lg:flex-col px-10 py-12 justify-between"
        style={{ background: "radial-gradient(ellipse 60% 50% at 20% 10%, oklch(0.280 0.055 155), oklch(0.216 0.045 155))" }}
      >
        {/* Logo */}
        <BrandMark variant="dark" size={52} subtitle titleSize="lg" />

        {/* Tagline */}
        <div>
          <p className="font-display text-3xl font-semibold text-(--color-brand-text)">
            Control total del abastecimiento
          </p>
          <p className="mt-3 text-sm text-brand-text-muted leading-relaxed max-w-[32ch]">
            Desde la solicitud de faena hasta la factura conciliada, sin perder un solo ítem.
          </p>
          <ul className="mt-6 flex flex-col gap-3">
            {[
              "Trazabilidad del 100% de los ítems",
              "Sin pérdidas desde despacho hasta bodega",
              "Bodega activa Nivel 1 con OC y conciliación",
            ].map((text) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-brand-text-muted">
                <span className="mt-[0.35rem] w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <p className="text-[10px] text-brand-text-muted">
          Sistema interno Chome — uso exclusivo del personal autorizado.
        </p>
      </div>

      {/* ── Login form (light panel) ── */}
      <div className="flex flex-1 items-center justify-center px-8 py-16 bg-white">
        <div className="w-full max-w-sm bg-surface border border-border rounded-(--radius-xl) shadow-(--shadow-md) px-8 py-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Mobile logo */}
          <div className="mb-8 lg:hidden">
            <BrandMark variant="light" size={44} subtitle="Chome Solicitudes y Bodega" titleSize="lg" />
          </div>

          <h1 className="font-display text-2xl font-semibold text-text mb-6">
            Iniciar sesión
          </h1>
          <Suspense fallback={null}>
            <LoginForm showBootstrap={userCount === 0} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
