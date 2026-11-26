/**
 * Dirección de Bodega ya filtrada por un producto (NAV-7, auditoría de Mantención 2026-11-26): para saber cuánto hay
 * de un repuesto sin ir a buscarlo a mano.
 *
 * Usa el kárdex (`vista=kardex`) porque es la única vista de Bodega que filtra por el id del producto (`producto`);
 * Stock sólo busca por texto (nombre o SKU). Con producto y faena elegidos el kárdex dibuja además el saldo en el
 * tiempo. Sin faena se pide «todas», que es el valor de `ALL_WORKSITES` en `app/(app)/bodega/faena-scope.ts`: sin
 * él Bodega abriría en la bodega propia de quien mira, que no es lo que se quiso enseñar.
 *
 * Mostrar el enlace no es autorización: Bodega valida `warehouse:view_stock` y el alcance de faena en el servidor.
 * Quien ofrece el enlace sólo decide si lo muestra, con el mismo permiso.
 */
export function bodegaProductHref(productId: string, worksiteId: string | null = null): string {
  const worksite = worksiteId ? encodeURIComponent(worksiteId) : "todas"
  return `/bodega?vista=kardex&producto=${encodeURIComponent(productId)}&faena=${worksite}`
}
