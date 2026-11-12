import { redirect } from "next/navigation"

/**
 * El catálogo de EPP pasó a ser la pestaña «Familias EPP» de Productos
 * (2026-11-12). Esta ruta se conserva para los enlaces guardados.
 */
export default function EppsRedirectPage() {
  redirect("/admin/productos/familias")
}
