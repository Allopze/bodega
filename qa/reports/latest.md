# Retiro del módulo antiguo de mantenciones — 31 de octubre de 2026

## Resultado

La implementación retira las rutas, pantallas, servicios, permisos operativos, procesos automáticos, indicadores y tablas del módulo antiguo. Se preservan el módulo nuevo (`/mantencion/*`, `/m/mantencion`, tablas `mant_*`, `storage/mantencion/`) y las mantenciones de TI (`/ti/mantenciones`). La migración 0365 fue generada y verificada; **no se aplicó en producción**.

## Verificación de datos antes de retirar el esquema

Consulta de solo lectura en producción, con `default_transaction_read_only=on`, repetida antes de generar la migración:

- Las siete tablas antiguas (`maintenance_plans`, `maintenance_records`, `maintenance_tasks`, `maintenance_parts`, `maintenance_labor`, `maintenance_documents`, `maintenance_document_policies`): **0 filas cada una**.
- Referencias de auditoría, estados, adjuntos, notificaciones, egresos `egreso_mantencion`, reglas/alertas OnWay, eventos operacionales y anomalías: **0**.
- `/data/storage/mantenciones` en el volumen activo: **no existe; 0 archivos**.
- Persistían 4 permisos antiguos, 11 concesiones a roles y un ajuste `module.enabled:mantenciones`. Son configuración de acceso, no historial operativo. La migración elimina el ajuste del módulo; `RETIRED_PERMISSION_NAMES` limpia permisos y concesiones cuando se ejecute `db:sync-rbac` en el despliegue. No se ejecutó ese comando contra producción.

## Cambios cubiertos

- Se eliminaron `/mantenciones`, `/api/mantenciones`, servicios y cron antiguos. Inspecciones y CAPA mantienen su ciclo, pero ya no crean OTs antiguas; OnWay conserva solo CAPA como destino.
- Se quitaron los OTs y costos antiguos de flota, analítica, tableros, exports y control operacional. Se retiró `egreso_mantencion` de la validación de movimientos de inventario.
- La migración 0365 elimina las siete tablas con `DROP TABLE IF EXISTS`, endurece las restricciones de movimiento y OnWay y retira el ajuste del módulo. No se editó ninguna migración previa ni el journal a mano.
- Se actualizaron navegación, registry, manifests, route ownership, toggles, ayudas, fixtures y pruebas. Los nombres de permisos antiguos permanecen solo en la lista explícita de limpieza RBAC.

## Comprobaciones deterministas

| Comprobación | Resultado |
|---|---|
| `npm run typecheck` | **Pasa** |
| `npm run lint` | **Pasa** |
| `npm run db:generate` después de generar 0365 | **Sin cambios de esquema adicionales** |
| `npm run db:verify-migrations` | **Pasa**: 366 entradas hasta `0365_tricky_fixer`, checksums y SQL verificados |
| PGlite de retiro | **4/4 pasan**: registry/permisos, siete tablas, tipo de movimiento y restricción OnWay |
| PGlite de inspección/CAPA | **1/1 pasa** |
| PGlite de limpieza RBAC | **12/12 pasan** |
| `npm run test:fast` completo | **15.606 pasan, 2 fallan**. `backup-env-whitelist.test.ts` detecta variables VisionLink presentes en Compose y ausentes de la whitelist; no se cambiaron esas variables en esta rama. `inspection-run-detail.test.tsx` falló solo bajo la corrida completa y pasó aislado (11/11). |
| `npm run test:pglite` completo | **Incompleto**: detenido después de un ciclo de `TimeoutOverflowWarning` que convierte timers mayores al límite de 32 bits en intervalos de 1 ms y satura la salida/CPU. Las suites PGlite de este cambio sí pasaron dirigidas. |

## Recorrido de navegador

`npm run test:e2e` corrió Chromium, con un worker, contra el contenedor de prueba desechable `bodega-e2e-postgres` y su base `bodega_e2e` en el puerto 55432. No apuntó a producción.

La suite completa descubrió 1.007 pruebas. Se interrumpió tras 33,6 minutos cuando el caso RE-20 dejó de avanzar por más de tres minutos:

- **727 pasaron**, **4 se omitieron**, **1 quedó interrumpida**, **272 no alcanzaron a correr**.
- Se informaron tres fallos en la corrida completa: Chromium se cayó al esperar `networkidle` en `/ti/reportes`; el test del catálogo de vehículos no encontró el fixture `E2E-FUEL-1`; y la prueba nueva del retiro contó como fallas cancelaciones `net::ERR_ABORTED` de precargas RSC al navegar. La prueba de retiro se corrigió según el patrón ya usado en otros E2E y se repitió enfocada: **1/1 pasa**.
- En el caso de retiro se verificaron 404 para `/mantenciones` y `/api/mantenciones/documentos/legacy-id`, y disponibilidad/título para `/mantencion/panel` y `/ti/mantenciones`. El test encontró cero errores de consola, cero errores de página y cero fallas de red distintas a cancelaciones de precargas RSC (`_rsc` + `net::ERR_ABORTED`).
- El caso RE-20 de seguimiento no permitió decidir si existe un defecto; el recorrido se interrumpió antes de una reproducción aislada. El conjunto completo tampoco permite afirmar ausencia de errores de consola para todas las rutas. La prueba enfocada del retiro comprobó cero errores de consola y de página antes de fallar en cancelaciones de precarga.
- Las rutas `/mantencion/*`, `/m/mantencion` y `/ti/mantenciones` aparecen en el recorrido de accesibilidad y sus pruebas de flujo del módulo nuevo y TI pasaron. Esto cubre las rutas descubiertas y ejecutadas, no todos los estados posibles.

### Clasificación de hallazgos del navegador

| Tipo | Hallazgo |
|---|---|
| Automation warning / cobertura incompleta | El proceso Chromium se cayó en `/ti/reportes`; no hubo evidencia suficiente para declararlo un defecto del producto. |
| Functional finding por confirmar | El fixture `E2E-FUEL-1` no apareció en el catálogo de vehículos. El test no llegó a editar/desactivar/reactivar; necesita reproducción aislada. |
| Automation warning corregido y verificado | Las cancelaciones RSC (`_rsc` + `net::ERR_ABORTED`) durante navegación normal se excluyen de la captura; otras fallas siguen reportándose. El E2E enfocado pasa. |
| Cobertura incompleta | Se detuvo durante RE-20; 272 pruebas no corrieron y una quedó interrumpida. |

## Pendientes para el despliegue

1. Repetir la lectura de solo lectura de tablas, referencias y archivos antiguos inmediatamente antes del despliegue. Si aparece un registro o archivo, detener la migración y resolver su destino.
2. Ejecutar `db:migrate` en el despliegue autorizado y, después, `db:sync-rbac` para retirar los cuatro permisos y sus concesiones existentes. Esta implementación no migró ni eliminó datos de producción.
3. Repetir el E2E enfocado `e2e/legacy-mantenciones-retired.spec.ts`; hacer una nueva corrida completa del E2E cuando el servidor de pruebas esté disponible y revisar los dos hallazgos ajenos al cambio.
4. No considerar aplicadas las migraciones ni activos los cambios en producción hasta verificar el despliegue y el recorrido autenticado allí.
