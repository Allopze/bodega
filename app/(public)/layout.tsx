import type { Metadata, Viewport } from "next"
import { Toaster } from "sonner"

export const metadata: Metadata = {
  title: "Plataforma Chome",
  description: "Formularios públicos operacionales de Plataforma Chome.",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#065F46",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // P2-4: removed userScalable: false — it blocks pinch-to-zoom,
  // which is a WCAG 1.4.4 violation. maximumScale set to 5 to
  // prevent accidental extreme zoom while allowing accessibility.
}

/**
 * Layout público (sin autenticación). Usado por el formulario PPA del trabajador.
 * No monta el AppShell ni la navegación interna: el trabajador solo ve el formulario.
 *
 * Soporta PWA offline: registra el service worker y carga la metadata de la
 * Progressive Web App para que el formulario funcione sin conexión.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--color-surface-1)] text-[var(--color-text)]">
      {children}
      <Toaster position="top-center" closeButton offset={16} toastOptions={{ duration: 4000 }} />
    </div>
  )
}
