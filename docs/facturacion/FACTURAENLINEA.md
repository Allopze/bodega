# FacturaEnLínea

## Qué es

`clientes.dtefacturaenlinea.cl` es el portal del emisor de DTE de Chome. **No
tiene API.** La integración es scraping HTTP autenticado por query string.

## Decisión tomada: encapsular y ampliar

No se reemplazó ni se reescribió. Se envolvió detrás de `FacturaEnLineaProvider`
y se le agregó la capacidad de **ventas**, que el portal ya exponía y el código ya
sabía consultar pero nadie sincronizaba.

| Alcance | Endpoint | Estado |
|---|---|---|
| Compras (recibidas) | `PNC_PanelCorreo.php` (Bandeja de Entrada) | Ya operaba para el módulo de Compras. **Sin cambios.** |
| Ventas (emitidas) | `paneldte.php?rlib=ven` | **Nuevo.** Insumo de las cuentas por cobrar. |

## Modelo de acceso

- Sin sesión: `rut_usr`, `rut_emp` y `clave` viajan en **cada** petición. No hay
  cookie ni token.
- **TLS legacy**: el servidor solo negocia TLS 1.2 con `SECLEVEL=0`. El cliente
  pasa un `dispatcher` de `undici` con esa configuración. El certificado sí
  valida: no se usa `rejectUnauthorized: false`.
- Respuestas en ISO-8859-1.
- Sin paginación: el portal devuelve el período completo en una respuesta
  (verificado con 681 documentos). Si eso cambiara, el sync lo detecta comparando
  el total declarado con las filas recibidas y deja la corrida como `partial`.

## El problema del RUT del cliente, y cómo se resuelve

**El listado de ventas no trae el RUT del receptor**, solo la razón social
(`parser.ts` deja `rutEmisor: null`). Sin RUT no hay identidad tributaria ni
cruce con el maestro de clientes.

Solución implementada: cuando falta el RUT, el adaptador **descarga el XML del
documento** y lo lee con `lib/services/billing/dte-xml.ts`. El XML aporta además:

- `FchVenc` — el **vencimiento declarado** por el propio documento. Es la única
  fuente externa de vencimiento que existe; sin ella "vencida" sería una
  inferencia.
- `MntExe` — monto exento, que el listado no separa.
- Los ítems reales de la factura.

Tope de 120 descargas por corrida (un mes de ventas son ~45 documentos). El
adaptador ordena candidatos por una clave determinista y persiste un cursor por
`provider/scope/período`; el siguiente cron retoma la cola sin perder el
documento 121 ni avanzar tras una persistencia fallida. Lo que quede sin
resolver **no se inserta con un RUT inventado**: la corrida queda `partial`.

## Fragilidad inherente — y qué la contiene

El scraping depende del HTML del portal. Cualquier rediseño lo rompe. Mitigaciones:

| Riesgo | Contención |
|---|---|
| Cambia la estructura de la tabla | Fixtures HTML reales en `dte-portal/__tests__/fixtures/`; el parser descarta filas que no entiende y avisa por consola. |
| Cambia el total declarado vs. filas | El sync marca la corrida `partial` y lo escribe en `error_summary`. |
| Sesión o credenciales inválidas | `DtePortalError` con código `AUTH_FAILED`; el health check lo muestra sin exponer la clave. |
| Corridas concurrentes | Índice único parcial: una sola corrida activa por período. |
| Fuga de credenciales en logs | `redact()` en el adaptador y en el sync; el logger además enmascara RUT y correos. |

## Credenciales

Los campos sensibles de `system_settings` se guardan en sobres
`enc:v1:<kid>:<iv>:<tag>:<ciphertext>` con AES-256-GCM, IV aleatorio de 96 bits
y AAD ligada a la clave del setting. El keyring vive sólo en `app` mediante
`DTE_SETTINGS_KEYRING` / `DTE_SETTINGS_ACTIVE_KEY_ID`; Administración recibe
solamente presencia, origen y estado de cifrado, nunca valores efectivos.

Durante el release compatible puede existir fallback `DTE_PORTAL_*`. La acción
confirmada de conversión deja una barrera durable `encrypted_only`, deshabilita
la sincronización y evita que un clear/reset reviva plaintext. La conversión y
el re-cifrado del keyring conservan los mismos RUT, contraseña, CodEmp e
importer; no cambian credenciales en FacturaEnLínea. El procedimiento de
producción está en
[DTE_SYNC_OPERACION_SEGURA.md](DTE_SYNC_OPERACION_SEGURA.md).

## ¿Puede Chipax reemplazarlo?

Solo para la **lectura** de documentos, y solo después de verificar contra su
contrato real que entrega los mismos campos. La emisión seguiría en el portal en
cualquier escenario. Hoy la pregunta no se puede responder: ver [CHIPAX.md](CHIPAX.md).
