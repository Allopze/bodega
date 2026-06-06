import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { Suspense } from "react"
import { getUserCount } from "@/lib/auth/bootstrap"
import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "Iniciar sesión",
}

export default async function LoginPage() {
  const userCount = await getUserCount()

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
          <Image
            src="/chome_logo_white.svg"
            alt="Chome"
            width={36}
            height={36}
            unoptimized
            className="h-9 w-9 shrink-0"
          />
          <div>
            <p className="font-display font-bold text-[var(--color-brand-text)] text-lg leading-tight">Chome</p>
            <p className="text-xs text-[var(--color-brand-text-muted)]">Solicitudes y Bodega</p>
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
            <Image
              src="/chome_logo_white.svg"
              alt="Chome"
              width={32}
              height={32}
              unoptimized
              className="h-8 w-8 shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-brand-surface)] p-0.5"
            />
            <p className="font-display font-bold text-[var(--color-text)] text-base">Chome Solicitudes y Bodega</p>
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
          {userCount === 0 && (
            <p className="mt-4 text-center text-xs text-[var(--color-text-subtle)]">
              Sin usuarios todavía.{" "}
              <Link href="/registro" className="text-[var(--color-primary-700)] hover:underline">
                Crear primer administrador
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
