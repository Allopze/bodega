# Prompt para diseñar y desarrollar sistema de abastecimiento, compras, bodega y facturación para Chome

Necesito que me ayudes a diseñar, especificar y posteriormente desarrollar un software web para una empresa mediana llamada **Chome**.

La empresa actualmente tiene un proceso manual y propenso a errores para gestionar solicitudes de compra desde distintas faenas. El sistema actual funciona aproximadamente así:

1. Cada faena prepara un archivo Excel con lo que necesita comprar.
2. Ese Excel se envía a una secretaria o encargada administrativa.
3. La secretaria revisa manualmente el Excel y genera una orden de compra a un proveedor.
4. Luego la compra se relaciona de alguna forma con el sistema de facturación.
5. En el proceso, muchas veces se pierden ítems: la faena pide ciertas cosas, pero al generar la orden de compra no se incluyen todos los productos por error.
6. No existe suficiente trazabilidad entre lo solicitado, lo aprobado, lo comprado, lo recibido, lo entregado y lo facturado.
7. Chome actualmente no cuenta con un inventario formal de bodega, pero el sistema debe contemplar la posibilidad de manejar bodega desde el inicio, idealmente como un módulo configurable o evolutivo.

El objetivo es reemplazar el proceso basado en Excel por un sistema centralizado que controle todo el flujo de abastecimiento por faena.

---

## Objetivo general del sistema

Diseñar y desarrollar un sistema web que permita a Chome gestionar de forma trazable y controlada:

* Solicitudes de compra por faena.
* Aprobaciones internas.
* Generación de órdenes de compra.
* Relación con proveedores.
* Recepción de productos.
* Entrega de productos a faena o trabajadores.
* Control de pendientes.
* Módulo de bodega configurable.
* Conciliación con facturas.
* Reportes de gasto, consumo, diferencias y trazabilidad.

El sistema debe evitar que los productos solicitados por una faena desaparezcan o sean omitidos durante el proceso de compra.

La unidad principal de control debe ser el **ítem solicitado**, no solamente la solicitud completa ni la orden de compra. Cada ítem debe tener un estado claro durante todo el proceso.

---

## Problema principal a resolver

El problema más importante del sistema actual es que entre lo que pide la faena y lo que finalmente se compra pueden perderse productos.

Ejemplo:

* La faena pide 10 cascos, 20 guantes y 5 pares de zapatos.
* La secretaria genera una orden de compra, pero por error solo incluye los cascos y los zapatos.
* Los guantes no quedan comprados ni formalmente rechazados.
* Nadie sabe si están pendientes, olvidados o descartados.
* Después la factura tampoco permite reconstruir fácilmente qué pasó.

El nuevo sistema debe impedir este tipo de errores.

Todo ítem aprobado debe terminar en uno de estos estados:

* Pendiente de compra.
* En orden de compra.
* Comprado.
* Recibido parcialmente.
* Recibido completamente.
* Entregado a faena.
* Entregado a trabajador.
* Rechazado.
* Postergado.
* Facturado.
* Conciliado.
* Observado por diferencia.

Ningún ítem debe desaparecer sin trazabilidad.

---

## Enfoque general del producto

El sistema debe funcionar inicialmente como un **Portal de Abastecimiento Directo por Faena**, ya que Chome actualmente no tiene inventario formal de bodega.

Sin embargo, debe incluir desde el diseño inicial un **módulo de bodega configurable**, para soportar dos modos de operación:

### Modo 1: abastecimiento directo a faena

Este es el modo actual esperado para el MVP.

Flujo:

1. La faena solicita productos.
2. Se aprueba la solicitud.
3. Compras genera una orden de compra.
4. El proveedor entrega directamente a la faena o a un responsable.
5. Se registra la recepción.
6. Si corresponde, se registra la entrega a trabajadores.
7. Se concilia la factura.

### Modo 2: abastecimiento mediante bodega

Debe quedar contemplado desde el inicio, aunque pueda activarse en una segunda etapa.

Flujo:

1. La faena solicita productos.
2. Se aprueba la solicitud.
3. Compras genera una orden de compra.
4. El proveedor entrega a bodega central o bodega de faena.
5. Se registra ingreso a bodega.
6. Luego se despacha desde bodega a una faena o trabajador.
7. Se actualiza stock.
8. Se concilia la factura.

El sistema debe permitir configurar si una compra tiene destino:

* Faena.
* Bodega central.
* Bodega de faena.
* Trabajador específico.
* Entrega directa sin pasar por bodega.

---

## Principios funcionales obligatorios

El sistema debe cumplir estos principios:

1. **No debe depender de Excel como fuente principal del proceso.**
   Puede permitir exportar o importar Excel, pero el flujo oficial debe vivir dentro del sistema.

2. **Todo ítem solicitado debe tener trazabilidad.**
   Debe poder verse qué ocurrió con cada producto desde que fue pedido hasta que fue comprado, recibido, entregado y facturado.

3. **No debe permitirse omitir ítems aprobados sin justificación.**
   Si compras decide no incluir un producto en una orden de compra, debe quedar registrado como pendiente, rechazado o postergado, con motivo.

4. **Debe existir historial de cambios.**
   Se debe registrar quién creó, modificó, aprobó, rechazó, compró, recibió, entregó o cerró cada proceso.

5. **Debe existir separación clara de roles.**
   No todos los usuarios deben poder hacer todo.

6. **Debe permitir operación sin bodega formal.**
   El sistema no debe obligar a manejar stock si Chome aún no tiene bodega.

7. **Debe estar preparado para manejar bodega.**
   Aunque no se active completamente desde el MVP, el modelo de datos y la arquitectura deben permitir stock, movimientos, ingresos, egresos y transferencias.

8. **Debe facilitar la conciliación con facturas.**
   El sistema debe comparar solicitud, orden de compra, recepción y factura.

---

## Tipos de usuario y permisos

El sistema debe contemplar los siguientes tipos de usuarios.

---

## 1. Administrador del sistema

El administrador tiene control general de la configuración.

Debe poder:

* Crear, editar, activar y desactivar usuarios.
* Asignar roles y permisos.
* Crear y administrar faenas.
* Crear y administrar centros de costo.
* Crear y administrar proveedores.
* Crear y administrar productos del catálogo.
* Definir categorías de productos.
* Configurar atributos obligatorios por tipo de producto.
* Definir flujos de aprobación.
* Configurar si el sistema opera con bodega o sin bodega.
* Crear y administrar bodegas.
* Configurar permisos por faena.
* Configurar estados del proceso.
* Ver logs de auditoría.
* Acceder a reportes globales.
* Corregir datos maestros con permisos especiales.
* Definir reglas de negocio, como montos máximos, aprobaciones requeridas o categorías críticas.

No debería crear solicitudes operativas salvo que tenga también un rol adicional.

---

## 2. Solicitante de faena

Es el usuario que trabaja desde una faena y necesita pedir productos, indumentaria, herramientas, EPP u otros insumos.

Debe poder:

* Crear solicitudes de compra para su faena.
* Seleccionar productos desde un catálogo.
* Solicitar productos no catalogados, si el sistema lo permite, indicando justificación.
* Indicar cantidades.
* Indicar urgencia.
* Indicar motivo de la solicitud.
* Asociar productos a trabajadores específicos cuando corresponda.
* Indicar talla, medida, color u otros atributos si el producto lo requiere.
* Adjuntar archivos, fotos o documentos de respaldo.
* Guardar solicitudes como borrador.
* Enviar solicitudes a aprobación.
* Ver el estado de sus solicitudes.
* Ver qué productos fueron aprobados, rechazados, comprados, recibidos o pendientes.
* Ver observaciones de aprobadores o compras.
* Responder solicitudes de corrección.
* Duplicar solicitudes anteriores para acelerar pedidos recurrentes.
* Usar plantillas como “kit trabajador nuevo”, “kit EPP básico”, “kit invierno” u otras.

No debe poder:

* Aprobar sus propias solicitudes, salvo configuración especial.
* Generar órdenes de compra.
* Modificar precios.
* Cambiar proveedores finales.
* Marcar facturas como conciliadas.
* Alterar recepciones ya cerradas.

---

## 3. Jefe de faena

Es responsable de validar que lo solicitado por su faena corresponde a una necesidad real.

Debe poder:

* Ver solicitudes creadas por usuarios de sus faenas.
* Aprobar solicitudes.
* Rechazar solicitudes.
* Devolver solicitudes con observaciones.
* Modificar cantidades antes de aprobar, dejando trazabilidad.
* Priorizar solicitudes.
* Validar urgencias.
* Ver historial de solicitudes de su faena.
* Ver pendientes de compra de su faena.
* Ver productos recibidos y pendientes.
* Ver consumo histórico por faena.
* Ver entregas realizadas a trabajadores de su faena.
* Autorizar solicitudes fuera de catálogo, si tiene permiso.
* Comentar sobre cada ítem solicitado.

No debe poder:

* Generar órdenes de compra, salvo que tenga rol adicional.
* Conciliar facturas.
* Editar datos maestros del sistema.
* Modificar recepciones cerradas sin permiso especial.

---

## 4. Prevención de riesgos

Este usuario valida productos relacionados con seguridad, EPP, normas internas y entregas a trabajadores.

Debe poder:

* Revisar solicitudes que contengan EPP o productos críticos.
* Aprobar o rechazar ítems de seguridad.
* Validar que un producto sea adecuado para una tarea o faena.
* Ver historial de EPP entregado por trabajador.
* Ver fechas de entrega de EPP.
* Ver productos vencidos o que requieren renovación, si aplica.
* Solicitar cambio de producto por razones técnicas o normativas.
* Definir o sugerir productos obligatorios por tipo de trabajo.
* Revisar kits de EPP.
* Ver reportes de cumplimiento de entrega de EPP.
* Adjuntar observaciones técnicas.

No debe poder:

* Generar órdenes de compra.
* Cambiar precios.
* Conciliar facturas.
* Modificar stock sin rol de bodega.
* Administrar usuarios.

---

## 5. Compras / secretaria / encargado administrativo

Este rol es clave. Reemplaza el proceso manual de tomar Excel y generar órdenes de compra.

Debe poder:

* Ver solicitudes aprobadas pendientes de compra.
* Ver ítems aprobados agrupados por faena, categoría, proveedor sugerido, urgencia o centro de costo.
* Generar órdenes de compra a partir de ítems aprobados.
* Consolidar ítems de varias solicitudes en una misma orden de compra.
* Dividir una solicitud en varias órdenes de compra según proveedor.
* Seleccionar proveedor.
* Confirmar o modificar precios unitarios.
* Registrar condiciones comerciales.
* Registrar fechas estimadas de entrega.
* Enviar orden de compra por correo al proveedor.
* Descargar orden de compra en PDF.
* Marcar orden de compra como enviada.
* Marcar orden de compra como confirmada por proveedor.
* Registrar observaciones del proveedor.
* Dejar ítems como pendientes de compra con motivo.
* Rechazar o postergar ítems con justificación.
* Ver alertas de ítems aprobados no incluidos en ninguna orden de compra.
* Ver compras pendientes por proveedor.
* Ver compras pendientes por faena.
* Ver historial de precios por producto.
* Ver historial de compras por proveedor.
* Adjuntar cotizaciones.
* Asociar documentos a una orden de compra.
* Crear productos no catalogados con flujo de validación, si el sistema lo permite.
* Solicitar aprobación adicional si la compra supera cierto monto.

No debe poder:

* Aprobar técnicamente EPP si no tiene rol de prevención.
* Conciliar facturas finales si no tiene rol financiero.
* Alterar solicitudes originales sin dejar historial.
* Eliminar ítems aprobados sin justificación.

---

## 6. Recepción / encargado de bodega / responsable de entrega

Este rol registra lo que efectivamente llegó y lo que fue entregado.

Debe poder operar en dos escenarios:

### Escenario A: sin bodega formal

Debe poder:

* Ver órdenes de compra pendientes de recepción.
* Registrar recepción directa en faena.
* Registrar recepción parcial.
* Registrar recepción completa.
* Registrar productos rechazados.
* Adjuntar guía de despacho.
* Indicar fecha de recepción.
* Indicar persona que recibe.
* Registrar diferencias entre lo pedido y lo recibido.
* Registrar entrega a trabajador, si corresponde.
* Marcar ítems como pendientes de entrega.
* Ver historial de recepciones por faena.
* Ver pendientes de recepción.

### Escenario B: con bodega activa

Debe poder:

* Registrar ingreso de productos a bodega.
* Ver stock disponible por bodega.
* Registrar egresos de bodega hacia faenas.
* Registrar entrega directa a trabajadores.
* Registrar transferencias entre bodegas.
* Registrar ajustes de inventario, si tiene permiso.
* Registrar devoluciones.
* Registrar productos dañados o rechazados.
* Ver stock mínimo.
* Ver alertas de reposición.
* Ver movimientos de inventario.
* Realizar conteos físicos, si el módulo está habilitado.
* Cerrar recepciones.
* Adjuntar documentos de respaldo.

No debe poder:

* Crear órdenes de compra.
* Aprobar solicitudes.
* Conciliar facturas.
* Modificar precios.
* Editar proveedores.

---

## 7. Finanzas / facturación

Este usuario se encarga de revisar facturas y conciliarlas contra órdenes de compra y recepciones.

Debe poder:

* Registrar facturas manualmente.
* Importar facturas desde archivos, si el sistema lo permite.
* Asociar facturas a órdenes de compra.
* Ver facturas pendientes de conciliación.
* Ver facturas con diferencias.
* Comparar factura contra orden de compra.
* Comparar factura contra recepción.
* Identificar productos facturados no recibidos.
* Identificar cantidades facturadas mayores a las recibidas.
* Identificar precios facturados distintos a los de la orden de compra.
* Marcar factura como conciliada.
* Marcar factura como observada.
* Devolver factura a revisión.
* Adjuntar documentos tributarios.
* Exportar información para contabilidad.
* Ver reportes de gastos por faena.
* Ver reportes de gastos por proveedor.
* Ver reportes de diferencias detectadas.
* Ver estados de pago, si el sistema lo contempla.

No debe poder:

* Modificar solicitudes originales.
* Aprobar solicitudes de faena.
* Registrar recepción física si no tiene rol correspondiente.
* Cambiar stock sin permiso de bodega.
* Editar datos maestros críticos sin autorización.

---

## 8. Gerencia / usuario de consulta ejecutiva

Este usuario necesita visibilidad, indicadores y control, pero no necesariamente operar el proceso.

Debe poder:

* Ver dashboard general.
* Ver solicitudes abiertas.
* Ver solicitudes pendientes de aprobación.
* Ver ítems aprobados no comprados.
* Ver órdenes de compra en curso.
* Ver recepciones pendientes.
* Ver facturas observadas.
* Ver gastos por faena.
* Ver gastos por proveedor.
* Ver gastos por categoría.
* Ver tiempos promedio de aprobación.
* Ver tiempos promedio desde solicitud hasta orden de compra.
* Ver tiempos promedio desde orden de compra hasta recepción.
* Ver proveedores con más retrasos.
* Ver faenas con mayor consumo.
* Exportar reportes.
* Filtrar por fecha, faena, proveedor, categoría y centro de costo.

No debe poder:

* Modificar procesos operativos, salvo que tenga roles adicionales.
* Alterar solicitudes, órdenes, recepciones o facturas.

---

## 9. Proveedor externo, opcional para una segunda etapa

El proveedor podría tener acceso a un portal limitado.

Debe poder:

* Ver órdenes de compra que le fueron enviadas.
* Confirmar recepción de orden de compra.
* Confirmar disponibilidad.
* Indicar fecha estimada de entrega.
* Adjuntar documentos.
* Marcar despacho realizado.
* Comentar observaciones.
* Subir factura o documento relacionado, si se habilita.

No debe poder:

* Ver información de otros proveedores.
* Ver información interna de Chome.
* Modificar solicitudes.
* Modificar precios sin aprobación.
* Ver reportes internos.

Este portal no es obligatorio para el MVP, pero el sistema debe poder contemplarlo a futuro.

---

## Módulos principales del sistema

El sistema debe incluir o contemplar los siguientes módulos.

---

## 1. Módulo de autenticación y permisos

Debe permitir:

* Login seguro.
* Recuperación de contraseña.
* Gestión de sesiones.
* Roles y permisos.
* Permisos por faena.
* Permisos por módulo.
* Registro de actividad.
* Posibilidad de que un usuario tenga más de un rol.

---

## 2. Módulo de faenas y centros de costo

Debe permitir:

* Crear faenas.
* Editar faenas.
* Activar o desactivar faenas.
* Asociar faenas a centros de costo.
* Asignar responsables.
* Asignar usuarios permitidos.
* Ver historial de solicitudes por faena.
* Ver gasto acumulado por faena.
* Ver consumo por categoría.

---

## 3. Módulo de catálogo de productos

Debe permitir:

* Crear productos.
* Editar productos.
* Activar o desactivar productos.
* Definir SKU interno.
* Definir unidad de medida.
* Definir categoría.
* Definir si es EPP.
* Definir si requiere aprobación de prevención.
* Definir atributos obligatorios, como talla, color, trabajador, medida o modelo.
* Asociar proveedor sugerido.
* Registrar precio referencial.
* Registrar precio histórico.
* Permitir productos no catalogados con aprobación especial.
* Crear kits o plantillas de productos.

Ejemplos de categorías:

* EPP.
* Indumentaria.
* Herramientas.
* Insumos.
* Materiales.
* Equipos.
* Consumibles.
* Otros.

Ejemplos de productos:

* Casco.
* Guantes anticorte.
* Zapatos de seguridad.
* Lentes de seguridad.
* Chaleco reflectante.
* Overol.
* Arnés.
* Bloqueador solar.
* Protector auditivo.

---

## 4. Módulo de solicitudes de compra

Debe permitir:

* Crear solicitud.
* Guardar borrador.
* Agregar múltiples ítems.
* Seleccionar productos desde catálogo.
* Agregar producto no catalogado.
* Definir cantidad.
* Definir faena.
* Definir centro de costo.
* Definir urgencia.
* Definir fecha requerida.
* Agregar observaciones.
* Adjuntar archivos.
* Usar plantillas.
* Duplicar solicitudes anteriores.
* Enviar a aprobación.
* Ver estado de cada ítem.
* Ver historial completo.

Estados sugeridos de solicitud:

* Borrador.
* Enviada.
* En revisión.
* Aprobada parcialmente.
* Aprobada.
* Rechazada.
* Devuelta con observaciones.
* En compras.
* Cerrada.
* Cancelada.

Estados sugeridos de ítem:

* Borrador.
* Solicitado.
* Aprobado.
* Rechazado.
* Devuelto.
* Pendiente de compra.
* En orden de compra.
* Comprado.
* Recibido parcial.
* Recibido completo.
* Entregado.
* Facturado.
* Conciliado.
* Observado.

---

## 5. Módulo de aprobaciones

Debe permitir:

* Aprobar solicitud completa.
* Aprobar ítems individuales.
* Rechazar ítems individuales.
* Devolver solicitud con observaciones.
* Solicitar información adicional.
* Aplicar reglas de aprobación por monto.
* Aplicar reglas de aprobación por categoría.
* Aplicar reglas especiales para EPP.
* Registrar aprobador, fecha y comentario.
* Mantener historial de decisiones.
* Notificar al solicitante.

Reglas posibles:

* Toda solicitud requiere aprobación del jefe de faena.
* Todo EPP requiere aprobación de prevención.
* Toda compra sobre cierto monto requiere aprobación adicional.
* Todo producto no catalogado requiere validación de compras o administración.
* Toda urgencia crítica debe quedar justificada.

---

## 6. Módulo de órdenes de compra

Debe permitir:

* Ver ítems aprobados pendientes de compra.
* Seleccionar ítems para generar orden de compra.
* Agrupar ítems por proveedor.
* Dividir ítems en distintas órdenes de compra.
* Generar número de orden de compra.
* Asociar proveedor.
* Definir precios unitarios.
* Definir descuentos, impuestos y totales.
* Definir fecha estimada de entrega.
* Asociar condiciones comerciales.
* Descargar PDF de orden de compra.
* Enviar orden de compra por email.
* Adjuntar cotizaciones.
* Marcar orden como enviada.
* Marcar orden como confirmada.
* Marcar orden como parcialmente recibida.
* Marcar orden como recibida.
* Marcar orden como cerrada.
* Anular orden con motivo.
* Ver diferencias entre ítems aprobados e ítems incluidos en OC.

Regla obligatoria:

Si un ítem aprobado no se incluye en una orden de compra, debe quedar visible como pendiente, postergado o rechazado con justificación.

Estados sugeridos de OC:

* Borrador.
* Emitida.
* Enviada a proveedor.
* Confirmada por proveedor.
* Parcialmente recibida.
* Recibida.
* Facturada parcialmente.
* Facturada.
* Conciliada.
* Cerrada.
* Anulada.

---

## 7. Módulo de recepción

Debe permitir:

* Registrar recepción contra una orden de compra.
* Registrar recepción parcial.
* Registrar recepción completa.
* Registrar productos faltantes.
* Registrar productos rechazados.
* Registrar productos dañados.
* Adjuntar guía de despacho.
* Registrar quién recibió.
* Registrar fecha y lugar de recepción.
* Indicar si la recepción fue en faena, bodega central, bodega de faena o entrega directa.
* Generar pendientes automáticos.
* Notificar diferencias.
* Consultar historial de recepción.

La recepción debe actualizar el estado de cada ítem.

---

## 8. Módulo de entrega a faena o trabajador

Debe permitir:

* Registrar entrega a una faena.
* Registrar entrega a un trabajador específico.
* Registrar fecha de entrega.
* Registrar responsable que entrega.
* Registrar responsable que recibe.
* Adjuntar comprobante o firma, si aplica.
* Ver historial de entregas por trabajador.
* Ver historial de entregas por faena.
* Ver EPP entregado por trabajador.
* Ver productos pendientes de entrega.

Este módulo es especialmente importante para EPP e indumentaria.

---

## 9. Módulo de bodega

El sistema debe contemplar un módulo de bodega desde el diseño inicial, pero debe ser configurable.

Debe poder operar en tres niveles:

### Nivel 0: sin bodega activa

* No se controla stock.
* Se registran recepciones directas a faena.
* Se registran entregas.
* Se controlan pendientes.
* Se mantiene trazabilidad.

Este debe ser el modo recomendado para el MVP si Chome aún no tiene bodega formal.

### Nivel 1: bodega liviana

Debe permitir:

* Crear una o más bodegas.
* Registrar ingresos desde órdenes de compra.
* Registrar egresos hacia faenas.
* Registrar entregas a trabajadores.
* Ver stock simple por producto y bodega.
* Ver movimientos básicos.
* Registrar ajustes simples.
* Registrar devoluciones.
* Ver productos disponibles.
* Ver productos comprometidos o reservados.

### Nivel 2: bodega completa

Debe permitir:

* Stock por bodega.
* Stock por ubicación interna.
* Stock mínimo y máximo.
* Alertas de reposición.
* Kardex o historial completo de movimientos.
* Transferencias entre bodegas.
* Conteos físicos.
* Ajustes con motivo.
* Valorización de inventario.
* Productos seriados o por lote, si aplica.
* Reservas de stock para solicitudes aprobadas.
* Despachos internos.
* Devoluciones desde faena.
* Reportes de rotación.
* Reportes de diferencias de inventario.

El sistema debe diseñarse para poder comenzar en Nivel 0 o Nivel 1, sin impedir evolucionar a Nivel 2.

Entidades sugeridas para bodega:

* Bodega.
* Ubicación.
* StockProducto.
* MovimientoInventario.
* TipoMovimiento.
* ReservaStock.
* TransferenciaBodega.
* AjusteInventario.
* ConteoInventario.

Tipos de movimiento sugeridos:

* Ingreso por OC.
* Egreso a faena.
* Entrega a trabajador.
* Transferencia entre bodegas.
* Devolución.
* Ajuste positivo.
* Ajuste negativo.
* Rechazo.
* Merma.
* Anulación.

---

## 10. Módulo de facturación y conciliación

Debe permitir:

* Registrar factura manualmente.
* Importar factura desde archivo, si aplica.
* Asociar factura a proveedor.
* Asociar factura a una o más órdenes de compra.
* Registrar número de factura.
* Registrar fecha.
* Registrar monto neto, impuestos y total.
* Registrar ítems facturados.
* Adjuntar PDF, XML u otro documento.
* Comparar factura contra orden de compra.
* Comparar factura contra recepción.
* Detectar diferencias de cantidad.
* Detectar diferencias de precio.
* Detectar productos facturados no recibidos.
* Detectar productos facturados no solicitados.
* Marcar factura como conciliada.
* Marcar factura como observada.
* Registrar motivo de observación.
* Exportar información a contabilidad o sistema externo.

Debe implementarse una lógica de triple comparación:

1. Solicitud aprobada.
2. Orden de compra.
3. Recepción.
4. Factura.

La factura solo debería quedar conciliada si coincide con lo comprado y recibido, salvo que un usuario autorizado apruebe una excepción.

Estados sugeridos de factura:

* Registrada.
* Pendiente de revisión.
* Observada.
* Conciliada.
* Rechazada.
* Enviada a pago.
* Pagada.
* Anulada.

---

## 11. Módulo de reportes y dashboards

Debe incluir reportes para diferentes perfiles.

Reportes operativos:

* Solicitudes pendientes de aprobación.
* Ítems aprobados no comprados.
* Órdenes de compra pendientes.
* Recepciones pendientes.
* Recepciones parciales.
* Entregas pendientes.
* Facturas pendientes de conciliación.
* Facturas observadas.

Reportes de gestión:

* Gasto por faena.
* Gasto por centro de costo.
* Gasto por proveedor.
* Gasto por categoría.
* Consumo por faena.
* Consumo por trabajador.
* Consumo de EPP por periodo.
* Tiempos promedio de aprobación.
* Tiempos promedio de compra.
* Tiempos promedio de entrega.
* Proveedores con más retrasos.
* Productos más solicitados.
* Diferencias más frecuentes.

Reportes de bodega, si aplica:

* Stock actual.
* Stock valorizado.
* Stock bajo mínimo.
* Movimientos por producto.
* Movimientos por bodega.
* Transferencias.
* Ajustes.
* Rotación de productos.

---

## 12. Módulo de notificaciones

Debe enviar notificaciones por email y eventualmente por otros canales.

Eventos que deben notificar:

* Nueva solicitud enviada.
* Solicitud pendiente de aprobación.
* Solicitud aprobada.
* Solicitud rechazada.
* Solicitud devuelta.
* Ítem aprobado pendiente de compra por demasiados días.
* Orden de compra generada.
* Orden de compra enviada al proveedor.
* Orden de compra confirmada.
* Recepción parcial.
* Recepción completa.
* Producto pendiente de recepción.
* Factura registrada.
* Factura con diferencias.
* Factura conciliada.
* Stock bajo mínimo, si aplica.
* Producto crítico pendiente.

---

## Matriz de trazabilidad obligatoria

El sistema debe permitir ver una matriz por ítem con esta información:

| Producto                  | Faena        | Solicitado | Aprobado | En OC | Recibido | Entregado | Facturado | Estado             |
| ------------------------- | ------------ | ---------: | -------: | ----: | -------: | --------: | --------: | ------------------ |
| Casco blanco              | Faena Norte  |         10 |       10 |    10 |       10 |        10 |        10 | Conciliado         |
| Guantes anticorte         | Faena Norte  |         20 |       20 |    15 |       15 |        15 |        15 | Pendiente compra 5 |
| Zapato seguridad talla 42 | Faena Sur    |          5 |        5 |     5 |        3 |         3 |         5 | Facturado de más   |
| Lentes seguridad          | Faena Centro |         30 |       30 |     0 |        0 |         0 |         0 | No incluido en OC  |

Esta vista es fundamental para resolver el problema principal.

---

## Modelo de datos sugerido

Diseñar el modelo de datos considerando al menos estas entidades:

### Usuarios y permisos

* Usuario.
* Rol.
* Permiso.
* UsuarioRol.
* FaenaUsuario.

### Operación

* Faena.
* CentroCosto.
* Producto.
* CategoriaProducto.
* AtributoProducto.
* ProductoAtributoValor.
* Proveedor.
* ProductoProveedor.

### Solicitudes

* SolicitudCompra.
* SolicitudCompraItem.
* SolicitudItemAtributo.
* AprobacionSolicitud.
* ComentarioSolicitud.
* AdjuntoSolicitud.

### Compras

* OrdenCompra.
* OrdenCompraItem.
* Cotizacion.
* AdjuntoOrdenCompra.

### Recepción y entrega

* Recepcion.
* RecepcionItem.
* Entrega.
* EntregaItem.
* Trabajador.

### Bodega

* Bodega.
* UbicacionBodega.
* StockProducto.
* MovimientoInventario.
* TransferenciaBodega.
* AjusteInventario.
* ReservaStock.
* ConteoInventario.

### Facturación

* Factura.
* FacturaItem.
* ConciliacionFactura.
* DiferenciaConciliacion.
* AdjuntoFactura.

### Auditoría

* LogAuditoria.
* HistorialEstado.
* Notificacion.

---

## Reglas de validación importantes

Implementar reglas como:

* No se puede generar una orden de compra desde ítems no aprobados.
* No se puede cerrar una solicitud si tiene ítems aprobados sin estado final.
* No se puede eliminar un ítem aprobado sin registrar motivo y usuario.
* No se puede marcar factura como conciliada si hay diferencias no resueltas.
* No se puede recibir más cantidad que la comprada sin autorización.
* No se puede entregar más cantidad que la recibida, salvo que exista stock disponible en bodega.
* No se puede generar egreso de bodega sin stock suficiente, salvo configuración especial.
* Todo producto EPP debe permitir trazabilidad por trabajador si corresponde.
* Todo cambio de cantidad después de aprobación debe quedar auditado.
* Todo rechazo debe tener motivo.
* Toda postergación debe tener motivo.
* Toda anulación de OC debe tener motivo.

---

## Pantallas principales esperadas

Diseñar la interfaz considerando estas pantallas:

### Para solicitante de faena

* Dashboard de mis solicitudes.
* Crear solicitud.
* Editar borrador.
* Ver solicitud.
* Ver estado por ítem.
* Historial de pedidos.
* Plantillas frecuentes.

### Para jefe de faena

* Solicitudes pendientes de aprobación.
* Detalle de solicitud.
* Aprobación por ítem.
* Historial de faena.
* Pendientes de compra.
* Consumo de faena.

### Para prevención

* Solicitudes con EPP pendientes de validación.
* Historial de EPP por trabajador.
* Reporte de cumplimiento.
* Validación técnica de productos.

### Para compras

* Dashboard de compras.
* Ítems aprobados pendientes de compra.
* Generar orden de compra.
* Órdenes de compra.
* Detalle de OC.
* Proveedores.
* Cotizaciones.
* Pendientes por proveedor.
* Alertas de ítems no comprados.

### Para recepción/bodega

* Órdenes pendientes de recepción.
* Registrar recepción.
* Recepciones parciales.
* Entregas pendientes.
* Entrega a faena.
* Entrega a trabajador.
* Stock por bodega, si aplica.
* Movimientos de inventario, si aplica.

### Para finanzas

* Facturas pendientes.
* Registrar factura.
* Conciliación de factura.
* Facturas observadas.
* Facturas conciliadas.
* Reportes financieros.

### Para administración

* Usuarios.
* Roles.
* Permisos.
* Faenas.
* Centros de costo.
* Productos.
* Categorías.
* Proveedores.
* Bodegas.
* Configuración de aprobaciones.
* Logs de auditoría.

### Para gerencia

* Dashboard ejecutivo.
* Reportes.
* Indicadores.
* Exportaciones.

---

## MVP recomendado

El MVP debe enfocarse en resolver el problema principal sin sobrecargar a la empresa con procesos que aún no usa.

El MVP debería incluir:

* Login y roles básicos.
* Gestión de faenas.
* Gestión de usuarios.
* Catálogo de productos.
* Solicitudes de compra por faena.
* Aprobación de solicitudes.
* Aprobación por ítem.
* Vista de ítems aprobados pendientes de compra.
* Generación de órdenes de compra.
* PDF de orden de compra.
* Envío o registro de envío a proveedor.
* Recepción parcial o completa.
* Entrega directa a faena o trabajador.
* Registro manual de factura.
* Conciliación básica entre OC, recepción y factura.
* Dashboard de pendientes.
* Reportes básicos.
* Auditoría de cambios.
* Bodega en Nivel 0 o Nivel 1 configurable.

El MVP no debería obligar a usar bodega completa si Chome todavía no tiene inventario real.

---

## Segunda etapa recomendada

La segunda etapa podría incluir:

* Bodega completa.
* Stock por ubicación.
* Transferencias entre bodegas.
* Stock mínimo.
* Alertas de reposición.
* Kardex.
* Conteos físicos.
* Portal de proveedor.
* Cotizaciones múltiples.
* Integración con sistema de facturación.
* Importación automática de facturas.
* App móvil o PWA avanzada.
* Firma digital de entrega.
* Reportes avanzados.
* Predicción de recompra por historial.
* Recomendaciones de compra según consumo.

---

## Integraciones futuras

El sistema debe diseñarse pensando en integraciones futuras con:

* Sistema de facturación.
* ERP.
* Correo electrónico.
* Firma electrónica.
* Sistema contable.
* API de proveedores.
* Importación/exportación Excel.
* Lectura de facturas PDF/XML.
* WhatsApp o notificaciones externas, si aplica.

No asumir que todas estas integraciones existirán en el MVP, pero la arquitectura debe permitirlas.

---

## Requerimientos no funcionales

El sistema debe ser:

* Web responsive.
* Seguro.
* Auditable.
* Modular.
* Escalable.
* Fácil de usar.
* Preparado para usuarios con bajo nivel técnico.
* Con formularios rápidos para faenas.
* Con filtros claros.
* Con exportación a Excel y PDF.
* Con historial completo.
* Con permisos granulares.
* Con buena experiencia en celular y computador.
* Con manejo claro de errores.
* Con respaldos y protección de datos.

---

## Criterios de éxito

El sistema será exitoso si logra:

* Reducir o eliminar el uso de Excel como medio principal.
* Evitar que ítems solicitados se pierdan al generar órdenes de compra.
* Mejorar la trazabilidad entre solicitud, compra, recepción y factura.
* Permitir saber qué pidió cada faena.
* Permitir saber qué se compró.
* Permitir saber qué llegó.
* Permitir saber qué falta.
* Permitir saber qué fue entregado.
* Permitir saber qué fue facturado.
* Detectar diferencias automáticamente.
* Dar visibilidad a compras pendientes.
* Dar reportes claros a gerencia.
* Permitir operar sin bodega formal.
* Permitir activar bodega en el futuro sin rehacer todo el sistema.

---

## Resultado esperado de tu respuesta

Con base en todo lo anterior, necesito que generes una especificación completa para el sistema.

Tu respuesta debe incluir:

1. Propuesta de arquitectura funcional.
2. Módulos del sistema.
3. Roles y permisos.
4. Flujos principales.
5. Estados de solicitudes, ítems, órdenes de compra, recepciones, entregas, bodega y facturas.
6. Modelo de datos sugerido.
7. Reglas de negocio.
8. Validaciones importantes.
9. Pantallas necesarias.
10. Dashboard e indicadores.
11. Recomendación de MVP.
12. Recomendación de segunda etapa.
13. Consideraciones técnicas.
14. Riesgos del proyecto.
15. Propuesta de implementación por fases.

Asume que tienes acceso completo al código y a la repo del proyecto si ya existe una base técnica. Si no existe, propón una arquitectura inicial razonable y mantenible.

Prioriza claridad, trazabilidad y simplicidad operativa. No construyas un ERP gigante innecesario, pero deja el sistema preparado para crecer hacia bodega, inventario e integraciones futuras.
