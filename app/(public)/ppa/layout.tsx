import type { Metadata } from "next"
import { PwaRegister } from "@/components/pwa/pwa-register"

export const metadata: Metadata = {
  title: "PPA Digital — Para, Piensa y Actúa",
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
// una versión más simple sin los fixes P0-P3 de AUDITORIA_PWA_OFFLINE.md
// (FIFO eviction, cache versionado) que ya tiene sw.js.
export default function PpaLayout({ children }: { children: React.ReactNode }) {
  return <><PwaRegister />{children}</>
}
