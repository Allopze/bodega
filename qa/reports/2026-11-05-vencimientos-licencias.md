# QA: vencimientos de flota, licencias de conducir y cargos (2026-11-05)

Rama `feat/vencimientos-licencias`. Plan: reemplazar la planilla
`Control_vencimientos_Chome_consolidado.xlsx` por Flota y una pantalla nueva de
Conductores, con avisos y clasificación de cargos.

## Alcance verificado

| Verificación | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK (0 errores; el único aviso nuevo se corrigió) |
| `npm run test:fast` | 18 724 OK. Fallan 4 de `lib/__tests__/oc-pdf-route-engine.test.ts` por `PDF_ORIGIN_NOT_CONFIGURED`; **también fallan en `main`**: es del entorno, no de este cambio |
| `npm run test:pglite` | 4 531 OK tras corregir un fixture del script |
| `npm run db:verify-migrations` | OK (0374) |
| `npm run check:secrets` | OK |
| `npm run doctor` | 67/100, igual que la base. Los 3 errores son previos (`components/mantencion/app/*`); los archivos nuevos solo tienen avisos de tipos que el repo ya tiene por centenares |
| E2E completa (chromium, worktree desechable) | 1 093 OK, 6 omitidas, 1 falla: el menú del área esperaba 17 destinos y ahora son 18. Spec corregido y vuelto a correr |
| E2E dirigida tras los arreglos | 42/42 OK: `control-operacional-navegacion`, `flota-conductores`, `flota-documentos`, `trabajadores-clasificar` |
| Navegador (Playwright, `bodega_dev` con la carga aplicada, :3002) | 7 vistas × 1440 y 390 px: 0 errores de consola, 0 requests fallidos, 0 desbordes horizontales |
| axe (WCAG 2 A/AA, serious/critical) | 1 hallazgo, ya corregido (ver abajo) |

Vistas recorridas: `/flota?vencimiento=proximos`, `/flota/[id]` con la hoja
«Actualizar vencimientos» abierta, `/flota/conductores` (atención y todos),
`/flota/conductores?editar=…`, `/admin/trabajadores?vista=sin-cargo` y
`/admin/cargos`.

## Carga de la planilla en `bodega_dev` (clon de producción del 2026-11-02)

El dry-run, el apply y la segunda corrida (0 por aplicar, 189 «ya estaba») se
hicieron en ese orden. Resultado:

- 15 equipos nuevos: 9 carros y 6 bateas, sin combustible. BPDH-67 no se creó: se corrigió la patente del registro DPDH-67, que conserva sus 7 mantenciones y los mapeos de Copec.
- 7 equipos cambiados de faena y 3 tractos con su código corregido.
- 38 equipos con SOAP, permiso y revisión técnica. JFDB-89 (KA-120) viene sin fechas en la planilla.
- 13 cargos en el catálogo; 32 trabajadores clasificados, 2 de ellos creados (Horcones).
- 32 licencias registradas. «Sin clasificar» bajó de 116 a 86.

## Hallazgos

### PRODUCT BUG: corregidos

1. Los avisos de vencimiento de flota ignoraban las fechas guardadas en el equipo y rotulaban mal el documento. Corregido, con prueba PGlite.
2. En el formulario de vehículo no se podían borrar una fecha ni un código. Corregido.
3. axe `link-in-text-block` en la ficha del equipo: el enlace «Órdenes de trabajo» se distinguía solo por el color. Ya existía en `main`; ahora queda subrayado.

### PRODUCT/DATA: a resolver por el usuario

- **Planilla, Trabajadores, fila 7:** su RUT repite el de la fila 6. El script identificó a la persona por su nombre y le cargó la licencia, pero hay que corregir el RUT en la planilla.
- **Copec:** las tarjetas TCT diésel y Bluemax de BPDH-67 siguen informando la patente «DPDH67». El mapeo sigue funcionando; conviene corregir la patente en Copec.
- **Datos que faltan:** marca, modelo y año de los 15 carros y bateas, que se crearon sin esos datos.
- **Conductores con clase insuficiente para «Conductor de camión»:** 2, de Horcones. Uno tiene A1, A2, B y D; el otro solo A2.
- **Licencias vencidas según la planilla:** 3. Una de ellas tiene la observación «LEY 21.806».

### UX: diferido, no bloqueante

- En móvil, el nombre del conductor ocupa dos líneas porque comparte el ancho con la pastilla de estado. Se lee bien.
- `DatePicker` avanza mes a mes. La hoja de licencias suma atajos «en 1, 4 o 6 años»; un selector de mes y año en el primitivo los haría innecesarios.

### AUTOMATION WARNING

- La primera pasada del recorrido envió el login antes de la hidratación, y el formulario salió por GET. El script de recorrido ahora espera la hidratación; ver «Seguridad».

## Brechas de cobertura

- No se corrieron los proyectos `mobile-safari` ni `mobile-chrome` (`E2E_MOBILE_BROWSERS=1`). La vista móvil se revisó a 390 px en chromium.
- Las mutaciones (guardar, quitar y asignar en bloque) se verificaron por E2E, no a mano en el recorrido.
- El envío real de correos de los avisos no se verificó: las pruebas comprueban la notificación creada, no el SMTP.
- Producción no se tocó: falta deploy, migración 0374, `sync-rbac` y el script en dry-run y luego apply con autorización.

## Seguridad

En la primera pasada, el formulario de login salió por GET y la credencial del
usuario QA apareció en la salida de la terminal de la sesión. Se borró del log
del servidor de desarrollo (`.next/dev/logs`, log del scratchpad). **Conviene
rotar la contraseña del usuario QA.**
