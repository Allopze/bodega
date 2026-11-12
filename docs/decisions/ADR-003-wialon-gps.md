# ADR-003: Integrar Wialon como fuente GPS complementaria a OnWay y VisionLink

## Estado

Aceptada.

## Fecha

2026-11-12.

## Contexto

La plataforma ya usa dos fuentes de telemetría:

- **OnWay** (Entel GPS), vía scraper Playwright, con la mayor cobertura de vehículos.
- **VisionLink** (Cat Digital), vía API OAuth2, para horas de motor, ralentí y litros por equipo y día.

La cuenta de Wialon cubre equipos que OnWay no tiene. No se trata de reemplazar OnWay: se necesita una tercera fuente que sume posiciones y medidores sin duplicar vehículos ni mezclar series de distinto origen. La integración debe alimentar el Monitoreo GPS, el Panel operacional y los cruces con Combustible, Mantención, Compras y Prevención.

## Decisión

1. **Wialon Hosting con token.** Se usa `token/login` sobre una URL base configurable (por defecto `https://hst-api.wialon.com`). El token se guarda cifrado en `system_settings` y tiene como respaldo `WIALON_TOKEN`; nunca viaja al cliente ni a los logs.
2. **Coexistencia, no reemplazo.** OnWay sigue siendo la fuente principal por cobertura. Wialon se suma en las mismas tablas `fleet_gps_*` con `provider = "wialon"`. VisionLink sigue siendo la fuente diaria de horas/litros Cat: Wialon no escribe `fuel_telemetry_daily`.
3. **Una fila por vehículo.** El read model `mergeLatestGpsByVehicle` agrupa las filas de todos los proveedores: la posición sale del mensaje más reciente y cada medidor, de su lectura no nula más reciente. En un empate manda OnWay. La UI muestra la fuente y la hora de cada dato.
4. **Series separadas.** Los avances de medidor se calculan con una sola fuente: `copec_tct` → `gps_wialon` → `gps_onway`. Nunca se encadenan puntos de proveedores distintos. `fuel_meter_readings.source` incorpora `gps_wialon`.
5. **Matching sin invención.** La unidad se resuelve por vínculo manual (`fleet_gps_device_links`), patente en propiedades, código interno, nombre o patente embebida. Una unidad ambigua o sin match queda pendiente; nunca se crea un vehículo.
6. **Mantención advisory.** La lectura GPS se usa para estimar la próxima mantención sólo cuando es más nueva que la lectura oficial; `mant_records` sigue siendo la fuente del estado. La estimación se muestra aparte y no se escribe.
7. **Sesión y límites.** La sesión de Wialon vive en memoria del proceso y se renueva cuando expira. El cron corre cada 5 minutos, desfasado de OnWay, con lock y contrato propio. Un snapshot sin unidades o sin posiciones es una falla, no un éxito vacío.
8. **Datos mínimos.** No se persiste el payload crudo de Wialon. Sólo posición, velocidad, rumbo, encendido, medidores, hora del mensaje y hora de captura. El token nunca se registra.

## Consecuencias

- Monitoreo GPS muestra una sola fila por vehículo, con badge de fuente (`OnWay`, `Wialon`, `OnWay + Wialon`).
- El Panel operacional gana un bloque de cruces con Combustible, Mantención, Compras y Prevención. Cada cifra enlaza a una lista con el mismo predicado.
- Flota usa la serie Copec cuando existe y cae a la serie GPS cuando no; el tooltip indica la fuente.
- Una unidad Wialon sin vehículo conserva su última posición, pero no entra al panel hasta vincularse.
- El historial, los viajes y las alertas de Wialon no se ingestan en esta fase; la pestaña Historial sigue siendo de OnWay.
- Si el token no tiene permiso de lectura de unidades, la corrida falla con `WIALON_ACCESS_DENIED` y no se presenta como saludable.

## Operación

1. Aplicar migraciones (`npm run db:migrate`).
2. En `/flota/monitoreo` → Configurar → Wialon, guardar URL y token; usar «Probar conexión».
3. Ejecutar «Actualizar ahora» y revisar unidades vinculadas y pendientes.
4. Activar la actualización automática sólo después de una corrida manual correcta.
5. Confirmar que OnWay sigue corriendo y que la cobertura OnWay no cuenta corridas Wialon.
