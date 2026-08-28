# Integraciones Copec TCT y TAE

## Contrato operativo

Copec se consulta por período mensual y producto. Los dos canales se descargan
con la opción "Descargar Detalle" del portal, así que el Excel trae **una fila
por transacción**: producto, tarjeta, patente, fecha y hora, estación de
servicio, guía de despacho, volumen, monto y **odómetro**.

TCT se AGREGA por patente al proyectarlo (`fuel_consumption_records` guarda un
consolidado mensual, y el detalle crudo queda en `raw_row`); la agregación es
nuestra, no del portal. TAE entrega una fila por guía/tarjeta y se proyecta como
recepción `received` del ciclo físico cuando la tarjeta tiene un estanque activo.
Una fila externa no validable queda en el ledger como `pending` o `rejected`.

El odómetro de cada transacción se persiste aparte, en `fuel_meter_readings`
(identidad: guía de despacho), y de ahí salen el rendimiento calculado y las
reglas de medidor regresivo y de salto implausible. El histórico se reconstruye
desde `raw_row` con `npm run db:backfill-fuel-meter-readings`, sin volver a
consultar el portal.

El TCT usa `tct:diesel` y `tct:bluemax` como cuentas lógicas. Como no existe un
ID nativo estable en el Excel, la identidad fallback es período + producto +
fila fuente; el fingerprint se conserva aparte para que una corrección de
litros/monto actualice la misma evidencia.

## Proyección y mappings

La proyección mensual se reconstruye desde el contenido validado. El hash
incluye patente, tarjetas, transacciones, litros, monto y rendimiento; no se
decide sólo por totales. La reconstrucción puede retirar una patente desaparecida
o corregir una composición con la misma suma. Un vínculo manual se guarda en
`fuel_provider_mappings` y no se reemplaza por el match automático del catálogo.

TAE conserva además su idempotencia por guía en `fuel_cycle_movements`. Tarjetas
sin estanque y errores de parseo quedan como work items durables asociados a la
corrida, con litros/monto cuando la fila los trae.

## Salud, seguridad y recuperación

- `fuel_provider_sync_runs` es la fuente durable de inicio, fin, conteos y estado.
- La UI muestra recibidas, aceptadas, rechazadas, pendientes e impacto en
  litros/monto; el botón de calidad descarga pendientes y rechazos en Excel sin
  incluir el payload crudo del proveedor.
- `npm run db:preflight-fuel-integrations` sólo lee y reporta duplicados,
  inconsistencias lote-detalle, pendientes y conciliaciones abiertas.
- La sincronización no imprime credenciales, tokens ni cuerpos de login.
- Las rutas cron requieren Bearer, origen permitido mediante
  `CRON_ALLOWED_SOURCES` en producción y rate limit.
- Reprocesar no exige retroceder el cursor: repetir un período usa identidad y
  hash; el cambio se aplica al ledger/proyección sin borrar mappings manuales.

La verificación local no constituye prueba de producción. Antes de aplicar una
migración o reproceso operacional se debe ejecutar el preflight sobre una base
de sólo lectura, revisar el reporte y obtener autorización separada.
