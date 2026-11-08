# Integraciones Copec TCT y TAE

## Fuente: web services

La sincronización lee de los **web services de consulta** de Copec
(`lib/combustibles/copec-ws.ts`, documento «Web Service TCT v2.1»): sin
navegador, sin código por correo y sin sesión. Es la única fuente: el scraper
del portal (Playwright + código por IMAP) se usó hasta 2026-10-30 y se retiró
el 2026-10-31. Pedía un correo con código en cada login, el portal cerraba la
sesión ante cualquier navegación por URL y desde 2026-10 «Descargar Detalle»
llegó a mandar el informe por correo en vez de descargarlo.

Desde 2026-11 usuario, clave, RUT, interruptor del cron y email del importador
se administran en **Combustibles › Ajustes › Integraciones › Copec › Configurar**
(usuario y clave cifrados en `system_settings` con `DTE_SETTINGS_KEYRING`). Lo
guardado ahí gana; las variables de abajo quedan como respaldo del servidor.
`COPEC_SYNC_START_DATE` sigue siendo sólo del servidor.

| Variable | Para qué |
| --- | --- |
| `COPEC_USERNAME` / `COPEC_PASSWORD` | Las mismas del portal. Para los web services el usuario tiene que ser **ADMINISTRADOR CLIENTE**. |
| `COPEC_CLIENT_RUT` | RUT de la empresa cliente (78.023.530-6 para Servicios Industriales Chome; «TRANSPORTES CHOME LTDA.» es un departamento dentro de esa cuenta). Sin él la sincronización queda apagada (`disabled`). |

| Canal y producto | Servicio |
| --- | --- |
| TCT y TAE Diésel | SOAP `ventas-api.copec.cl/WS_consTCTTAC/services/ConsultaTCTWSS`, `PRODUCTO` = `TCT` o `TAE` |
| TCT y TAE BlueMax | REST `tarjetas-api.copec.cl/WS_ConsumosTCTBlue/…/consultaConsumosBlue`, credenciales en la query. El PDF dice `www.copec.cl`, que desde 2026-10-30 responde 308 hacia ese host; las redirecciones se siguen sólo dentro de `copec.cl` y por HTTPS. |

Cada fila del web service se traduce a **las mismas columnas y valores** del
Excel de «Descargar Detalle» (`copecWsItemToRecord`) y pasa por los mismos
parsers. La identidad de una carga en el ledger es un hash de fecha, hora,
patente, tarjeta, litros, precio, monto y estación (`copec-events.ts`): si la
traducción difiriera, cada mes ya importado desde el Excel aparecería como
«corrección pendiente de revisión». La estación se reconstruye del código SAP
(`0000020017` → `2017-…`, ver `copecStationLabel`).

Lo que la respuesta real hace y el PDF no dice (sondeo del 2026-10-30, ene-2026:
505 cargas idénticas al Excel):

- SOAP trae la guía en `CDENROGUIA` (con ceros a la izquierda) y **no** trae
  `FACTURA`. Éxito = `ID_MENSAJE` "1", con «Cantidad de registros: N.», que se
  cruza contra las filas recibidas.
- `ID_MENSAJE` "0" es tanto «No hay registros para el filtro seleccionado.»
  como un error («El rango máximo a consultar es de 31 días.»). Sólo el primero
  es un mes vacío (`CopecUnavailableReason = "no_records"`).
- BlueMax responde JSON bajo `detalle.item`, con guía y odómetro; su campo
  `descuento` trae valores sin sentido y no se usa.
- El mes en curso llega con unos 20 minutos de atraso, y se aceptan fechas de
  fin futuras.
- Sin probar: la respuesta con credenciales malas (podría bloquear la cuenta) y
  los servicios de Restricciones, que escriben sobre las tarjetas y no se
  integran.

Defensas del cliente, para lo que no se pudo probar contra Copec:

- **Un rechazo de acceso corta la sesión.** HTTP 401/403, o un mensaje de Copec
  sobre usuario, clave o cliente (`CopecWsAccessFailure`), hace que el resto de
  las consultas de la corrida fallen con el mismo motivo sin enviarse: con las
  credenciales del portal, insistir por cada producto, canal y mes podría
  bloquear la cuenta.
- **«No hay registros» sólo cierra un mes si la sesión ya leyó cargas** de este
  cliente. Antes de eso queda como `no_results` (desconocido): podría ser la
  respuesta de Copec a un RUT o usuario equivocado, y `legitimate_empty` no se
  vuelve a pedir nunca.
- Un `soap:Fault` es un rechazo con su motivo aunque llegue con HTTP 500, y no
  se reintenta. Un 5xx sin Fault se reintenta una vez.
- Una fecha u hora con otra forma que `YYYY-MM-DD` / `HH:MM:SS` falla el
  producto (`invalid_file`) en vez de fechar la carga a medianoche. Una guía
  toda en ceros es «sin guía».
- El texto que devuelve Copec se guarda y se muestra con usuario y clave
  tachados, por si alguna vez los repite.

**Migración 0363 (lecturas de odómetro).** La identidad de `fuel_meter_readings`
pasó de `(source, source_ref)` a `(source, source_ref, plate)`: Copec reutiliza
la guía entre vehículos (ene-2026: 660150998 para SRCJ-47 y TBZW-37, 660297420
para SRCJ-47 y DZJY-31). Con la clave vieja, el período entero caía con
`21000` en cuanto los dos vehículos estaban en la flota, por la fuente que
fuera, y entre meses la lectura de uno pisaba la del otro. Durante el deploy,
entre `migrate` y el reemplazo del contenedor, el código viejo fallaría con
`42P10` si alguna sincronización guardara lecturas justo entonces; la corrida
siguiente lo repone. Las lecturas que la clave vieja pisó no vuelven solas:
`npm run db:backfill-fuel-meter-readings` las reconstruye desde `raw_row`.

La evidencia que se archiva es la respuesta tal cual (`.xml` o `.json`, cifrada
como el Excel lo era) y la cobertura registra `parserVersion = copec-ws-v1`. Los
archivos y la cobertura de meses importados antes desde el portal conservan su
`.xlsx` y `copec-xlsx-v1`.

## Contrato operativo

Copec se consulta por período mensual y producto. Los dos canales llegan con
**una fila por transacción**: producto, tarjeta, patente, fecha
y hora, estación de servicio, guía de despacho, volumen, monto y **odómetro**.

TCT se AGREGA por patente al proyectarlo (`fuel_consumption_records` guarda un
consolidado mensual, y el detalle crudo queda en `raw_row`); la agregación es
nuestra, no de Copec. TAE entrega una fila por guía/tarjeta y se proyecta como
recepción `received` del ciclo físico cuando la tarjeta tiene un estanque activo.
Una fila externa no validable queda en el ledger como `pending` o `rejected`.

El detalle guardado en `raw_row` va **sin los RUT de chofer y atendedor**: la
minimización que ya se aplicaba a `fuel_meter_readings.raw_payload` se aplica
también acá desde 2026-08-28 (las filas cargadas antes conservan esas columnas
hasta que su período se refresque; ver la nota de remediación).

El odómetro de cada transacción se persiste aparte, en `fuel_meter_readings`
(identidad: fuente, guía de despacho y patente, porque Copec reutiliza la guía
entre vehículos), y de ahí salen el rendimiento calculado y las
reglas de medidor regresivo y de salto implausible. Esa columna guarda
**instantes UTC** para las fuentes (`copec_tct`, `gps_onway`). El histórico se reconstruye
desde `raw_row` con `npm run db:backfill-fuel-meter-readings`, sin volver a
consultar a Copec.

El TCT usa `tct:diesel` y `tct:bluemax` como cuentas lógicas. Como no existe un
ID nativo estable en el detalle, la identidad fallback es período + producto +
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
- Las rutas cron requieren Bearer y rate limit, más uno de dos caminos: un
  origen de `CRON_ALLOWED_SOURCES` (llamadores externos, detrás del proxy) o el
  secreto interno `FUEL_CRON_INTERNAL_SECRET` en `X-Fuel-Cron-Secret`, que es
  como entra el scheduler de Docker: llama a `http://app:3000` sin cabeceras de
  proxy y nunca trae un origen de la lista. Hasta el 2026-10-29 sólo existía el
  primero y el cron respondió 401 todos los días.
- Reprocesar no exige retroceder el cursor: repetir un período usa identidad y
  hash; el cambio se aplica al ledger/proyección sin borrar mappings manuales.
- Cada corrida planifica como máximo **4 meses** (`MAX_PERIODS_PER_RUN`), y
  no empieza un mes nuevo pasados 150 s: el cron corta a los 5 minutos. Lo que
  falte lo toma la corrida siguiente.
- Sin usuario, clave y RUT (guardados en la plataforma o en el `.env`), o con la
  sincronización automática apagada (interruptor de la pantalla, o
  `COPEC_SYNC_ENABLED=false` si no hay nada guardado), el cron responde
  `disabled` y no corre. Antes fallaba dentro de la corrida y
  reportaba `failed` a diario por una integración que nadie configuró.
- El botón «Sincronizar» corre **el mismo barrido** que el cron
  (`syncCopecReports`): el mes en curso primero y después los meses pendientes,
  en una sola sesión y a nombre del operador. Toma el **mismo lock**
  (`fuel-copec-sync`): dos corridas simultáneas se pelearían el cursor.
- El botón **no espera** la corrida dentro de la petición:
  `startCopecSyncAction` vuelve apenas toma el lock (`startCronJobInBackground`,
  con `after()`), y la pantalla pregunta cada 4 s a
  `getCopecSyncProgressAction` si el lock sigue tomado y qué dejó cada mes.
  Detrás de Cloudflare una petición de más de ~100 s se corta (524), y una
  corrida de varios meses puede pasar de ese tiempo. Hasta el 2026-10-29 el botón pedía un mes por
  petición, siempre el pendiente más antiguo: si ese mes quedaba incompleto el
  siguiente se rechazaba («ya no corresponde al siguiente tramo») y el mes en
  curso nunca se pedía.
- Si se pierde una consulta de avance, la pantalla sigue preguntando: la
  corrida vive en el servidor. Pasados 15 minutos deja de esperar y dice que la
  corrida sigue en curso, sin ofrecer iniciarla de nuevo. Si se pierde la
  respuesta del inicio, advierte que la corrida podría estar activa. Si sólo
  falla la consulta final del estado, conserva el resumen y pide recargar la
  página. Los errores de cada mes pasan por `userFacingErrorText` antes de
  mostrarse: una consulta SQL guardada como error no llega a la pantalla.
- **«No hay registros» = mes vacío.** En un mes cerrado, «No hay registros…»
  (`CopecUnavailableReason = "no_records"`) se registra como vacío confirmado,
  con la evidencia escrita y el importador como responsable. La misma respuesta
  antes de que la sesión haya leído cargas (`no_results`) no prueba nada y sigue
  desconocida. Sin esto el mes no avanzaría hasta confirmarlo a mano, todos los
  meses (TAE BlueMax casi nunca tiene cargas).
- **Patentes fuera de la flota no cuentan.** Una cuenta Copec puede traer
  vehículos de otra empresa (el departamento «TRANSPORTES CHOME LTDA.» mezcla
  propios y ajenos, así que no sirve para filtrar). Si la patente no es de un
  vehículo de la flota, activo o dado de baja, ni está vinculada a mano a uno,
  la carga queda `excluded` (`not_in_fleet`, migración 0366): no entra al
  consumo, no queda pendiente y no deja el mes incompleto. Fuentes de datos las
  lista en el detalle técnico. Si después se agrega el vehículo a la flota, la
  próxima sincronización del mes la reevalúa.
- **Asignaciones con fecha.** Un mes cerrado sólo se atribuye con una
  asignación de `fuel_provider_mappings` vigente para ese mes; la faena es la
  guardada en la asignación, no la del vehículo. Por eso trasladar un vehículo
  (flota, importación de flota, mantención) versiona sus asignaciones
  (`moveProviderMappingsWithVehicleTx`): la vigente se cierra el día anterior y
  nace otra desde el traslado. El agregado mensual del mes del traslado queda
  pendiente a propósito: ese reparto lo decide una persona.
- Los lotes del período que los informes ya no respaldan se **vacían** (totales
  en cero), sólo para las fuentes que la corrida sí pudo leer completas.
- La evidencia TCT se marca `granularity = 'period_aggregate'` en el ledger: es
  el agregado del MES por patente, así que la conciliación contra cargas
  individuales la salta en vez de marcarla `unmatched` sin significado.

La verificación local no constituye prueba de producción. Antes de aplicar una
migración o reproceso operacional se debe ejecutar el preflight sobre una base
de sólo lectura, revisar el reporte y obtener autorización separada.
