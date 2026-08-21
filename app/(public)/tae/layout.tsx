import type { Metadata } from "next"
import { TaePwaRegister } from "@/components/pwa/tae-pwa-register"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const metadata: Metadata = {
  title: "Control TAE",
  description: "Registro operativo de cargas TAE de Copec, incluso sin conexión.",
  manifest: "/tae-manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Control TAE" },
}

export default async function TaeLayout({ children }: { children: React.ReactNode }) {
  const enabled = await isRouteOperational("/combustibles/tae")
  if (!enabled) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">Control TAE no disponible</h1>
          <p className="mt-2 text-sm text-slate-600">El registro de cargas fue desactivado temporalmente. Contacta al administrador antes de continuar.</p>
        </section>
      </main>
    )
  }
  return <><TaePwaRegister />{children}</>
}
