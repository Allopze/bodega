import type { Metadata } from "next"
import { PwaRegister } from "@/components/pwa/pwa-register"
import { isRouteOperational } from "@/lib/services/module-toggles"

export const metadata: Metadata = {
  title: "PPA Digital: Para, Piensa y Actúa",
  description: "Evaluación preventiva antes de iniciar el trabajo. Funciona sin conexión a internet.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PPA Digital",
  },
}

// El service worker se registra una sola vez, desde PublicLayout (padre de
// esta ruta) vía <PwaRegister /> con scope "/ppa". Antes este layout también
// montaba su propio <ServiceWorker /> registrando /ppa-sw.js en el mismo
// scope — dos SW compitiendo por /ppa producían una carrera de registro no
// determinística (cuál gana el control de la página) que hacía fallar de
// forma intermitente los tests E2E de offline/cache. /ppa-sw.js además era
// una versión más simple sin los fixes P0-P3 (FIFO eviction, cache versionado)
// que ya tiene sw.js.
export default async function PpaLayout({ children }: { children: React.ReactNode }) {
  // La PWA es anónima: si no se gatea aquí, apagar el módulo sólo oculta la
  // navegación interna y el QR sigue generando registros legales firmados.
  if (!await isRouteOperational("/prevencion/ppa")) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">PPA Digital no disponible</h1>
          <p className="mt-2 text-sm text-slate-600">La evaluación preventiva fue desactivada temporalmente. Contacta al administrador antes de iniciar el trabajo.</p>
        </section>
      </main>
    )
  }
  return <><PwaRegister />{children}</>
}
