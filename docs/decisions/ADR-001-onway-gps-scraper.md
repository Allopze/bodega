# ADR-001: Integrar Entel OnWay mediante una sesión de navegador

## Estado

Aceptada, con enmiendas del 2026-11-25 (ver «Enmienda» al final)

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
- Una verificación interactiva (CAPTCHA u OTP) no se resuelve automáticamente. Una persona con `flota:manage_gps` puede completarla desde `/flota/monitoreo`: la plataforma transmite el navegador aislado del servidor (frames JPEG y eventos de puntero/teclado) en una vista de un solo uso, atada a quien la abre, con vencimiento de cinco minutos, sin persistir ni grabar el contenido y sin alterar la huella del navegador. Mientras la vista está abierta, el cron y el refresco en vivo se saltan esa lectura y quedan degradados.

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
- Auth0 puede exigir CAPTCHA o verificación interactiva. En ese caso el cron responde degradado (`ONWAY_INTERACTIVE_AUTH_REQUIRED`) y la completa una persona desde Monitoreo GPS; no se resuelve automáticamente ni se intenta eludir el desafío.
- La vista asistida depende de que el widget del proveedor funcione en el Chromium headless del servidor. Si exige un navegador con display o rechaza la sesión, la verificación no se puede completar ahí y sigue requiriendo el portal o una API oficial; no se agregan señales de evasión para forzarla.
- Reiniciar el proceso descarta la sesión y obliga a autenticar una vez en la siguiente corrida. Cambiar el usuario o la contraseña también: la sesión queda atada a la cuenta con la que se autenticó.
- Un snapshot con la sesión viva y sin ningún equipo es una falla (`ONWAY_SNAPSHOT_EMPTY`), no un éxito con cero equipos: la cuenta perdió la flota o no es la que corresponde. Así se escondió el GPS detenido entre el 2026-11-02 y el 11-08.
- Mientras alguien tiene abierta `/flota/monitoreo`, la página pide cada 10 s el refresco en vivo (desde 2026-11-12, compartido con Wialon; OnWay sigue consultando el portal a lo más una vez por minuto) con una lectura sólo de posiciones (`POST /api/flota/monitoreo/refresco`, corrida `live` en la bitácora): una consulta al portal en vez de las ~51 de la lectura completa. El detalle (hora GPS, señal, medidores, conductor) y las alertas siguen en el cron cada 5 minutos, así que pueden ir hasta 5 minutos detrás de la posición. No se consulta si una corrida de OnWay empezó hace menos de 50 s (hasta 2026-11-12 contaba cualquier proveedor y una corrida de Wialon bloqueaba la de OnWay) (varias personas mirando no multiplican la carga), ni en los 15 s previos al cron, y se comparte su lock para no navegar el portal a la vez. Con la pestaña oculta o fuera de la página no se pide nada.
- Antes de habilitar producción se debe aplicar la migración, comprobar Chromium y ejecutar una sincronización manual. El éxito local del build no demuestra que Auth0 acepte una credencial en producción.

## Operación

1. Aplicar migraciones con `npm run db:migrate`.
2. Confirmar `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser` en el contenedor.
3. Configurar las credenciales desde `/flota/monitoreo` o mediante variables server-only.
4. Ejecutar “Actualizar ahora” y revisar vehículos vinculados, no vinculados y hora de captura.
5. Activar la automatización solo después de una sincronización manual exitosa.
6. Ante `ONWAY_INTERACTIVE_AUTH_REQUIRED`, usar «Resolver verificación» en Monitoreo GPS: la persona resuelve el CAPTCHA/OTP en la vista asistida y la sesión queda en memoria para la siguiente sincronización. No programar reintentos agresivos.

---

## Enmienda 2026-11-25: sesión persistente y resolver automático

### Qué cambia

Dos afirmaciones de este ADR dejan de ser ciertas tal como estaban escritas:

1. «No se guardan cookies […] Las cookies viven únicamente en el contexto de navegador en memoria.»
2. «Una verificación interactiva (CAPTCHA u OTP) no se resuelve automáticamente.»

Ambas se sustituyen por lo siguiente. El resto del ADR sigue vigente.

### Por qué

El cron de OnWay corre cada 5 minutos y hasta hoy cada corrida creaba un contexto
de navegador nuevo. Auth0 emite el desafío según la confianza acumulada del
navegador, así que un contexto sin historial lo recibe casi siempre: medido en
`referencia-resolver-onway`, con el perfil ya confiable la mayoría de las
consultas «pasan con un click y sin desafío», y sin él el desafío escala a
imágenes de forma sistemática. El resultado fue el ciclo del 2026-11-22: 2 873
corridas fallidas seguidas y el GPS detenido hasta que alguien resolvía a mano.

Enmendar el perfil persistente no es una optimización: es lo que evita que el
cron destruya en cada corrida la confianza que una persona consiguió resolviendo
el CAPTCHA.

### Sesión persistente (reemplaza «las cookies viven solo en memoria»)

- Se persiste **`storageState`** (cookies + localStorage) en
  `/data/onway-profile/<sha256-credenciales>.storage-state.json`, en un volumen
  Docker propio (`bodega-onway-profile`), **fuera de `bodega-storage`**: no viaja
  en los respaldos porque son cookies de un portal de terceros.
- Permisos `0600` en el archivo y `0700` en el directorio. El nombre deriva del
  hash de las credenciales, así que cambiarlas abre una sesión limpia. Rotación
  manual: borrar el archivo (`resetOnwayProfile`) y volver a resolver el desafío.
- El impacto de una filtración se acota porque el archivo no sale del host, no se
  respalda y la credencial que protege está en `system_settings` cifrada con el
  llavero AES-GCM existente.
- Se guarda **sólo cuando el portal confirma la sesión** (snapshot leído o
  verificación resuelta por una persona); nunca un contexto a medio autenticar.
- Es best-effort: si el volumen no está montado, la lectura del portal sigue y
  se pierde únicamente el beneficio entre corridas.

### Resolver automático (reemplaza «no se resuelve automáticamente»)

- Sólo aplica al **reCAPTCHA v2 de imágenes**, que es lo que Auth0 presenta hoy
  en este tenant. El repertorio del clasificador son las 14 clases del modelo
  `DannyLuna/recaptcha-classification-57k`; una consigna fuera de ellas, un OTP o
  un widget distinto (hCaptcha, Arkose, audio) **no se intentan** y se entregan a
  una persona.
- Es local: el modelo corre con `onnxruntime-web` (WASM) dentro del contenedor.
  Ninguna imagen ni audio sale del servidor.
- Está **apagado por defecto** (`ONWAY_CAPTCHA_SOLVER=false`): cada rechazo
  degrada la confianza del perfil y el referente documenta que insistir la hunde.
  Se enciende sólo con evidencia de que mejora el resultado.
- Ante cualquier fallo —modelo ausente, desafío no reconocido, rechazo, bloqueo
  de Google— el flujo **degrada exactamente al comportamiento anterior**: la
  vista asistida de una persona con `flota:manage_gps`. El solver nunca declara
  éxito por su cuenta; la sesión se confirma con la misma señal estricta que ya
  usa la vista (`/OnlineTracking*` sin el botón de entrada visible).
- Una verificación abierta por una persona tiene prioridad absoluta: el solver no
  toca la página que esa persona está usando.
- `ONWAY_CAPTCHA_BLOCKED` (aviso de Google por consultas automatizadas) abre una
  cuarentena de 6 h en la que no se intenta nada, para no alargar la sanción.

### Licencia del modelo

El ONNX declara **AGPL-3.0** en sus metadatos. Por eso no se embarca en la
imagen: se descarga con `docker compose run --rm install-onway-vision-model` a
un volumen de sólo lectura, verificando su sha256. Uso interno; revisar antes de
distribuir o de ofrecer el producto como servicio.

### Consecuencias de la enmienda

- Reiniciar el contenedor ya **no** obliga a resolver el CAPTCHA otra vez.
- El volumen `bodega-onway-profile` no se respalda a propósito. Perderlo se
  recupera resolviendo el desafío una vez, no restaurando un archivo.
- El consumo de memoria del clasificador (~700 MB de RSS medidos en musl) se
  suma al del navegador durante el desafío, y sólo entonces.
- Sin el modelo instalado, `ONWAY_CAPTCHA_SOLVER=true` no hace nada y el sistema
  se comporta como antes del 2026-11-25.
