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
    <div className="min-h-[100dvh] grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ── Brand panel — flat, editorial, single column of evidence ── */}
      <aside className="hidden lg:flex lg:flex-col px-12 py-12 justify-between bg-[var(--color-surface)] border-r border-[var(--color-border)]">
        <BrandMark variant="light" size={48} subtitle titleSize="lg" />

        <div className="max-w-[42ch]">
          <p className="text-eyebrow mb-4">Sistema interno</p>
          <p className="text-display text-[var(--color-text)]">
            Control total del abastecimiento.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-text-muted)] max-w-[40ch]">
            Desde la solicitud de faena hasta la factura conciliada, sin perder un solo ítem.
          </p>

          <dl className="mt-10 grid grid-cols-1 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
            {[
              ["01", "Trazabilidad del 100% de los ítems"],
              ["02", "Sin pérdidas desde despacho hasta bodega"],
              ["03", "Bodega activa Nivel 1 con OC y conciliación"],
            ].map(([n, t]) => (
              <div key={n} className="grid grid-cols-[3rem_1fr] items-center bg-[var(--color-surface)] px-4 py-3">
                <dt className="text-eyebrow font-mono">{n}</dt>
                <dd className="text-sm text-[var(--color-text)]">{t}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
          Uso exclusivo del personal autorizado
        </p>
      </aside>

      {/* ── Login form (right) ── */}
      <div className="flex items-center justify-center px-6 py-16 lg:px-16 bg-[var(--color-bg)]">
        <div className="w-full max-w-[24rem]">
          {/* Mobile brand */}
          <div className="mb-10 lg:hidden">
            <BrandMark variant="light" size={40} subtitle="Chome Solicitudes y Bodega" titleSize="base" />
          </div>

          <p className="text-eyebrow">Acceso</p>
          <h1 className="mt-2 text-display text-[var(--color-text)]">
            Iniciar sesión
          </h1>
          <p className="mt-2 text-sub">Ingresa tus credenciales para continuar.</p>

          <div className="mt-8">
            <Suspense fallback={null}>
              <LoginForm showBootstrap={userCount === 0} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
