# TODO de cierre — GDI integrada a Adquisiciones

## Cerrado en implementación

- [x] Auditar Solicitudes, Aprobaciones, Compras, Recepciones, Bodega y GDI.
- [x] Confirmar existencia de histórico: 5 guías y 9 líneas en la base local.
- [x] Relacionar GDI con OC, recepción, línea de OC y línea de recepción; FK opcionales para histórico.
- [x] Agregar cotejo por línea, cantidad recibida en faena, diferencia y motivo.
- [x] Agregar estados de Solicitud para recepción parcial/completa en oficina.
- [x] Preparar automáticamente una GDI borrador desde la recepción en oficina.
- [x] Omitir servicios y compras cuyo destino final es Oficina CHOME.
- [x] Registrar entrada de stock en Oficina CHOME con referencia a la recepción.
- [x] Registrar salida/entrada de traslado al confirmar despacho, con bloqueo de líneas de OC.
- [x] Impedir cantidades despachadas superiores a lo recibido en oficina.
- [x] Implementar cotejo completo/parcial sin duplicar stock.
- [x] Registrar diferencias en `receipt_items` y en las líneas de GDI.
- [x] Integrar GDI a Recepciones, OC/Solicitud mediante expediente documental.
- [x] Retirar la navegación y el alta manual operativa desde Bodega; conservar historial y detalle.
- [x] Mantener correlativo, PDF, auditoría, permisos y movimientos históricos.
- [x] Generar migración nueva `0151` sin editar migraciones anteriores.

## Pendiente de cierre técnico

- [x] Corregir/actualizar las pruebas de recepción que aún esperaban el comportamiento antiguo de oficina sin stock/GDI.
- [x] Agregar pruebas de GDI automática para bien físico, servicio y destino oficina.
- [x] Agregar pruebas de recepción parcial proveedor y varias recepciones sobre una OC.
- [x] Agregar pruebas de despacho parcial, segunda GDI desde el saldo y concurrencia.
- [x] Agregar pruebas de cotejo exacto, parcial, diferencias, motivos y estados derivados.
- [x] Agregar pruebas de no duplicación de movimientos y de anulación.
- [x] Agregar pruebas de permisos y conservar/consultar las 5 guías históricas.
- [x] Actualizar E2E y accesibilidad para el flujo desde Recepciones, no desde alta independiente.
- [x] Revisar enlaces históricos sin FK de OC/recepción y ofrecerlos desde el expediente disponible.
- [x] Verificar que el PDF final muestre OC, solicitud, recepción, despacho y cotejo.
- [x] Ejecutar migración local controlada y comprobar `db:generate` sin cambios pendientes.
- [x] Ejecutar tests focalizados y suite rápida.
- [x] Ejecutar lint, `tsc --noEmit`, React Doctor y build de producción.
- [x] Ejecutar browser/E2E sobre base desechable con guardas explícitas.
- [x] Revisar diff final; se preservaron los cambios concurrentes ajenos y no se revirtieron.

## Criterio de salida

- [x] No queda una acción que obligue a entrar a Bodega para iniciar el despacho.
- [x] Toda GDI nueva tiene origen Oficina CHOME y una única faena.
- [x] Ningún servicio ni compra final de oficina genera GDI.
- [x] No existe sobre-despacho ni duplicación de movimientos.
- [x] Solicitud, OC, Recepción y GDI muestran el mismo estado real.
- [x] Las guías históricas siguen visibles y no se eliminan datos.
