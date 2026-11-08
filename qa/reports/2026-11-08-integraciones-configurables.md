# QA: integraciones configurables desde la plataforma (2026-11-08)

Rama `feat/integraciones-configurables`, en el worktree `bodega-wt/integraciones-config`.

Cinco integraciones que hasta ahora solo se configuraban por `.env` pasan a configurarse desde la plataforma. El `.env` queda como respaldo y los secretos se guardan cifrados en `system_settings`:

| Integración | Pantalla | Permiso |
|---|---|---|
| Talana: token y modo | `/admin/talana` › Configurar | `admin:talana_settings` (nuevo, solo administrador) |
| Copec: usuario, clave, RUT, interruptor e importador | `/combustibles/ajustes/integraciones` | `combustibles:manage_integrations` |
| VisionLink: client id, secret, scope e interruptor | `/combustibles/ajustes/integraciones` | `combustibles:manage_integrations` |
| Resend: API key | `/admin/correo-smtp` | `admin:smtp` |
| Interruptor de facturas de venta | `/facturacion/sincronizacion` › Automatización | `billing:manage_sync` |

**Además:**
- La rotación del llavero (`rotateDteSettingsKeyring`) ahora vuelve a cifrar todos los secretos registrados en `lib/services/settings-secret-keys.ts`. Antes OnWay y Cloudreve quedaban fuera y se habrían vuelto ilegibles al retirar una clave.
- El DTE usa el campo de credencial compartido.

## Puertas deterministas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run test:fast` | OK: 1296 archivos y 19 583 pruebas. La primera corrida marcó `server-action-error-boundaries` por un `x instanceof Error ? x.message` que solo iba al log del servidor; se reemplazó por `String(err)`. |
| `npm run test:env-dsn` | 19 582 de 19 583. La que falla es `prevencion/inspecciones/plantillas/_components/templates-panel.test.tsx` (ver «Automation warning»). |
| `npm run test:pglite` | OK: 367 archivos y 4721 pruebas, incluida la suite nueva `encrypted-settings-pglite`. |
| `npm run db:verify-migrations` | OK; esta rama no trae migraciones. |
| `npm run check:secrets` | OK |
| `npm run test:e2e` (incluye `next build`) | 1111 pasan, 5 omitidas y 1 falla: `servicios-costo-pendiente` (ver «Automation warning»). Sobre la misma build, esa spec y la nueva `talana-configuracion` (2 pruebas) pasan 3/3. |

## Recorrido de navegador

Se hizo con Playwright contra el dev en :3002 y `bodega_dev`.

`bodega_dev` no tiene llavero: la variable `DTE_SETTINGS_KEYRING` está vacía en `.env.local`. Por eso se recorrió dos veces:

1. **Sin llavero (el estado real del dev):** el campo del token de Talana queda deshabilitado y el aviso lo explica. Es el comportamiento esperado.
2. **Con un llavero desechable**, que existió solo en el proceso del dev de :3002 y nunca quedó en un archivo del repo: 22 de 23 comprobaciones pasan.

### PASS

**Talana**
- El diálogo parte con el token vacío y dice «Del servidor (.env)».
- «Probar conexión» respondió con el token real. Hizo una sola consulta, de solo lectura.
- Un token falso (`QA_FAKE_…`) queda «Guardado en la plataforma» y no aparece en ningún HTML, payload RSC ni respuesta JSON.
- «Restaurar» vuelve a «Del servidor (.env)».

**VisionLink y Copec**
- Hay dos botones «Configurar».
- Los campos secretos de Copec parten vacíos.
- Un secreto falso de VisionLink queda guardado y no vuelve al navegador. «Restaurar» lo borra.

**Resend**
- Se muestra «Origen de la clave API», ya sin el prefijo de la clave.
- Una clave falsa queda guardada y no vuelve al navegador.
- «Restaurar» la deja en «Sin configurar», porque el dev no tiene `RESEND_API_KEY`.

**Facturas de venta**
- El interruptor queda guardado (de apagado a encendido) y se restaura.

**Auditoría**
- `/admin/auditoria` muestra «Configuración Talana / Resend / VisionLink».
- En `bodega_dev`, ninguna fila de auditoría contiene los secretos falsos.

**Permisos** (usuario temporal `QA_` con rol `secretaria`)
- Ve `/admin/talana` sin «Configurar».
- `/admin/correo-smtp` y `/combustibles/ajustes/integraciones` lo mandan a `/forbidden`.

**Errores**
- Consola sin errores.
- Ninguna respuesta 5xx en el log del servidor.
- El log no contiene ningún valor falso.

**Limpieza**
- En `bodega_dev` no quedó ningún ajuste guardado por el recorrido.
- Se borraron el usuario temporal y el llavero desechable.

### AUTOMATION WARNING

- **Red:** cinco peticiones terminaron en `net::ERR_ABORTED` (GET de páginas y un POST en combustibles), y el servidor registró «The destination stream errored while writing data». Las provocan las recargas del script, que cortan el `router.refresh()` que hace cada diálogo al guardar. No es un defecto del producto: después de cada acción el estado en la base es el esperado.
- **E2E inestable:** `servicios-costo-pendiente.spec.ts` falló una vez en la corrida completa. La fila de la solicitud nueva no apareció en la lista de compras dentro del plazo de 5 s. Volvió a pasar sola sobre la misma build. Esta rama no toca solicitudes ni compras, y la spec nueva de Talana corre después de ella en el orden alfabético.
- **Prueba inestable:** `templates-panel.test.tsx` falló una vez en `test:env-dsn` con la máquina cargada. Pasó en las otras dos corridas completas y 3 de 3 veces sola, y esta rama no toca ese archivo.

## COVERAGE GAP

- **Producción:** no se probó. Después del deploy hay que confirmar que producción tiene `DTE_SETTINGS_KEYRING` con una clave activa. Si no la tiene, las pantallas lo avisan y no dejan guardar secretos, aunque el interruptor y el modo sí se guardan.
- **«Probar conexión» de Copec y VisionLink:** no se ejecutó contra los proveedores reales. Lo cubren pruebas unitarias con mocks.
- **Copec, más allá de abrir el diálogo:** no se guardaron credenciales ni se recorrieron la validación del RUT o del usuario importador en navegador. Lo cubren pruebas unitarias.
- **Modo «Aplicar» de Talana:** la confirmación se verificó en la spec E2E nueva (`e2e/talana-configuracion.spec.ts`) y en las pruebas del diálogo. No se guardó «Aplicar» en el dev.
