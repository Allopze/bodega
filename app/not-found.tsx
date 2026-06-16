import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { BrandMark } from "@/components/layout/brand-mark"

export const metadata: Metadata = { title: "Página no encontrada" }

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] grid place-items-center bg-[var(--color-bg)] px-6 py-12">
      <main className="w-full max-w-md">
        <BrandMark variant="light" size={36} subtitle titleSize="base" />

        <p className="mt-10 font-mono text-xs uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">Error 404</p>
        <h1 className="mt-1 text-h1 text-[var(--color-text)]">Página no encontrada</h1>
        <p className="mt-2 text-sub">
          La dirección que ingresaste no existe o ya no está disponible. Vuelve al inicio de sesión para continuar.
        </p>

        <Link
          href="/login"
          data-pressable
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-[var(--radius-full)] bg-[var(--color-primary)] px-5 text-sm font-medium text-white transition-[background-color,transform] duration-[var(--duration-fast)] hover:bg-[var(--color-primary-strong)] active:scale-[0.98]"
        >
          Ir a iniciar sesión
          <ArrowRight size={15} />
        </Link>
      </main>
    </div>
  )
}
