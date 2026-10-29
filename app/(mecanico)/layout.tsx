import "./mant-app.css"
import "./mant-screens.css"

/**
 * App del mecánico (`/m/mantencion`): pantalla completa, sin el AppShell de la
 * plataforma (ni barra lateral ni búsqueda global). Las fuentes ya vienen del
 * layout raíz (`--font-exo`, `--font-myriad`, `--font-geist-mono`). El estilo
 * cuelga de `.mant` para no filtrarse al resto de la plataforma.
 */
export default function MecanicoLayout({ children }: { children: React.ReactNode }) {
  return <div className="mant">{children}</div>
}
