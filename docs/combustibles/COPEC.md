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

El detalle guardado en `raw_row` va **sin los RUT de chofer y atendedor**: la
minimización que ya se aplicaba a `fuel_meter_readings.raw_payload` se aplica
también acá desde 2026-08-28 (las filas cargadas antes conservan esas columnas
hasta que su período se refresque; ver la nota de remediación).

El odómetro de cada transacción se persiste aparte, en `fuel_meter_readings`
(identidad: guía de despacho), y de ahí salen el rendimiento calculado y las
reglas de medidor regresivo y de salto implausible. Esa columna guarda
**instantes UTC** para las tres fuentes (`copec_tct`, `aramco`, `gps_onway`):
Aramco entrega hora de pared chilena y se convierte al importar. El histórico se reconstruye
desde `raw_row` con `npm run db:backfill-fuel-meter-readings`, sin volver a
consultar el portal.

El TCT usa `tct:diesel` y `tct:bluemax` como cuentas lógicas. Como no existe un
ID nativo estable en el Excel, la identidad fallback es período + producto +
fila fuente; el fingerprint se conserva aparte para que una corrección de
litros/monto actualice la misma evidencia.

## Proyección y mappings

La proyección mensual se reconstruye desde el contenido validado. El hash
incluye patente, tarjetas, transacciones, litros, monto y rendimiento; no se
decide sólo por totales, y **ordena las filas por patente** antes de hashear,
porque Copec regenera el Excel en cada descarga y su orden de filas no es parte
del contenido. La reconstrucción puede retirar una patente desaparecida
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
- Cada corrida planifica como máximo **4 meses** (`MAX_PERIODS_PER_RUN`), y
  no empieza un mes nuevo pasados 150 s: cada período abre dos contextos de
  navegador (TCT y TAE) y el cron corta a los 5 minutos. Lo que falte lo toma
  la corrida siguiente.
- **Verificación por correo (desde 2026-10).** Después de la clave, el portal
  pide un código de 6 dígitos que envía a la casilla de la cuenta de plataforma.
  `lib/combustibles/copec-otp.ts` lo lee por IMAP (`COPEC_OTP_IMAP_*`): sólo
  correos de `info@copec.cl` no leídos y recibidos después del clic en
  "Ingresar" (con un minuto de margen de reloj), el más nuevo primero, y lo
  marca leído al usarlo. El campo del código nace `readonly` y se habilita con
  un clic. El código nunca entra a un log: el call log de Playwright repite los
  argumentos de `fill`, así que los errores de ese tramo se reescriben.
- Cada login es un correo, así que la sesión se **reutiliza** entre productos,
  canales y meses de la misma corrida (cookies en memoria, 15 minutos). Tras
  una falla de acceso (`session_expired`, `mfa_timeout`, `mfa_mailbox`,
  `mfa_rejected`) no se vuelve a intentar el login por 5 minutos: el resto de la
  corrida falla con el mismo motivo en vez de disparar un correo por intento.
- Sin `COPEC_USERNAME`/`COPEC_PASSWORD`, o con `COPEC_SYNC_ENABLED=false`, el
  cron responde `disabled` y no corre. Antes fallaba dentro de la corrida y
  reportaba `failed` a diario por una integración que nadie configuró.
- El botón manual toma el **mismo lock** que el cron (`fuel-copec-sync`): el
  portal es de sesión única y dos corridas simultáneas se pelean la sesión y el
  cursor.
- La espera por un turno, la creación del contexto y la apertura de la página
  tienen cada una un plazo de 30 segundos. Copec usa un proceso de navegador
  aislado, compartiendo el límite de concurrencia con los PDF. Cuando termina la
  importación se espera hasta 5 segundos por el cierre del contexto y se detiene
  el proceso antes de devolver el turno o el lock; no se abandona una importación
  que todavía pudiera escribir. Un turno vencido se retira de la cola.
- Si la interfaz pierde la respuesta de un mes, muestra el trabajo confirmado
  previamente, actualiza el estado si puede y advierte que esa corrida podría
  seguir activa. Si sólo falla la consulta final del estado, conserva el
  resultado confirmado y pide recargar la página.
- Los lotes del período que los informes ya no respaldan se **vacían** (totales
  en cero), sólo para las fuentes que la corrida sí pudo leer completas.
- La evidencia TCT se marca `granularity = 'period_aggregate'` en el ledger: es
  el agregado del MES por patente, así que la conciliación contra cargas
  individuales la salta en vez de marcarla `unmatched` sin significado.

La verificación local no constituye prueba de producción. Antes de aplicar una
migración o reproceso operacional se debe ejecutar el preflight sobre una base
de sólo lectura, revisar el reporte y obtener autorización separada.
