/**
 * El «equipo» de una línea de OC, dicho igual en la ficha de la OC y en el documento que se
 * imprime (FF-7, segundo recorrido 2026-11-09): el detalle lo mostraba y la vista de
 * impresión y el PDF no, porque cargaban sólo el instrumento de los servicios y no el
 * equipo de flota ni la OT de los repuestos.
 *
 * Hay dos clases de «equipo» y el esquema las hace excluyentes: el instrumento de un
 * servicio (`equipmentLabel`) y el vehículo de la flota, que puede traer la OT de
 * mantención que originó el pedido («KA-63 · ABCD-12 · OT M-0042»). Sin acceso a datos.
 */
export function requestItemAssetLabel(asset: {
  equipmentLabel?: string | null
  vehicleLabel?: string | null
  workOrderFolio?: string | null
}): string | null {
  if (asset.equipmentLabel) return asset.equipmentLabel
  if (!asset.vehicleLabel) return null
  return asset.workOrderFolio ? `${asset.vehicleLabel} · OT ${asset.workOrderFolio}` : asset.vehicleLabel
}
