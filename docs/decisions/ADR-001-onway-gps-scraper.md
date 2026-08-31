# ADR-001: Integrar Entel OnWay mediante una sesión de navegador

## Estado

Aceptada

## Fecha

2026-08-28

## Contexto

Flota necesita mostrar la última posición disponible de los vehículos administrados en Entel OnWay. Para esta cuenta no está disponible solicitar una API oficial, y el portal autentica mediante Auth0 antes de cargar los datos de seguimiento.

La ubicación de un vehículo es información operacional sensible. La integración debe respetar los permisos y el alcance por faena de Chome, evitar exponer credenciales al navegador y no convertir el payload completo del proveedor en una segunda fuente de verdad de la flota.

## Decisión

Ejecutar Playwright exclusivamente en el servidor y reutilizar una sesión Auth0 aislada en memoria por proceso:

- La navegación solo parte desde `https://onway.enteldigital.cl` y las credenciales solo se escriben si el navegador llegó al tenant exacto `https://lw-fleet-entel-cl.us.auth0.com`.
- El scraper observa la respuesta JSON que el propio mapa solicita a `POST /OnlineTracking/GetOnlineDevicesInfoByUserForMap/`. No interpreta marcadores ni HTML visual.
- Cada respuesta se limita a 10 MiB y se valida antes de persistirla. Solo se aceptan identificador técnico, grupo, patente, coordenadas, velocidad, rumbo, encendido y estado acotado.
- No se guardan cookies, contraseñas, payload crudo, IMEI, teléfono, alias ni HTML. Las cookies viven únicamente en el contexto de navegador en memoria.
- La patente normalizada vincula el dispositivo con un único vehículo existente. Una patente ausente o ambigua queda sin vincular y nunca crea vehículos automáticamente.
- La consulta de posiciones aplica el alcance de faena de la sesión. Solo `flota:manage_gps` puede cambiar credenciales, ejecutar una sincronización manual o ver el conteo global de dispositivos no vinculados.
- La última posición conocida se actualiza mediante upsert. La interfaz muestra el momento de captura y advierte cuando supera 15 minutos; no presenta una captura antigua como tiempo real.
- El cron protegido `/api/cron/fleet-onway-sync` refresca cada cinco minutos cuando `ONWAY_SYNC_ENABLED` está activo. Un lock asesor evita corridas solapadas.

Las credenciales pueden administrarse desde Flota → Monitoreo GPS usando el keyring AES-GCM ya existente. `ONWAY_USERNAME`, `ONWAY_PASSWORD` y `ONWAY_SYNC_ENABLED` son solo un respaldo server-only.

## Alternativas consideradas

### API oficial de OnWay

Sería la opción más estable, pero no está disponible para esta integración. Si Entel la habilita en el futuro, debe reemplazar al scraper conservando el contrato interno y la tabla de posiciones.

### Mostrar el portal en un iframe

Rechazada: delega permisos y experiencia de usuario al portal externo, no permite aplicar alcance por faena y depende de políticas cross-origin y cookies de terceros.

### Raspar el DOM o guardar cookies en disco

Rechazada: el DOM es más frágil que el contrato JSON usado por el mapa. Persistir cookies ampliaría el impacto de una filtración y complicaría rotación, revocación y respaldo.

## Consecuencias

- Cambios en Auth0, selectores o endpoints de OnWay pueden detener la sincronización. Los errores se guardan como códigos acotados y se muestran sin propagar respuestas del proveedor.
- Auth0 puede exigir CAPTCHA o verificación interactiva. En ese caso el cron responde degradado y necesita intervención humana; no intenta eludir el desafío.
- Reiniciar el proceso descarta la sesión y obliga a autenticar una vez en la siguiente corrida.
- Antes de habilitar producción se debe aplicar la migración, comprobar Chromium y ejecutar una sincronización manual. El éxito local del build no demuestra que Auth0 acepte una credencial en producción.

## Operación

1. Aplicar migraciones con `npm run db:migrate`.
2. Confirmar `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser` en el contenedor.
3. Configurar las credenciales desde `/flota/monitoreo` o mediante variables server-only.
4. Ejecutar “Actualizar ahora” y revisar vehículos vinculados, no vinculados y hora de captura.
5. Activar la automatización solo después de una sincronización manual exitosa.
6. Ante `ONWAY_INTERACTIVE_AUTH_REQUIRED`, no programar reintentos agresivos: completar el acceso en el portal y volver a probar una vez.
