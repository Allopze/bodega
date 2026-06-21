import type { Metadata } from "next"
import { Toaster } from "sonner"

export const metadata: Metadata = {
  title: "PPA Digital — Para, Piensa y Actúa",
  robots: { index: false, follow: false },
}

/**
 * Layout público (sin autenticación). Usado por el formulario PPA del trabajador.
 * No monta el AppShell ni la navegación interna: el trabajador solo ve el formulario.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--color-surface-1)] text-[var(--color-text)]">
      {children}
      <Toaster position="top-center" closeButton offset={16} toastOptions={{ duration: 4000 }} />
    </div>
  )
}
