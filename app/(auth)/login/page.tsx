import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { Suspense } from "react"
import { AuthShell } from "@/components/layout/auth-shell"
import { BRAND_TITLE } from "@/components/layout/brand-mark"
import { getUserCount } from "@/lib/auth/bootstrap"
import { LoginForm } from "./login-form"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Iniciar sesión",
}

export default async function LoginPage() {
  const userCount = await getUserCount()

  const hero = (
    <aside
      className="hidden lg:flex lg:flex-col lg:items-center lg:justify-center relative overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 90% at 80% 8%, var(--color-primary) 0%, var(--color-text) 70%)",
      }}
    >
      <div className="relative flex flex-col items-center gap-6">
        {/* El logo raster es el estado final; el SVG dibuja el marco encima al
            cargar y reacciona al estado del form vía `data-auth-state` (ver
            login-form.tsx) — sin JS nuevo, el <aside> sigue siendo servidor. */}
        <div className="relative h-[200px] w-[200px]">
          <Image
            src="/chome_logo_white.svg"
            alt=""
            aria-hidden
            width={200}
            height={200}
            unoptimized
            loading="eager"
            style={{ width: 200, height: 200 }}
            className="auth-hero-logo"
          />
          <svg
            aria-hidden
            viewBox="0 0 201.36 201.36"
            className="auth-hero-octagon pointer-events-none absolute inset-0 h-full w-full select-none"
          >
            {/* Sin `non-scaling-stroke`: el grosor debe escalar con el viewBox
                igual que el marco del propio logo, o los dos dejan de
                coincidir si el hero cambia de tamaño. */}
            <path
              className="auth-hero-frame"
              pathLength={100}
              d="M 64.89 13.2 L 136.47 13.2 L 188.16 64.89 L 188.16 136.47 L 136.47 188.16 L 64.89 188.16 L 13.2 136.47 L 13.2 64.89 Z"
            />
            <path
              className="auth-hero-tracer"
              pathLength={100}
              d="M 64.89 13.2 L 136.47 13.2 L 188.16 64.89 L 188.16 136.47 L 136.47 188.16 L 64.89 188.16 L 13.2 136.47 L 13.2 64.89 Z"
            />
          </svg>
        </div>

        <p className="auth-hero-wordmark font-sans font-semibold text-2xl leading-tight tracking-tight text-white">
          {BRAND_TITLE}
        </p>
      </div>
    </aside>
  )

  const footer = (
    <>
      <p>Acceso solo para personal de Chome. Contacta al administrador si no tienes acceso.</p>
      {userCount === 0 && (
        <p>
          Sin usuarios todavía.{" "}
          <Link href="/registro" className="font-medium text-[var(--color-primary)] hover:underline">
            Crear primer administrador
          </Link>
        </p>
      )}
    </>
  )

  // Sin `subtitle`: decía "Usa tu correo @chome.cl.", que es exactamente lo que
  // ya dice el placeholder del campo en el momento en que importa, y el footer
  // lo repite una tercera vez.
  return (
    <AuthShell title="Ingresar" hero={hero} footer={footer}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
