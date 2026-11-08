# QA — Sincronización con Talana (lectura), 2026-11-08

Rama `feat/talana-sync` (worktree `bodega-wt/talana-sync`). Pruebas contra `bodega_dev`, que es un clon de producción con la nómina ya aplicada el 2026-11-06, y contra la API **real** de Talana, usando solo GET.

## Alcance

- Sincronización: cliente, verificación de descarga completa, fusible, planificador, aplicación por persona, avisos, ruta del cron y CLI de desarrollo.
- `/admin/talana`: estado, Diferencias, Cambios, Corridas y exportación a Excel.
- `/admin/trabajadores`: chips de Talana en la lista y panel «Datos de Talana» en la ficha.
- Permiso nuevo `admin:workers_hr`: navegación y control de acceso.

## Puertas deterministas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run check:secrets` | OK |
| `npm run check:security-audit` | OK, sin hallazgos altos ni críticos |
| `npm run test:fast` | OK: 1280 archivos y 19 272 pruebas |
| `npm run test:env-dsn` | OK |
| `npm run test:pglite` (completa) | OK: 366 archivos y 4713 pruebas |
| `npm run db:verify-migrations` | OK, cadena verificada hasta 0383 |
| `npm run test:e2e` (incluye `next build`) | 1109 pasan, 5 omitidas y 1 falla preexistente, que se corrigió (ver abajo). Después del arreglo, `shell-landmarks` y `ti-modulo` pasan 12/12. |

### Fallas preexistentes de main, corregidas en esta rama

Las dos vienen del commit de TI `b234379cc` y no tienen relación con Talana:

- `lib/auth/sensitive-permissions.test.ts` esperaba 4 permisos sensibles. TI agregó `ti:reverse_retirement` de forma deliberada y documentada, así que la prueba pasa a esperar 5 y verifica ese permiso.
- `e2e/shell-landmarks.spec.ts` usaba `/ti/activos` como ejemplo de lista con el buscador del shell. Desde la auditoría de TI, esa lista busca en servidor con su propio input y está en `ROUTES_WITH_OWN_SEARCH`. La prueba ahora usa `/ti/licencias`, que sí filtra con el buscador del shell.

## Corrida real en desarrollo

1. **Simulación:** 375 contratos, 107 activos, 0 rechazados, 4 ausencias.
   - Ningún cambio, porque `bodega_dev` ya tenía la nómina aplicada.
   - 3 omisiones `cargo_distinto`: Chome conserva su cargo.
2. **Aplicación:** ninguna ficha cambia y la auditoría no se mueve (6480 → 6480). Se escriben los marcadores (107 activaciones y 110 finiquitos) y 107 bases.
3. **Segunda aplicación:** no hace nada; las omisiones ya no se repiten.

Se confirmaron dos reglas con datos reales:
- Los 2 contratos a plazo vencidos sin finiquito no provocaron ninguna baja.
- Los finiquitados que siguen inactivos en Chome solo quedaron marcados como procesados.

## Recorrido de navegador (Playwright, dev en :3002, `TALANA_SYNC_MODE=simulate`)

### PASS

- `/admin/talana` carga: título en el TopBar, aviso «Modo simulación», 3 pestañas con contadores y 13 diferencias. La URL lleva `?vista=cambios` y `?vista=corridas`.
- «Exportar Excel» descarga `talana_2026-11-08.xlsx` con las hojas Diferencias, Cambios de la última corrida y Metadatos.
- A 390 px de ancho no hay scroll horizontal.
- El foco es visible con teclado.
- Trabajadores muestra los chips «Plazo vencido el …» y «Licencia médica hasta …», 4 en el payload.
- La ficha muestra el panel «Datos de Talana» con contrato, término, centro de costo, cargo, jefe y ausencia.
- Sesión QA_ con solo `solicitante_faena` (Biodiversa):
  - `/admin/talana` redirige a `/forbidden`;
  - Trabajadores carga **sin** datos de Talana ni en el HTML ni en el payload RSC;
  - «Sincronización Talana» no aparece en Administración.
- Consola sin errores. Ninguna respuesta 4xx ni 5xx.

### AUTOMATION WARNING

- 2 a 4 peticiones RSC terminan en `net::ERR_ABORTED`. Ocurren al cambiar de pestaña o de página rápido: cada `router.replace` cancela el anterior. No es un defecto del producto.

### UX FINDING (corregidos en la misma pasada)

- El chip de licencia ocupaba tres líneas en la columna Estado. Ahora va bajo el nombre, en una línea.
- «Término» repetía el estado tres veces. Ahora usa una sola pastilla con frase, y no aparece para un indefinido vigente.
- El jefe aparecía en mayúsculas tal como viene de Talana. Ahora se muestra con formato de nombre propio.

## COVERAGE GAP

- **No se ejercitó con los datos de producción.** En prod la nómina nunca se aplicó, así que la primera corrida hará muchos cambios. Por eso se arranca con `TALANA_SYNC_MODE=simulate` y se revisa una vez.
- **No se recorrieron con datos reales** los estados de fusible disparado ni el «Rearmar fusible»; se cubren con pruebas unitarias y PGlite.
- **El cron de docker-compose no se ejecutó.** Se cubren `cron-runner.test.ts` y `deploy-workflow.test.ts`.
- **Avisos por correo:** se probaron con mocks; no se envió ninguno.
