import type { Metadata } from "next"
import Image from "next/image"
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
      {/* ── Brand hero — B1 Ultra Minimal ── */}
      <aside
        className="hidden lg:flex lg:flex-col justify-between relative overflow-hidden"
        style={{
          background:
            "radial-gradient(120% 90% at 80% 8%, var(--color-primary) 0%, var(--color-text) 70%)",
        }}
      >
        {/* Capa 1 — textura de puntos */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,.10) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
            opacity: 0.5,
          }}
        />

        {/* Capa 2 — marca de agua: logo gigante tenue */}
        <Image
          src="/chome_logo_white.svg"
          alt=""
          aria-hidden
          width={420}
          height={420}
          unoptimized
          style={{ width: 420, height: 420 }}
          className="pointer-events-none absolute -right-16 -bottom-20 opacity-[0.055] z-0 select-none"
        />

        {/* Zona superior — wordmark */}
        <div className="relative z-10 px-12 pt-12">
          <div className="flex items-center gap-3">
            <Image
              src="/chome_logo_white.svg"
              alt="Servicios Chome"
              width={96}
              height={96}
              unoptimized
              loading="eager"
              style={{ width: 96, height: 96 }}
              className="shrink-0"
            />
            <div>
              <p className="font-sans font-semibold text-2xl leading-tight tracking-tight text-white">
                Servicios Chome
              </p>
              <p className="text-xs font-mono uppercase tracking-wider text-white/45 leading-tight mt-0.5">
                Solicitudes y Bodega
              </p>
            </div>
          </div>
        </div>

        {/* Zona inferior — solo eyebrow */}
        <div className="relative z-10 px-12 pb-12">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
            Solicitudes y Bodega
          </p>
        </div>
      </aside>

      {/* ── Login form (right) — lienzo gris + card flotante ── */}
      <main className="flex items-center justify-center px-6 py-12 lg:px-16 bg-[var(--color-bg)]">
        <div className="w-full max-w-[26rem] rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] border border-[var(--color-border)] p-8">
          {/* Mobile brand — solo visible sin el hero */}
          <div className="mb-8 lg:hidden">
            <BrandMark variant="light" size={48} subtitle titleSize="base" />
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
      </main>
    </div>
  )
}
