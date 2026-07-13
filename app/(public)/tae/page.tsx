import { TaeForm } from "./tae-form"

// Requerido para que el nonce de CSP (generado por request en proxy.ts) llegue
// a los <script> de la página — Next.js omite el nonce en páginas prerenderizadas
// estáticamente, lo que bloquea toda la hidratación bajo strict-dynamic.
export const dynamic = "force-dynamic"

export default function TaePublicPage() {
  return <TaeForm />
}
