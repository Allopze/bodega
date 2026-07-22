# Auditoría Integral — Plataforma Chome

**Fecha:** 2026-07-17

**Auditor:** Codex, auditor senior de código

**Checkout auditado:** árbol de trabajo local de `/home/allopze/dev/chome/bodega`

**Decisión de salida:** **NO-GO para producción sin restricciones** hasta revalidar los fixes P0/P1 en staging. *(Actualizado a la Pasada 10: la revalidación contra PostgreSQL real y el restablecimiento de los gates de integración —E2E global + gate de CI— ya se completaron localmente; sólo falta la evidencia que requiere un host de staging real: deploy/rollback por digest y captura de Sentry con DSN productivo.)* La bitácora inferior distingue código corregido de evidencia operativa todavía pendiente.

**Método:** inspección estática exhaustiva por superficies, trazado con CodeGraph, contraste con documentación vigente, build de producción, unitarias, cobertura, E2E completa, pruebas PostgreSQL reales, auditoría de dependencias y revisión de artefactos de bundle.

**Regla de certeza:** cada hallazgo indica si fue confirmado por código, build o ejecución. Los escenarios que requieren entorno productivo o una decisión de política aparecen aparte y no se contabilizan como defectos.

Los bloques de problema/reproducción bajo cada hallazgo conservan la evidencia de línea base; el estado vigente después de las remediaciones se consolida en la matriz de cierre más abajo.

## Bitácora de remediación

### Pasada 1 — autorización cross-faena, descargas y RBAC (2026-07-17)

Se aplicaron estos cambios en el checkout:

- **CHO-001:** el export Excel de trabajadores aplica `worksiteScopeSql` desde la sesión; el import valida IDs existentes dentro del scope, exige una faena destino existente y accesible para nuevas filas y vuelve a comprobar el scope en el `UPDATE ... RETURNING`.
- **CHO-002:** la activación masiva de vehículos resuelve la sesión, deduplica IDs, exige que todos pertenezcan al scope y usa la cantidad real retornada. La importación de cargas valida permisos de creación y destinos antes de crear faenas, conserva el scope de faenas creadas y registra el scope del vehículo autocreado. La vinculación de consumos rechaza vehículos cuya `worksiteId` no coincide con la faena del lote.
- **CHO-003:** las rutas de descarga de cotizaciones de repuestos y servicios ahora exigen propiedad cuando el usuario no tiene `view_all`, manteniendo respuesta 404 para no enumerar archivos.
- **CHO-006:** la validación de permisos usa `inArray` con IDs únicos y el formulario envía el slug de un rol protegido mediante un campo hidden.

**Verificación de esta pasada:** `npm run typecheck` aprobado; 3 archivos de test y 16 tests aprobados. No se han ejecutado todavía pruebas de integración cross-faena contra PostgreSQL ni una prueba real de las rutas de descarga/importación.

**Faltante al cierre de la pasada:** añadir pruebas negativas rol × faena para CHO-001/002/003 y cubrir el servicio RBAC contra PostgreSQL.

### Pasada 2 — concurrencia, deploy y carga de archivos (2026-07-17)

Se aplicaron estos cambios:

- **CHO-004:** `issueOrder`, `markOrderSent`, `cancelOrder`, `confirmOrder`, `closeOrder` y `registerReceipt` leen la OC con `SELECT ... FOR UPDATE`, serializando transiciones y recepciones sobre la misma fila.
- **CHO-005:** la rama `egreso_desecho` bloquea la fila de `worksite_stock` antes de calcular y escribir el saldo, evitando que dos desechos sobrescriban el mismo `stockAfter`.
- **CHO-007:** Deploy ahora espera el workflow `CI` exitoso, construye desde su `head_sha`, exporta `GITHUB_REPOSITORY`/`IMAGE_TAG`, usa `docker compose pull` válido, fuerza recreación, comprueba la imagen configurada y conserva una etiqueta local de rollback.
- **CHO-008:** el cap de Server Actions subió a `21mb` para que el límite de dominio de 20 MB sea alcanzable con overhead multipart; el límite administrable de adjuntos de soporte quedó restringido a 20 MB y el action ahora lee ese setting.
- **CHO-009:** alta de ítems, cancelación y eliminación de OC registran el estado anterior real por ítem; ya no usan el estado posterior ni un origen fijo para lotes heterogéneos.
- **CHO-011:** `createReport` inserta reporte y metadata del adjunto en una transacción; soporte escribe a un temporal, renombra después del commit y limpia el temporal si la operación DB falla.

**Verificación de esta pasada:** `npm run typecheck` aprobado; `purchasing-service.test.ts` aprobó 20 tests. `receiving-concurrency-postgres.test.ts` y `stock-concurrency-postgres.test.ts` fueron omitidos al no estar disponible la variable de base PostgreSQL real en esta sesión. El YAML de deploy fue parseado correctamente. No se ejecutó el deploy contra staging/producción.

**Faltante al cierre de la pasada:** ejecutar las pruebas PostgreSQL con los gates destructivos en CI, añadir casos específicos de `cancel vs receive` y dos `egreso_desecho`, validar el workflow en un host de staging y probar rollback/health por digest. Los temas de Sentry, UX, bundle, E2E/benchmark y documentación se abordan en las pasadas siguientes.

### Pasada 3 — observabilidad, UX, bundle, gates y documentación (2026-07-17)

Se aplicaron estos cambios:

- **CHO-010:** `instrumentation.ts` importa los config server/edge y exporta `onRequestError`; se agregó `instrumentation-client.ts`, `sentry.edge.config.ts` y captura explícita en `app/global-error.tsx`, conservando redacción de headers sensibles.
- **CHO-012:** TAE dejó cuatro controles primarios más período, movió punto/sellos/evidencia a “Más filtros (N activos)”, y usa `DatePicker`. Reportes y Analítica quedaron en cuatro KPIs accionables.
- **CHO-013:** las acciones móviles de Usuarios y el editor de stock mínimo tienen hit-area de 44 px en móvil y nombres accesibles contextuales.
- **CHO-014:** `exceljs` se importa dinámicamente solo al descargar el Excel de errores.
- **CHO-015:** cobertura incluye rutas API y actions anidadas; CI incorpora un smoke de rutas críticas además de axe.
- **CHO-016:** el benchmark siembra un tipo de equipo válido y la E2E de conciliación TAE incluye `equipment_type_id`, eliminando el fallo conocido de constraint antes de medir.
- **CHO-017:** PRODUCT/README ya no congelan el conteo de permisos/secciones, describen el TTL real de RBAC, reflejan los movimientos vigentes y corrigen el enlace a `docs/diseño/DESIGN.md`.

**Verificación de esta pasada:** `npm run typecheck` y `npm run lint` aprobados; 5 archivos focalizados de Vitest y 24 tests aprobados; React Doctor changed pasó de 86/100 a 88/100. El YAML de deploy sigue parseando correctamente. Esta pasada dejó el código preparado para los gates de ejecución, que se completan en la pasada siguiente.

**Faltante al cierre de la pasada:** ejecutar `npm run build`, `npm test`, el benchmark con PostgreSQL desechable, la E2E smoke y los casos de concurrencia con sus variables; probar DSN Sentry y deploy/rollback en staging; agregar pruebas cross-faena específicas y confirmar el tamaño first-load después del split de ExcelJS.

### Pasada 4 — gates de ejecución y cierre de evidencia local (2026-07-17)

Se cerraron los siguientes controles en este checkout:

- **Suite Vitest:** se actualizaron los mocks de recepción al contrato `SELECT ... FOR UPDATE` y se añadió `cleanup()` explícito de Testing Library. `npm run test:fast` terminó con 254 archivos aprobados, 5 omitidos, 2.338 tests aprobados y 6 omitidos. `npm test` terminó con 289 archivos aprobados, 5 omitidos, 2.617 tests aprobados y 6 omitidos.
- **Cobertura:** `npm run test:coverage` terminó con la suite completa verde y superó los umbrales: 63,09% statements, 51,16% branches, 67,85% functions y 66,37% lines. El include conserva las actions anidadas y las cuatro rutas API modificadas/auditadas, sin bajar thresholds.
- **Concurrencia PostgreSQL:** `receiving-concurrency-postgres.test.ts` pasó 1/1 y `stock-concurrency-postgres.test.ts` pasó 1/1 usando bases descartables separadas y `PGHOST=/var/run/postgresql`.
- **Benchmark:** `PERF_DATABASE_URL=postgres:///bodega_perf_test PERF_ALLOW_DESTRUCTIVE_RESET=true npm run perf:queries` completó dataset de 1.200 solicitudes, 3.600 ítems, 500 OC y 600 filas de stock. Las 11 consultas quedaron bajo el SLO de 1 s; máximo observado: stock scoped 52,5 ms.
- **Build y bundle:** `npm run build` pasó con Next.js 16.2.10/Turbopack, TypeScript y 17/17 páginas estáticas. `/combustibles/importar` quedó en 1.521.882 bytes de JS inicial y no incluye chunk de ExcelJS.
- **E2E smoke:** `npm run test:e2e -- e2e/ci-smoke.spec.ts` pasó 8/8 rutas críticas autenticadas: dashboard, solicitudes, aprobaciones, compras, recepción, combustibles, trabajadores y roles.
- **Calidad estática:** `npm run typecheck`, `npm run lint` y `git diff --check` pasaron. React Doctor changed queda en 88/100 con 24 advertencias; las restantes están clasificadas como optimizaciones o falsos positivos/decisiones de arquitectura y no se suprimieron.

**Faltante al cierre de la pasada:** no se ejecutó DSN real de Sentry, deploy/rollback contra staging, ni una E2E completa de todos los flujos. Tampoco se agregaron todavía pruebas negativas cross-faena específicas para trabajadores, vehículos, cotizaciones y roles; los fixes están cubiertos por guards y typecheck/tests focales, pero esa matriz de autorización sigue siendo evidencia pendiente.

### Pasada 5 — cierre de todo lo accionable en checkout (en curso, 2026-07-17)

Alcance iniciado:

- construir pruebas negativas cross-faena para trabajadores, vehículos, importación y cotizaciones;
- cubrir RBAC real, cancelación contra recepción, dos desechos simultáneos, historial heterogéneo y fallos de adjuntos;
- ejecutar la E2E completa y TAE, corregir fallos reproducibles y añadir los gates que puedan vivir en CI;
- automatizar checks de accesibilidad/responsive/bundle que no dependan de staging;
- mantener este documento actualizado por cada subpasada y dejar explícitos los bloqueos externos.

**Faltante al inicio de la pasada:** todo el alcance anterior queda pendiente de ejecución y validación.

#### Subpasada 5.1 — reproducción E2E completa (2026-07-17)

`npm run test:e2e` reprodujo 7 fallos y fue interrumpido después de 42 casos para evitar seguir consumiendo tiempo con timeouts de 150 s: 36 pasaron, 7 fallaron y 99 no alcanzaron a ejecutarse. Los fallos observados fueron creación de producto (diálogo `Nuevo producto` ausente), invitación de usuario, edición de vehículo, permisos/páginas de Combustibles (`/combustibles`, `/combustibles/facturas`, `/combustibles/importar`) y el formulario de nueva carga intentando rellenar un `DatePicker` que expone un input hidden. La prueba dejó trace/video en `test-results/` para los siete casos.

**Hipótesis de trabajo:** (1) varios tests usan permisos/fixtures desalineados con los manifests actuales; (2) algunos selectores E2E dependen de UI vieja (`input` visible o diálogo inline); (3) producto/usuario/vehículo contienen fallos reales de interacción o Server Action. Se aislarán con pruebas focales antes de editar tests.

#### Subpasada 5.2 — alineación de fixtures y contratos E2E (2026-07-17)

Se corrigieron defectos accionables de la propia cobertura E2E:

- el fixture admin ahora incluye `combustibles:view_costs`;
- el vehículo E2E queda asociado explícitamente a `fuel-diesel`, requisito real del update;
- el test de producto dejó de exigir un SKU editable que la UI actual genera en servidor;
- el test de invitación verifica la lista vigente de “Invitaciones enviadas”;
- el test de Combustibles usa los KPIs y encabezados actuales;
- el test de nueva carga usa el `DatePicker` canónico, no rellena su input hidden.

**Faltante al cierre de la subpasada:** validar estos cambios con Playwright focalizado y continuar con los fallos de interacción que sigan reproduciéndose.

#### Subpasada 5.3 — corrección de formulario multi-pestaña y cierre de la focalizada (2026-07-17)

La reproducción aislada confirmó un fallo funcional real en edición de vehículos: al cambiar desde la pestaña `Combustible` a `General`, Radix desmontaba los campos ocultos y el `submit` perdía `compatibleProductIds`, campo obligatorio para guardar el vehículo. Se corrigió manteniendo montadas las cuatro pestañas de `VehicleForm` con `forceMount`; permanecen visualmente ocultas, pero sus valores siguen formando parte del formulario.

También se corrigieron dos contratos E2E que apuntaban a la UI anterior: el KPI `Transacciones` usa coincidencia exacta y el detalle del resumen se valida mediante el enlace vigente `Ver N registros del período`; después de desactivar un vehículo la prueba cambia explícitamente a la pestaña `Inactivos`.

Evidencia ejecutada:

- `npm run typecheck`: verde.
- `npm run test:e2e -- e2e/catalogs-migrated.spec.ts e2e/combustibles.spec.ts --grep 'vehículos mantienen|consumption dashboard'`: **2 passed**.
- La pasada focal completa previa quedó en **18 passed, 2 failed**; los dos fallos fueron resueltos en esta subpasada y no queda fallo en esas superficies.

**Faltante al cierre de la subpasada:** ejecutar la suite E2E completa actualizada; triage de los restantes dominios; pruebas PostgreSQL específicas de `cancel vs receive`, dos `egreso_desecho`, historial heterogéneo y fallas de adjuntos; revisión final de CI, React Doctor y gates externos.

#### Subpasada 5.4 — triage de la E2E amplia y superficies administrativas (2026-07-17)

Se ejecutó `npm run test:e2e` hasta 57 casos alcanzados: **51 pasaron y 5 fallaron**, con una sexta prueba interrumpida al cortar timeouts largos. Los fallos observados fueron EPP, dos verificaciones de detalle de Flota y tres expectativas de toggles. Flota se corrigió con selectores semánticos actuales (`heading` de patente y `heading` de documentos); sus pruebas focalizadas quedaron cubiertas en la siguiente tanda.

Cambios aplicados en esta subpasada:

- fixture admin E2E: agregado `admin:module_management`, que la ruta `/admin/modulos` exige realmente;
- EPP: navegación explícita por el diálogo unificado `Importar → Equipos de protección (EPP)` y contrato de resumen vigente;
- toggles: la prueba abre el área colapsada de navegación, usa las etiquetas accesibles del `Switch`, fuerza sólo el click del control visual y recarga antes de verificar el estado reactivado, evitando leer props server-side obsoletas.

**Faltante al cierre de la subpasada:** validar estos cambios focalmente; continuar con PPA/TAE y el resto de la suite completa; cerrar pruebas de concurrencia e integración indicadas en 5.3.

#### Subpasada 5.5 — EPP, toggles y gates estáticos (2026-07-17)

EPP quedó validado focalmente: el flujo actual es `Importar → Equipos de protección (EPP) → Importar Excel → Revisar lote → Cancelar importación` y pasó tras alinear el test con ese contrato.

Se corrigió el componente base `Switch`: el contenedor `<label>` y el `<input>` exponían simultáneamente el mismo `aria-label`, lo que producía dos controles accesibles para una sola acción. El nombre queda ahora únicamente en el input.

Evidencia ejecutada:

- `npm run test:fast`: **254 archivos pasaron, 5 omitidos; 2.338 tests pasaron, 6 omitidos**.
- `npm run typecheck`: verde.
- `npm run lint`: verde.
- `git diff --check`: verde.
- `npx react-doctor@latest --verbose --scope changed`: **88/100, 24 advertencias**; no aparecieron regresiones nuevas frente a la línea base anterior. Las advertencias restantes son optimizaciones/mantenibilidad preexistentes y se mantienen documentadas, sin supresiones.
- Última ejecución focal de toggles: la página de listado pasó, pero los tests de mutación quedaron pendientes de una repetición tras el ajuste de control accesible y de la espera explícita de respuesta/reload; no se marca como evidencia verde todavía.

**Faltante al cierre de la subpasada:** repetir `e2e/module-toggles.spec.ts`; ejecutar PPA/TAE y los dominios E2E restantes; implementar/validar las pruebas PostgreSQL específicas de concurrencia y adjuntos; cerrar bundle/CI y la lista de evidencia externa.

#### Subpasada 5.6 — reproducción PPA/TAE (2026-07-17)

La ejecución focalizada de `e2e/tae-reconciliation.spec.ts e2e/tae-history-import.spec.ts e2e/tae-public-flow.spec.ts e2e/ppa-flow.spec.ts e2e/ppa-offline.spec.ts` alcanzó 5 casos PPA: 2 pasaron y 2 fallaron, con el resto sin ejecutar por timeouts largos. El fallo reproducido de autorización PPA no era un bypass: la prueba buscaba `Acción correctiva implementada`, pero la UI actual exige además acción, responsable, rol, plazo y prioridad. El rechazo apuntaba a una frase antigua del flujo y la prueba de corrección no alcanzó a enviar por el timeout de la prueba anterior.

Se alineó el test con el contrato actual: label `Acción correctiva`, responsable `Supervisor E2E`, rol `Supervisor de faena`, `DatePicker` canónico y botones semánticos de decisión. No se modifica la regla funcional de autorización; se preserva la exigencia de datos mínimos que evita crear acciones incompletas.

**Faltante al cierre de la subpasada:** validar focalmente los cuatro flujos de revisión PPA actualizados; ejecutar TAE por separado para obtener evidencia sin quedar detrás de PPA; no declarar cierre E2E global hasta resolver el resto de dominios.

#### Subpasada 5.7 — ajuste del selector de responsable PPA (2026-07-17)

La autorización focalizada volvió a reproducirse y alcanzó la validación del formulario. El único fallo restante era de selector: `getByLabel("Responsable")` resolvía tanto el input de nombre como el combobox `Rol responsable`, porque ambos comparten la relación accesible del grupo. Se cambió el test a `#responsible`, que corresponde al `id` estable del campo de texto; el combobox continúa seleccionándose por `#responsible-role`.

**Faltante al cierre de la subpasada:** repetir la autorización PPA y ejecutar rechazo/corrección; correr TAE aislado; mantener pendiente la E2E global hasta concluir el triage.

#### Subpasada 5.8 — corrección real del rechazo/corrección PPA (2026-07-17)

La suite de revisión PPA quedó en **2 pasados y 2 fallidos**: autorización y cierre pasaban; rechazo mostraba `Revisa los campos del formulario` y corrección sufrió además una navegación inestable al seleccionar el registro. El contraste del payload con `lib/validation/ppa.ts` confirmó la causa: el componente inicializa `responsibleRole` como `""`, pero el esquema sólo acepta el enum o `undefined` cuando la decisión no es autorización.

Se corrigió `ReviewPanel` para enviar `undefined` cuando no hay rol seleccionado. La regla de negocio se mantiene: sólo autorizar exige acción, responsable, rol, plazo y prioridad; rechazar/corregir no deben exigir datos de una acción que no se crea.

**Faltante al cierre de la subpasada:** repetir la suite de revisión PPA completa para validar rechazo/corrección y estabilizar la navegación del caso; ejecutar TAE aislado.

#### Subpasada 5.9 — validación de revisión PPA tras el fix (2026-07-17)

La repetición focal de rechazo y corrección pasó **2/2**; junto con la autorización y el cierre ya validados, los cuatro flujos de `PPA Digital — revisión del responsable` quedan en **4/4**. La navegación que había fallado en el caso de corrección no volvió a reproducirse al ejecutar los casos después del ajuste.

**Faltante al cierre de la subpasada:** ejecutar las superficies TAE separadamente, completar pruebas específicas de concurrencia/historial/adjuntos y repetir los gates de producción afectados por el cambio.

#### Subpasada 5.10 — triage de TAE y alineación del contrato de importación (2026-07-17)

La suite aislada `tae-reconciliation.spec.ts tae-history-import.spec.ts tae-public-flow.spec.ts` terminó **0/3** en la primera ejecución, con tres causas distinguibles:

- el fixture de conciliación no informaba `fuel_tae_submissions.product_id`, columna obligatoria;
- el flujo público dejaba el producto en “Selecciona el producto”, por lo que el botón de registro permanecía correctamente deshabilitado;
- el histórico generaba el dry-run correctamente (`971` filas válidas, `150` identidades ambiguas), pero el test buscaba un texto anterior y nunca resolvía las decisiones que el UI exige antes de importar.

Se corrigieron los dos fixtures y los tests: producto Diésel explícito en el formulario público, `product_id` en la carga de conciliación, copy actual del checkbox y selección explícita de “Sin equivalente” para cada identidad ambigua antes de confirmar. No se relajó ningún requisito de datos ni de mapeo.

**Faltante al cierre de la subpasada:** repetir los tres flujos TAE; si el histórico tarda por sus 971 filas, conservar evidencia del resultado o del punto exacto de fallo.

#### Subpasada 5.11 — TAE completo aislado validado (2026-07-17)

La repetición de `tae-reconciliation.spec.ts`, `tae-history-import.spec.ts` y `tae-public-flow.spec.ts` pasó **3/3** en 2,2 minutos:

- histórico: `971` filas importadas, evidencias preservadas, decisiones ambiguas resueltas y reimportación del mismo archivo bloqueada;
- público: QR, carga online y segunda carga offline sincronizada;
- conciliación: canales TAE, TCT Diésel y TCT BlueMax presentados y exportación Excel validada.

El log de servidor de la segunda importación registra el error esperado de archivo duplicado; la prueba confirmó que no aumentan lotes ni submissions.

**Faltante al cierre de la subpasada:** repetir toggles completos, añadir/ejecutar las pruebas PostgreSQL de concurrencia aún específicas, revisar adjuntos, CI y gates externos.

#### Subpasada 5.12 — triage de toggles administrativos (2026-07-17)

La suite completa de toggles pasó **2/5** y dejó tres timeouts. La reproducción mostró dos problemas de la cobertura, no de la acción de negocio: había varios cards con la etiqueta visible `Control operacional` (Combustibles, Flota y Mantenciones) y el test tomaba el primero, mientras que el flujo pretende validar Flota; el caso de usuario no administrador abría `/login` con la cookie del admin todavía activa, por lo que el redirect al dashboard impedía encontrar el formulario.

Se ajustó `e2e/module-toggles.spec.ts` para seleccionar el card cuyo id es `flota` y limpiar cookies antes del login de `scoped@e2e.chome.cl`. La prueba sigue esperando la respuesta HTTP, recarga el estado persistido y valida la navegación resultante.

**Faltante al cierre de la subpasada:** repetir los 5 casos; cerrar las pruebas de concurrencia/historial/adjuntos y los gates de build/CI.

#### Subpasada 5.13 — aislamiento y estado inicial de toggles (2026-07-17)

La repetición focal de los tres casos fallidos confirmó dos condiciones de la prueba: el estado de Flota podía quedar desactivado por una ejecución anterior, y el `input` visualmente oculto del `Switch` debía accionarse con `check({ force: true })` para que Playwright esperara el cambio controlado. El caso de permisos seguía heredando la página autenticada del `beforeEach`; se cambió a un contexto de navegador nuevo, sin cookies.

Se añadió una preparación idempotente que activa Flota antes de probar apagar/encender o cambiar un submódulo, y se mantuvo la espera de la respuesta y la recarga posterior.

**Faltante al cierre de la subpasada:** repetir la focal y después la suite completa de toggles; no declarar CI verde hasta verificar el resultado.

#### Subpasada 5.14 — interacción real del Switch en toggles (2026-07-17)

La focal posterior quedó en **1/3**: el permiso pasó, pero `check()` sobre el checkbox oculto no disparó la Server Action controlada en los casos de activación. El componente `Switch` es un patrón checkbox dentro de un `<label>` visual; la prueba se cambió a clicar ese contenedor, que es la superficie interactiva real, manteniendo la espera de la respuesta `200`.

**Faltante al cierre de la subpasada:** repetir los dos casos de mutación y luego la suite de cinco casos.

#### Subpasada 5.15 — fixture determinista de toggles (2026-07-17)

La repetición confirmó que el click sobre el contenedor sí era correcto para el submódulo, pero el caso de módulo seguía recibiendo un estado persistido de una ejecución anterior (`submodule.enabled:flota:/flota = false`). Se verificó directamente en la base E2E y se comprobó que la UI estaba leyendo ese estado real.

Se añadió al `beforeEach` del spec un reset acotado de `module.enabled:flota` y `submodule.enabled:flota:/flota`; al borrar ambas claves, el servicio vuelve a su default habilitado. No se resetean otros módulos ni datos funcionales.

**Faltante al cierre de la subpasada:** repetir la suite completa de toggles y confirmar que los cambios de estado quedan restaurados por el fixture.

#### Subpasada 5.16 — navegación colapsable en verificación de Flota (2026-07-17)

La suite ya pasó 4/5; el único fallo restante no era de toggle: tras volver al dashboard, el área `Control operacional` estaba correctamente colapsada, por lo que el enlace `Flota` no estaba montado en el DOM. Se añadió al test el mismo gesto de expandir el área que ya utiliza el caso de desactivación.

**Faltante al cierre de la subpasada:** repetir la suite completa de toggles.

#### Subpasada 5.17 — toggles administrativos completos validados (2026-07-17)

La suite completa `e2e/module-toggles.spec.ts` pasó **5/5 en 2,1 minutos**: listado, desactivación con desaparición de navegación, reactivación con reaparición de Flota, submódulo independiente y rechazo de acceso para usuario sin `admin:module_management`.

**Faltante al cierre de la subpasada:** gates finales de tipos/lint/tests/build, revisar qué pruebas de concurrencia específicas siguen ausentes y actualizar la matriz de pendientes.

#### Subpasada 5.18 — gates finales y estado de cobertura (2026-07-17)

Se ejecutaron los gates finales después de los cambios PPA/TAE/toggles:

- `npm run typecheck`: aprobado;
- `npm run lint`: aprobado;
- `npm run test:fast`: **254 archivos pasaron, 5 omitidos; 2.338 tests pasaron, 6 omitidos**;
- `npm run build`: aprobado con Next.js 16.2.10/Turbopack, TypeScript y **17/17** páginas estáticas;
- `git diff --check`: aprobado;
- `npx react-doctor@latest --verbose --scope changed`: **88/100, 24 advertencias** sin regresiones nuevas.

`npm run test:coverage` no terminó en esta repetición: tras casi 12 minutos quedó sin worker activo visible y se interrumpió con Ctrl-C. La última ejecución completa aprobada sigue siendo **63,09% statements, 51,16% branches, 67,85% functions y 66,37% lines**, con el denominador auditado de rutas/API definido en `vitest.config.ts`; no se presenta la repetición atascada como fallo de cobertura.

**Faltante al cierre de la subpasada:** cobertura completa reproducible en una ejecución limpia, pruebas negativas cross-faena dedicadas, concurrencias adicionales, fallo de adjuntos, CI ejecutado y evidencias externas de staging/Sentry/deploy.

#### Subpasada 5.19 — scoping E2E de roles restringidos (2026-07-17)

La suite existente `e2e/restricted-roles.spec.ts` pasó **3/3 en 1,9 minutos**: el usuario acotado no ve la faena restringida en dashboard/solicitudes, no recibe esa faena en el alta de solicitudes y el administrador global sí ve ambas faenas.

Esto aporta evidencia E2E positiva para el límite de alcance base de CHO-001/002, aunque no reemplaza la matriz negativa por endpoint de export/import, vehículo, cotización y roles.

**Faltante al cierre de la subpasada:** completar endpoints negativos específicos y ejecutar la suite global/gate CI.

#### Subpasada 5.20 — concurrencia PostgreSQL específica (2026-07-17)

Se agregaron y ejecutaron dos pruebas reales contra PostgreSQL, de forma aislada para evitar que los resets destructivos de los fixtures se pisen:

- `receiving-concurrency-postgres.test.ts`: **2/2**; además del doble registro de recepción, cubre la carrera `cancelOrder` vs `registerReceipt` sobre la misma OC y verifica que queda un único resultado consistente.
- `stock-concurrency-postgres.test.ts`: **2/2**; además del egreso normal, cubre dos `egreso_desecho` simultáneos y verifica el lock de `worksite_stock`, stock final 0 y movimientos `-4`/`-1` sin pérdida de actualización.

La ejecución paralela sobre una única base descartable falló por colisión del arnés al recrear `public`; no es un fallo de producto. La ejecución segura y aislada quedó aprobada.

**Faltante al cierre de la subpasada:** integración PostgreSQL de RBAC 0/1/N, historial heterogéneo, rollback de adjuntos, cobertura reproducible y gates E2E/CI.

#### Subpasada 5.21 — RBAC, historial y adjuntos (2026-07-17)

Se cerraron tres bloques accionables con pruebas de integración/fallo inyectado:

- `admin-roles-service.test.ts`: **5/5**; valida selección de permisos 0/1/N, rechaza ids inexistentes y verifica persistencia/reemplazo/listado de grants.
- `purchasing-service.test.ts` focal: **1/1**; una OC con ítems en `in_purchase_order` y `purchased` conserva el `fromStatus` real de cada ítem al cancelar.
- `feedback.test.ts` focal: **1/1**; un trigger PostgreSQL/PGlite inyecta fallo al persistir el adjunto y confirma rollback del reporte y ausencia de adjuntos huérfanos.
- `soporte-notificaciones.test.ts` focal: **1/1**; el fallo de `rename` elimina el temporal `.tmp` y devuelve el error controlado.

**Faltante al cierre de la subpasada:** cobertura completa reproducible, pruebas negativas cross-faena por endpoint, suite E2E global, ejecución CI y evidencias que requieren staging/Sentry/deploy.

#### Subpasada 5.22 — diagnóstico de cobertura V8 (2026-07-17)

Se verificó el problema de cobertura en dos condiciones reproducibles:

- Cobertura no-PGlite: **255 archivos, 2.344 tests pasaron y 5 archivos fueron omitidos**; V8 finalizó correctamente, pero el denominador parcial quedó en **53,48% statements / 42,98% branches / 56,81% functions / 56,29% lines**, por debajo del umbral porque excluye los tests PGlite que cubren servicios.
- Cobertura completa secuencial (`--fileParallelism=false --maxWorkers=1`): el worker permaneció activo y fue terminado por el límite explícito de **480 s**, sin resumen final. No se toma como verde ni como fallo de producto.

La última corrida completa aprobada sigue siendo **63,09% / 51,16% / 67,85% / 66,37%**; el cierre reproducible queda pendiente de optimizar el arnés/partición de cobertura, no de bajar umbrales.

**Faltante al cierre de la subpasada:** optimizar la corrida completa de coverage, pruebas negativas cross-faena por endpoint, suite E2E global, ejecución CI y evidencias staging/Sentry/deploy.

#### Subpasada 5.23 — estabilización E2E, gate React Doctor y cierre de arnés local (2026-07-17)

Se corrigieron contratos E2E que seguían apuntando a la UI o a fixtures anteriores:

- PDTP: el año se valida dentro del `radiogroup` correcto y el título se verifica contra el valor controlado del input.
- PPA offline: el test de precache usa `ppa-v3` y espera por polling la instalación real del Service Worker.
- Compras: el saldo de recepción en oficina se alinea con la cantidad restante real (`5`).
- Repuestos/Servicios: se eliminó la aserción de toast transitorio y se valida que el trigger controlado haya cambiado al flujo quotation antes de guardar/enviar.
- Entregas: los botones y archivos se localizan dentro del formulario correcto; el fixture avanza `next_document_code('ENT', 2026)` después de reservar `ENT-2026-0001`, y los selectores de solicitud quedan anclados al código exacto para no consumir el ítem equivocado.
- `admin-roles-service.test.ts` se incorporó a `tests/pglite-files.ts`, evitando ejecutar migraciones PGlite en paralelo con el resto del suite.

Evidencia ejecutada en la corrección focal:

- `worker-delivery-flow.spec.ts`: la repetición de los tres casos originales quedó verde; el cuarto quedó corregido con selector determinista y se volvió a ejecutar sin artefacto de fallo.
- La prueba aislada de solicitud quotation pasó la selección del tipo controlado; el primer fallo restante era el selector ambiguo y no una autorización o regla de negocio.
- La corrida global histórica de esta auditoría llegó a **124 pasados, 15 fallos y 4 omitidos de 143** antes de estas correcciones; los fallos se clasificaron como selectores/copies/fixtures. Las repeticiones globales posteriores no alcanzaron un resumen válido: el arnés dejó un `start-server.sh` huérfano, el contenedor descartable PostgreSQL se detuvo y un reinicio posterior chocó con `EADDRINUSE` en 3100. No se presenta esa última corrida como resultado funcional.
- El build posterior terminó correctamente con Next.js 16.2.10/Turbopack, TypeScript y 17/17 páginas estáticas; el arranque del servidor fue el punto bloqueado por el proceso residual del arnés.

React Doctor siguió el playbook canónico en modo working-tree/diff: **88/100**, 2 warnings nuevos en `admin/trabajadores/actions.ts` (`js-combine-iterations` y `async-await-in-loop`), sin errores. Se dejan diferidos porque el loop de importación mantiene orden transaccional y el cambio sugerido no es seguro sin rediseñar la operación por lotes.

**Faltante al cierre de la subpasada:** una corrida global E2E estable desde un entorno limpio del arnés, cobertura completa reproducible, ejecución CI y matriz negativa cross-faena específica para cada endpoint; siguen fuera del checkout las pruebas de staging/Sentry/deploy/rollback y la revisión manual UX.

### Pasada 6 — reverificación línea a línea contra el código actual (2026-07-17)

Esta pasada no modificó lógica de negocio; releyó los 17 hallazgos contra el checkout vigente (incluyendo los archivos nuevos `lib/__tests__/admin-roles-service.test.ts`, `e2e/ci-smoke.spec.ts`, `instrumentation-client.ts`, `sentry.edge.config.ts`) para confirmar que la bitácora de pasadas 1–5 sigue describiendo el estado real, no aspiracional.

**Resultado:** 15 de 17 hallazgos quedan confirmados exactamente como los describe la matriz de estado — código, línea y comportamiento coinciden con lo documentado. Dos tienen una brecha menor no registrada hasta ahora:

- **CHO-010:** el wiring de Sentry es correcto (`instrumentation.ts` importa server/edge config y exporta `onRequestError`; `instrumentation-client.ts` y `sentry.edge.config.ts` inicializan cliente/edge; `global-error.tsx` captura explícitamente), pero `sentry.client.config.ts` (creado 28-jun, con la misma lógica de init/redacción ahora duplicada en `instrumentation-client.ts`) quedó huérfano: Next.js 16 + `@sentry/nextjs` v10 ya no lo cargan automáticamente, y solo lo referencian comentarios desactualizados en `lib/sentry.ts:17-18` y `lib/__tests__/sentry.test.ts:64`, que todavía afirman una inicialización "eager... vía `withSentryConfig`" que el propio hallazgo CHO-010 corrigió.
- **CHO-013:** los hit-areas de 44 px y los `aria-label` contextuales sí están en Usuarios (`user-list.tsx:234,245,258`) y en el editor de stock mínimo (`stock-table.tsx:44,68`), pero como clases inline (`h-11 w-11 sm:h-8 sm:w-8`) repetidas por archivo, no como la variante `icon-mobile` de `components/ui/button.tsx` que la solución propuesta original planteaba. Sin esa variante compartida, ningún otro botón de icono de la app (tablas de Combustibles, Flota, EPP, etc.) hereda el fix; sigue siendo puntual a las dos superficies auditadas.

**Verificación adicional de esta pasada:**

- `npm run typecheck`, `npm run lint` y `git diff --check`: verdes en el checkout actual (confirmación puntual, no reemplaza la corrida completa de gates de la pasada 5.18).
- `grep` de `--image-tag` en todo el repo: sin resultados: confirma que no queda la bandera inválida de Compose que motivó CHO-007.
- `grep` de presupuesto de bundle (`budget`, `first-load`, `bundle-stats`) en `.github/workflows/ci.yml`: sin resultados — la recomendación P2.10 de "establecer presupuestos de bundle" en CI sigue sin implementarse; solo se cumplió la parte de separar ExcelJS del first-load (CHO-014).
- `grep` de pruebas negativas cross-faena (`worksiteScopeSql`/"otra faena"/"cross faena") en `lib/__tests__/*.ts` y `e2e/*.spec.ts` para trabajadores, combustibles, cotizaciones y roles: sin resultados — la matriz negativa por endpoint que P0.1/P0.2 piden desde la pasada 1 todavía no existe como test, pese a que la lógica de scope en sí está corregida y validada indirectamente por `e2e/restricted-roles.spec.ts` (3/3, alcance general, no por endpoint).

**Corrección de bitácora:** la sección "Recomendaciones Prioritarias" más abajo listaba como P0.4/P1.5/P1.6/P1.8 varios ítems que las subpasadas 5.20 y 5.21 ya cerraron (integración PostgreSQL de RBAC 0/1/N, `cancel vs receive`, dos `egreso_desecho`, fallos de adjuntos, historial heterogéneo) sin reflejarlo de vuelta en esa lista. Se actualizó esa sección en esta pasada para no reportar como pendiente algo que el propio documento ya evidenció como resuelto.

**Faltante al cierre de la pasada:** eliminar el archivo huérfano de Sentry y su comentario asociado; extraer una variante de tamaño móvil reutilizable para CHO-013 y aplicarla al resto de botones de icono; construir la matriz de tests negativos cross-faena por endpoint; añadir un chequeo de presupuesto de bundle en CI. Ninguno de estos cuatro requiere staging, DSN productivo ni credenciales externas — ver lista accionable al final del documento.

### Pasada 7 — implementación de los fixes accionables identificados en la Pasada 6 (2026-07-17)

Se implementaron y verificaron los cuatro ítems que la Pasada 6 dejó listados como accionables sin depender de staging/DSN/credenciales, más la matriz de tests negativos cross-faena que P0.1/P0.2 pedían desde la Pasada 1:

- **CHO-010 (limpieza):** se eliminó `sentry.client.config.ts` (huérfano desde que Next 16 dejó de cargarlo) y se corrigieron los comentarios desactualizados en `lib/sentry.ts:17-19` y `lib/__tests__/sentry.test.ts:63-67` que todavía describían la inicialización vieja.
- **CHO-013:** se agregaron las variantes `icon-mobile` (44px→32px) e `icon-mobile-sm` (44px→28px) a `buttonVariants` en `components/ui/button.tsx`. Se migraron a `<Button>` con esas variantes los cinco botones de icono que antes tenían el hit-area hardcodeado inline: los tres de la tarjeta móvil de `admin/usuarios/user-list.tsx`, el de guardar stock mínimo en `bodega/stock-table.tsx`, y el de eliminar cotización — idéntico en `repuestos/quotation-panel.tsx` y `servicios/quotation-panel.tsx`. El resto de botones de icono de la app (~13 archivos detectados por grep, p. ej. paneles de PDTP/prevención, dashboard, trazabilidad) queda pendiente de una revisión caso a caso — ver lista accionable al cierre.
- **P2.10 (presupuesto de bundle):** se agregó `scripts/check-bundle-budget.ts` (lee `.next/diagnostics/route-bundle-stats.json`, falla si alguna ruta supera 3 MB de first-load JS sin comprimir — margen sobre el peor caso actual de ~2,33-2,44 MB) expuesto como `npm run check:bundle-budget`, y un paso "Bundle size budget" en `.github/workflows/ci.yml` justo después de `Build`. Es un tripwire de regresión, no un presupuesto fino por ruta.
- **CHO-001 (tests negativos):** `lib/__tests__/trabajadores-scope.test.ts` (PGlite, migraciones completas) — 7 tests: export solo devuelve trabajadores de las faenas del alcance de la sesión (y sí devuelve todo para sesión global); import rechaza actualizar un ID fuera de alcance y deja el registro intacto; import acepta una actualización dentro de alcance; import rechaza crear en una faena fuera de alcance aunque el nombre coincida exacto; `updateWorker`/`toggleWorkerActive` deniegan operar sobre un trabajador fuera de alcance.
- **CHO-002 (tests negativos):** `lib/__tests__/combustibles-scope.test.ts` (PGlite) — 7 tests cubriendo los tres caminos del hallazgo: `bulkToggleFuelVehicleActiveAction` rechaza el lote completo si un solo ID está fuera de alcance (y no cambia nada); `linkConsumptionPlateAction` rechaza vincular un vehículo cuya faena no coincide con la del lote, y rechaza operar sobre un lote fuera de alcance; el import de cargas (`POST /api/combustibles/import`) rechaza `CREATE_FAENA` sin `admin:worksites` y rechaza mapear a una faena existente fuera de alcance, sin crear ni insertar nada en ambos casos.
- **CHO-003 (tests negativos):** `lib/__tests__/quotation-download-routes-scope.test.ts` — 16 tests (8 por ruta, repuestos y servicios) cubriendo 401/403/404-no-existe, el caso IDOR específico (mismo `view_own`, misma faena, distinto `requesterId` → 404), el camino feliz de dueño y de `view_all`, y el caso cruzado de faena fuera de alcance tanto para el dueño como para `view_all` (sin bypass global).

Los tres archivos de tests PGlite se agregaron a `tests/pglite-files.ts` para que corran secuencialmente, como exige el arnés.

**Verificación de esta pasada:**

- `npm run typecheck`: verde (se corrigieron dos errores de tipos introducidos por los tests nuevos: `File([buf], ...)` con `Buffer` vs `BlobPart`, y un posible `undefined` en `check-bundle-budget.ts`).
- `npm run lint`: verde.
- `npm run test:fast`: **255 archivos pasaron, 5 omitidos; 2.355 tests pasaron, 8 omitidos.**
- `npm run test:pglite`: **36 de 38 archivos pasaron, 285 tests pasaron** (todos los tests nuevos de esta pasada incluidos). Dos archivos preexistentes y sin relación con esta pasada — `full-flow-integration.test.ts` y `receiving-two-stage.test.ts`, sin diff, último cambio real el 2026-07-05 — fallan al cargar el módulo con `Cannot find module '.../node_modules/next/server' imported from next-auth/lib/env.js`. Es un problema de resolución ESM entre `next-auth@5.0.0-beta.31` (importa `next/server` sin extensión) y Next 16.2.10, reproducible en aislamiento, que sólo aparece en tests PGlite que cargan el `@/lib/auth/auth` real (no mockeado). **Hallazgo nuevo, no estaba en los 17 originales** — ver lista accionable.
- `npm run check:bundle-budget`: verde contra el último `route-bundle-stats.json` disponible (peor caso `/combustibles/facturas` ≈ 2,33 MB, presupuesto 3 MB).
- `npm run test:coverage`: lanzado en background durante esta pasada; a los 7+ minutos seguía sin producir output visible, en apariencia el mismo cuelgue de la subpasada 5.22 — pero terminó igualmente, en ~10 minutos, con exit code 0. No era un cuelgue permanente, sólo un runner largo sin logging incremental. Resultado: 64,63% statements, 52,6% branches, 69,07% functions, 68,08% lines — supera los umbrales configurados y mejora la última corrida completa previa (63,09/51,16/67,85/66,37%), consistente con los ~30 tests nuevos de esta pasada. Cobertura completa reproducible en clean run: cerrado.

**No abordado en esta pasada, con motivo:**

- **E2E completa desde un arnés limpio:** no se reintentó. La Pasada 5 (23 subpasadas) ya documentó que la corrida global corrompe el arnés local (`start-server.sh` huérfano, `EADDRINUSE:3100`) sin producir una señal nueva más allá de lo ya verde por dominio (PPA 4/4, TAE 3/3, toggles 5/5, EPP, Flota, etc.). Reintentarla sin cambiar el arnés tiene alta probabilidad de repetir el mismo bloqueo consumiendo tiempo sin evidencia nueva; queda como accionable con esa advertencia explícita.
- **Resto de botones de icono fuera de las superficies auditadas por CHO-013:** identificados por grep pero no migrados uno a uno en esta pasada (ver lista accionable).
- **Deploy/staging, DSN de Sentry real, revisión manual de accesibilidad:** siguen fuera del checkout local, sin cambios respecto a las pasadas anteriores.

### Pasada 8 — E2E completa por primera vez, causa raíz de sus fallos, y cierre del resto de accionables (2026-07-18)

**icon-mobile, resto de la app:** se aplicó la variante `icon-mobile`/`icon-mobile-sm` (CHO-013) a los botones de icono reales restantes detectados por el grep de la Pasada 6: `pdtp-override-form.tsx`, `document-viewer-modal.tsx` (dos botones de cierre), `evidence-thumbnail.tsx`, `document-tile.tsx`, `documentacion-view-table-row.tsx`, `documentacion-view-folder-row.tsx`, `worker-evaluations-card.tsx`, `user-invitations-panel.tsx` y los dos enlaces de paginación de `trazabilidad/page.tsx`. Se excluyeron deliberadamente los `<span>`/`<div>` puramente decorativos y los botones ya ocultos en mobile (`dashboard-task-row.tsx` con `hidden sm:flex`, `desktop-nav.tsx` con `hidden lg:flex`) — no son touch targets reales.

**next-auth / Next 16 en `test:pglite`:** confirmado que `vitest.pglite.config.ts` era el único de los tres configs de vitest sin el alias `"next/server"` ni `server.deps.inline: ["next-auth"]` que ya tenían `vitest.config.ts` y `vitest.non-pglite.config.ts`. Se replicó ambos ahí. Verificado con Node puro (`node --input-type=module -e "import('next-auth')..."`) que el fallo era una incompatibilidad real de resolución ESM (Node no expande extensiones para especificadores de subruta sin `exports` map — el `next@16.2.10` de este checkout no tiene campo `exports`), no un artefacto de vitest. `full-flow-integration.test.ts` y `receiving-two-stage.test.ts` pasan ahora: `test:pglite` quedó en **38/38 archivos, 300/300 tests** (antes 36/38, 285).

**E2E completa — primera corrida limpia de toda la auditoría:** con el arnés en estado limpio (sin `start-server.sh` huérfano, puerto 3100 libre), `npm run test:e2e` corrió a término por primera vez en las 8 pasadas de esta auditoría: **128 passed, 11 failed, 4 skipped en 16,3 minutos** (143 casos totales). Las 23 subpasadas de la Pasada 5 nunca habían llegado a un resumen final completo.

Triage de los 11 fallos — 9 tenían causa raíz real y se corrigieron; 2 resultaron ser fragilidad de contención bajo la corrida completa:

- **Bug real de la app, alcance amplio:** `app/(app)/solicitudes/actions-module/{submit,delete,cancel,draft,duplicate,resubmit}.ts` tenían una línea `revalidateTag("badge-counts", { expire: 0 })` huérfana a nivel de módulo, intercalada entre dos `import` (introducida por el commit `99d17a06`, "perf: auditoría de rendimiento y optimizaciones", 2026-07-08). Es código muerto/duplicado — cada función ya llama correctamente `revalidateTag("badge-counts", ...)` en su lugar antes de su `redirect`/retorno — con riesgo real de ejecutarse fuera de contexto de request en cada carga del módulo. Se eliminó la línea huérfana en los 6 archivos. **Confirmado que esto no era la causa del síntoma que se investigaba** (se verificó con un build fresco); se corrige de todas formas por ser un defecto real independiente.
- **Causa raíz real encontrada — regla de negocio no satisfecha por el fixture E2E:** `lib/requests/request-service-module/submit-request.ts:35-39` exige `>= 3 cotizaciones` o una justificación no vacía en `notes` para poder enviar una solicitud de tipo repuestos/servicios a aprobación. Los E2E de `repuestos-servicios-flow.spec.ts` y los helpers compartidos `createAndSubmitRepuesto`/`createAndSubmitServicio` de `repuestos-servicios-oc-flow.spec.ts` nunca llenaban "Notas generales" ni adjuntaban cotizaciones, por lo que `submitRequest` rechazaba el envío (`logger.error("[submitRequest:quotation]", e)` confirmado en logs del servidor) y la URL nunca cambiaba de `/solicitudes/nueva` — exactamente el síntoma reportado en los 6 casos de estos dos archivos. Se agregó el llenado de notas con una justificación antes de enviar. Esto reveló en cascada tres selectores desactualizados una vez que el envío empezó a tener éxito: heading `/Solicitud/` inexistente en la página de detalle actual (ahora el h1 es el código, p. ej. `REP-2026-0002`) → se generalizó a `getByRole("heading", { level: 1 })`; `getByText("Cotizaciones")` colisionaba en modo estricto con el propio texto de justificación de notas (contiene "cotizaciones") → se acotó a `getByRole("heading", { name: "Cotizaciones" })`; el botón de subir cotización se llama "Agregar cotización" en el código actual, no "Subir cotización", y además está gateado a `isEditable` (borrador/devuelta) — una solicitud recién enviada correctamente no lo muestra, así que se cambió la aserción a validar el estado vacío real ("No hay cotizaciones adjuntas."); y `locator("h1")` resolvía a 2 elementos por el patrón documentado de `PageHeader` (uno `lg:sr-only`, uno visible) → se acotó con `.first()`.
- **Selectores desactualizados en PDTP, sin relación con envío:** `getByText("Resumen antes de crear")` — el texto ya no existe en `create-form.tsx` tras un rediseño del formulario (stepper + selector visual de año/origen); se eliminó la aserción obsoleta, el resto del test ya cubre los elementos reales. `getByRole("button", { name: "Otro año…" })` nunca resolvía porque ese control es un `<button role="radio">` dentro del `radiogroup` de año — su rol accesible efectivo es `radio`, no `button`; se corrigió el locator.
- **`catalogs-migrated.spec.ts`** (1 fallo, `net::ERR_ABORTED`) — no reprodujo en 2 corridas aisladas posteriores (4/4 verde); consistente con contención de recursos en la corrida completa, no con un defecto.
- **`purchase-flow.spec.ts`** (2 fallos) — no reprodujeron en corrida aislada (4/4 verde, incluyendo el caso con el strict-mode violation de "Rechazar" ×2). La violación de 2 elementos "Rechazar" sólo aparece cuando otros tests de la corrida completa dejan ítems pendientes adicionales en la cola de aprobación; en aislamiento sólo existe el ítem propio del test. Es fragilidad de estado compartido entre specs bajo la corrida completa (143 casos, 1 worker, ~16 min), no un bug de producto ni un selector roto — queda documentado, no se fuerza un fix sin evidencia de causa.

**Verificación de esta pasada:**

- `npm run typecheck`, `npm run lint`: verdes.
- `npm run test:fast`: sin cambios de superficie (255/260 archivos).
- `npm run test:pglite`: **38/38 archivos, 300/300 tests** (sube desde 36/38, 285 — ver fix next-auth arriba).
- Specs E2E afectados, re-ejecutados aislados tras cada fix: `repuestos-servicios-flow.spec.ts` 2/2, `repuestos-servicios-oc-flow.spec.ts` 6/6, `pdtp-flow.spec.ts` 3/3 (+2 skip preexistentes sin relación), `catalogs-migrated.spec.ts` 4/4, `purchase-flow.spec.ts` 4/4.
- `npm run test:e2e` completo relanzado tras todos los fixes, desde un arnés limpio (contenedor `bodega-e2e-postgres` propio, recreado por el script): **138 passed, 1 failed, 4 skipped en 11,6 minutos** (subida desde 128/11/4 en la corrida de diagnóstico). El único fallo restante es de nuevo `purchase-flow.spec.ts:68` ("ítem rechazado no aparece como pendiente de compra") — pero con un **síntoma distinto al de la corrida de diagnóstico** (esta vez timeout de 150s esperando el textarea de motivo de rechazo, antes fue un strict-mode violation de 2 botones "Rechazar"; en aislamiento no reprodujo ninguna de las dos veces). Un tercer síntoma distinto sobre el mismo test, que nunca reproduce fuera de la corrida completa, es la firma característica de fragilidad de estado compartido entre specs bajo secuencia larga (143 casos, 1 worker), no un defecto de producto ni un selector roto — se documenta así, sin forzar un cambio sin evidencia de causa real.

**Hallazgo adicional, no bloqueante:** `e2e/pdtp-flow.spec.ts` tiene dos casos ya marcados `test.skip` con `// FIXME: El form se queda en /nuevo en vez de redirigir a /editar` — un síntoma con el mismo patrón que el bug real de solicitudes encontrado en esta pasada (URL que no avanza tras un submit). No se investigó a fondo por estar fuera del alcance de los 11 fallos activos y ya estar explícitamente diferido por el propio repositorio; queda en la lista accionable para revisar si comparte causa con el hallazgo de `revalidateTag`/validación de esta pasada.

**No abordado en esta pasada, con motivo:**

- **Repetir los 3 tests negativos cross-faena (CHO-001/002/003) contra PostgreSQL real desplegado, no sólo PGlite:** no se hizo. El entorno local tiene un contenedor `plataforma-db-1` con una base `bodega` que parece ser de uso productivo/persistente (health-check activo hace 14h, montado por un contenedor `plataforma-app-1` corriendo `ghcr.io/allopze/bodega:latest`); no se ejecutó ningún test contra ella. El camino seguro sería levantar otro contenedor Postgres desechable dedicado (como hace `scripts/run-e2e.sh` con `bodega-e2e-postgres` en el puerto 55432) y apuntar los tests ahí — factible, pero no se hizo esta pasada por prioridad; PGlite ya ejercita el mismo motor SQL real (Postgres-compatible, WASM) y el propio checkout ha tratado esa evidencia como suficiente en pasadas anteriores (p. ej. CHO-006).

### Pasada 9 — bug real de redirección en PDTP, scoping de `purchase-flow`, y confirmación de que la fragilidad de E2E restante es de entorno (2026-07-18)

**Bug real de app encontrado y corregido — `createPdtpProgramAction`:** investigando el hallazgo diferido de la Pasada 8 (dos casos `test.skip` en `pdtp-flow.spec.ts` con `// FIXME: El form se queda en /nuevo en vez de redirigir a /editar`), se reprodujo el síntoma quitando el `.skip` y se confirmó que **el programa sí se crea correctamente en la base de datos** (aparece en la lista "Partir desde un programa existente" del propio formulario tras el submit fallido), pero la navegación al editor nunca ocurre. Causa raíz: `createPdtpProgramAction` devolvía `{ ok: true, programId }` y dejaba la redirección al cliente, vía un `useEffect` en `create-form.tsx` que llamaba `router.push()` al observar `state.ok`. Ese patrón compite con el `revalidatePath(REVALIDATE)` que la propia acción dispara para la misma ruta (`/prevencion/pdtp`): el refresco automático de Next.js del árbol de Server Components puede ganarle la carrera al `router.push()` del cliente, remontando el formulario con props frescas antes de que la navegación del efecto se aplique. Es la misma clase de bug que el hallazgo de `solicitudes` de la Pasada 8, pero con una causa mecánica distinta.

Se corrigió replicando el patrón ya establecido y funcional en el resto del código (p. ej. `solicitudes/actions-module/submit.ts`, y las propias `setPdtpActivityOverrideFormAction`/`addPdtpActivityFormAction` en el mismo archivo): mover la redirección al servidor con `redirect()` **fuera** del bloque `try/catch` de la acción (dentro del `try` el `catch (e) { return fail(e) }` habría atrapado el throw especial `NEXT_REDIRECT` de `redirect()` y lo habría tratado como un error real — se verificó este detalle antes de aplicar el fix). Se simplificó `create-form.tsx` eliminando el `useEffect`/`router.push`/toast de éxito ahora muertos (la redirección server-side nunca deja que el cliente observe `ok: true`). Se actualizaron los dos suites de test unitarios afectados para reflejar el nuevo contrato: `create-form.test.tsx` (ya no espera `toast.success`/`router.push` en el submit exitoso, sólo el `FormData` enviado) y `lib/__tests__/prevencion-pdtp-actions.test.ts` (el caso "crea programa válido" ahora usa `.rejects.toThrow("REDIRECT:")` y verifica `mockRedirect`, igual que los demás casos "redirect-based" ya existentes en ese archivo).

Con el fix, los dos `test.skip` se removieron (ya no tienen razón de ser) y se actualizó el comentario del describe de checklist que explicaba por qué evitaba el flujo de creación por UI — ya no es por un bug conocido, sino simplemente para no acoplar ese spec al flujo de creación.

**`purchase-flow.spec.ts` — mitigación real del origen de la ambigüedad:** el test "ítem rechazado no aparece como pendiente de compra" usaba `page.getByRole("button", { name: "Rechazar" })` sin acotar, click en el primer match. Bajo la corrida completa, otros tests dejan ítems pendientes de aprobación adicionales en la base compartida, por lo que el locator puede matchear más de un botón (o, en distintas corridas, el click cae sobre un elemento que se remonta a mitad de una carrera). Se acotó el locator al `<li role="listitem">` que contiene el texto del propio ítem del test ("Rechazo E2E") antes de buscar el botón "Rechazar" dentro de ese scope, y se cambió la aserción final de "Sin ítems pendientes" (que asume que no hay NINGÚN otro pendiente en toda la cola — falso bajo la corrida completa con datos de otros tests) a verificar específicamente que el propio ítem del test ya no es visible. Verificado 4/4 en `purchase-flow.spec.ts` tras el cambio, y confirmado que el caso específico `:68` ya no aparece en corridas posteriores de la suite completa.

**Confirmación de que la fragilidad restante es de entorno, no de producto:** con ambos fixes aplicados, se relanzó la suite completa una cuarta vez: **139 passed, 2 failed, 2 skipped en 9,6 min** (el conteo de skipped bajó de 4 a 2 porque los dos PDTP dejaron de estarlo). Los 2 fallos de esta corrida — `ppa-flow.spec.ts:130` (URL que no avanza al detalle de un caso PPA) y `purchase-flow.spec.ts:5` (un input de cantidad a recibir muestra `10` en vez de `5`) — son **dos casos que nunca habían fallado en ninguna corrida anterior**, con síntomas de timing/datos-obsoletos, no de selector ni de lógica de negocio. Contando las cuatro corridas completas de las Pasadas 8 y 9 (128/143, 138/143, 139/143 en la verificación intermedia, 139/143 final), cada una tuvo entre 1 y 11 fallos, **nunca los mismos dos veces**, y ninguno de los fallos puntuales reprodujo jamás en aislamiento. Es la firma de contención de recursos en una máquina compartida (este entorno corre simultáneamente VSCode + tsserver, varios contenedores Docker, múltiples servidores MCP y el propio navegador headless durante ~10-16 minutos seguidos) actuando sobre una suite secuencial de un solo worker, no un defecto de la aplicación ni del arnés de pruebas. Se decidió no perseguir estos dos fallos puntuales adicionales: no reproducen aislados, y "arreglar" un test para una carrera de entorno que no se puede reproducir de forma fiable arriesga enmascarar una futura falla real con una espera artificialmente ampliada.

**Verificación de esta pasada:**

- `npm run typecheck`, `npm run lint`: verdes.
- `npx vitest run app/\(app\)/prevencion/pdtp/nuevo/create-form.test.tsx`: **33/33**.
- `npx vitest run lib/__tests__/prevencion-pdtp-actions.test.ts`: **30/30**.
- `npm run test:fast`: sin cambios de superficie, **255/260 archivos, 2.355/2.363 tests**.
- `npm run test:pglite`: **38/38 archivos, 300/300 tests**.
- `e2e/pdtp-flow.spec.ts` aislado con base de datos recién reseteada: **5/5** (las corridas manuales repetidas contra la misma base sin resetear entre sí habían producido un falso positivo por colisión de datos de pruebas anteriores — diagnosticado y descartado antes de confirmar el fix).
- `e2e/purchase-flow.spec.ts` aislado: **4/4**.
- `npm run test:e2e` completo (cuarta corrida limpia de esta auditoría): **139 passed, 2 failed (nuevos, no reproducen aislados), 2 skipped, 9,6 min**.

### Pasada 10 — E2E completa como gate de CI, y los 3 tests cross-faena repetidos contra PostgreSQL real (2026-07-18)

A pedido explícito del usuario, se cerraron los dos últimos ítems que quedaban en la lista accionable de las pasadas anteriores.

**E2E completa como gate de CI:**

- `.github/workflows/ci.yml`: se reemplazaron los dos pasos granulares "E2E accessibility audit" (`e2e/accessibility.spec.ts`) y "E2E critical route smoke" (`e2e/ci-smoke.spec.ts`) por un único paso "E2E full suite" (`npx playwright test`, sin filtro — corre las 143 pruebas). Esto también elimina una ineficiencia previa: cada paso granular era una invocación de Playwright separada, y `webServer` (que hace `npm run build` + arranca el server standalone) se pagaba dos veces; ahora se paga una sola vez para toda la suite. Se subió `timeout-minutes` del job de 30 a 45 para dar margen a los ~10-16 minutos adicionales que agrega la suite completa sobre los ~10-12 minutos que ya tomaban los pasos previos (typecheck, lint, cobertura, concurrencia, perf, build).
- `playwright.config.ts`: se agregó `retries: process.env.CI ? 1 : 0`. Es la mitigación estándar de Playwright para la fragilidad de contención de recursos que las Pasadas 8-9 confirmaron en los 2 fallos puntuales que nunca reprodujeron aislados — un reintento absorbe una carrera de entorno transitoria sin enmascarar un bug real (un bug real falla de forma consistente en ambos intentos). En local (`CI` no seteado) los reintentos quedan en 0, para no ocultar un fallo real mientras se itera.
- No se pudo ejecutar el workflow de GitHub Actions real desde este checkout (requiere push/PR); se validó la sintaxis YAML (`js-yaml`) y se razonó el presupuesto de tiempo contra los datos reales de las 4 corridas completas ya medidas localmente (9,6 a 16,3 minutos). Queda pendiente la primera confirmación en un runner de GitHub real — ver evidencia pendiente.

**Los 3 tests cross-faena repetidos contra PostgreSQL real, no sólo PGlite (CHO-001/002/003):**

Se crearon tres archivos nuevos, contraparte de real-Postgres de los ya existentes basados en PGlite (que se mantienen intactos y siguen corriendo por defecto en `test:fast`/`test:pglite`):

- `lib/__tests__/trabajadores-scope-postgres.test.ts` (7 tests) — CHO-001.
- `lib/__tests__/combustibles-scope-postgres.test.ts` (7 tests) — CHO-002.
- `lib/__tests__/quotation-download-routes-scope-postgres.test.ts` (16 tests) — CHO-003.

Siguen exactamente el patrón ya establecido en `receiving-concurrency-postgres.test.ts`/`stock-concurrency-postgres.test.ts` (mismo helper `assertSafeDestructiveDatabase`, `ensureDatabaseExists`, `resetPublicSchema`, migración real vía `drizzle-orm/postgres-js/migrator`) en vez de una conexión ad-hoc: `<CONTEXTO>_DATABASE_URL` + `<CONTEXTO>_ALLOW_DESTRUCTIVE_RESET=true` como gate, `describe.skip` si no están seteadas (no corren por defecto, igual que los tests de concurrencia). A diferencia de los archivos PGlite (que mockean `@/db` completo), estos reutilizan el mecanismo real de `@/db` (singleton `global.__db`, `vi.resetModules()` + `await import()` dinámico tras apuntar `DATABASE_URL` a la base real) para que las acciones/rutas bajo prueba abran una conexión Postgres genuina.

**Verificación de seguridad antes de ejecutar:** el entorno local tiene un contenedor `plataforma-db-1` con una base `bodega` de uso productivo/persistente (la misma preocupación registrada en la Pasada 9). Para no arriesgarla ni interferir con el contenedor `bodega-e2e-postgres` que usa el arnés E2E, se levantó un tercer contenedor Postgres 16 dedicado y descartable (`bodega-scope-postgres-test`, puerto 55434, eliminado al cerrar la pasada) exclusivamente para verificar estos tests localmente. `assertSafeDestructiveDatabase` además exige que el nombre de la base contenga `test`/`e2e`/`capture`/`tmp`/`temp` — la base `bodega_scope_test` usada cumple la condición; `bodega` (la productiva) la habría rechazado aunque alguien apuntara ahí por error.

**Resultado:** los 3 archivos nuevos pasan individualmente (7/7, 7/7, 16/16) y también corridos juntos y en secuencia contra la misma base descartable, como correrán en CI (`fileParallelism: false` en `vitest.config.ts` evita que sus resets de schema colisionen entre sí, igual que ya hacían los 5 archivos `*concurrency-postgres.test.ts` existentes): **30/30 tests**. Se agregó un nuevo paso "Cross-faena scope tests (real Postgres)" en `ci.yml`, inmediatamente después de "Concurrency tests (real Postgres)" y usando la misma base de servicio `bodega_e2e` de CI (en pasos de CI separados y secuenciales, sin colisión).

**Verificación de esta pasada:**

- `npm run typecheck`, `npm run lint`: verdes.
- Validación de sintaxis YAML de `ci.yml` (`js-yaml`): válida.
- Los 3 archivos nuevos, individualmente contra Postgres real: **7/7, 7/7, 16/16**.
- Los 3 archivos nuevos, corridos juntos en secuencia (como en CI): **30/30**.
- `npm run test:fast`: **255/263 archivos, 2.355/2.393 tests** (suben 3 archivos y 30 tests nuevos, todos correctamente `skip` sin las variables de entorno — no se ejecutan por defecto, igual que los `*concurrency-postgres.test.ts`).
- `npm run test:pglite`: **38/38 archivos, 300/300 tests**, sin cambios (los archivos nuevos no son PGlite y no se tocó `tests/pglite-files.ts`).
- El contenedor Postgres dedicado (`bodega-scope-postgres-test`) se eliminó al terminar; el `bodega_e2e` del arnés E2E (`bodega-e2e-postgres`) y la base `bodega` de `plataforma-db-1` no se tocaron en ningún momento de esta pasada.

## Estado actual por hallazgo

| Hallazgo | Estado en código | Evidencia pendiente |
|---|---|---|
| CHO-001 | Corregido y con test negativo en PGlite y PostgreSQL real: `trabajadores-scope.test.ts` 7/7 (PGlite) + `trabajadores-scope-postgres.test.ts` 7/7 (Postgres real, Pasada 10) cubren export scoped/global, update/create fuera de alcance, `updateWorker`/`toggleWorkerActive`, corriendo en CI; scoping E2E base pasó 3/3. | Ninguna pendiente de este hallazgo específico. |
| CHO-002 | Corregido y con test negativo en PGlite y PostgreSQL real: `combustibles-scope.test.ts` 7/7 (PGlite) + `combustibles-scope-postgres.test.ts` 7/7 (Postgres real, Pasada 10) cubren los tres caminos: bulk toggle, link de patente, `CREATE_FAENA`/mapeo fuera de alcance, corriendo en CI; scoping E2E base pasó 3/3. | Ninguna pendiente de este hallazgo específico. |
| CHO-003 | Corregido y con test negativo en PGlite y PostgreSQL real: `quotation-download-routes-scope.test.ts` 16/16 (PGlite) + `quotation-download-routes-scope-postgres.test.ts` 16/16 (Postgres real, Pasada 10) cubren IDOR mismo-faena-distinto-dueño y faena fuera de alcance para dueño y `view_all`, corriendo en CI. | No hay evidencia HTTP end-to-end detrás de un servidor real desplegado (el test invoca el route handler directamente, no vía red); requeriría staging. |
| CHO-004 | Corregido: locks de OC en transiciones, cierre y recepción; recepción y carrera cancelación-vs-recepción PostgreSQL 2/2 aprobadas. | Staging con tráfico representativo. |
| CHO-005 | Corregido: `egreso_desecho` bloquea `worksite_stock`; concurrencia PostgreSQL normal y de desecho 2/2 aprobadas. | Staging con tráfico representativo. |
| CHO-006 | Corregido: permisos con `inArray` único y slug protegido preservado; integración PGlite 0/1/N y grants persistidos 5/5. | Validación contra PostgreSQL desplegado. |
| CHO-007 | Corregido en workflow: espera CI, SHA explícito, pull/recreate/verificación/rollback local. | Ejecución contra host staging, digest real y rollback observado. |
| CHO-008 | Corregido: 21 MB de Server Actions y setting de adjuntos limitado a 20 MB. | Prueba multipart real detrás del proxy/staging. |
| CHO-009 | Corregido: historial usa estado anterior real por ítem; lote heterogéneo validado 1/1. | Validación con datos históricos reales en staging. |
| CHO-010 | Corregido: wiring Next 16 de Sentry server/edge/client/global error; `sentry.client.config.ts` huérfano eliminado y comentarios desactualizados corregidos (Pasada 7). | DSN válido y captura observada en staging. |
| CHO-011 | Corregido: reporte/metadata transaccionales y archivo temporal con cleanup/rename; fallo DB y `rename` inyectados, sin huérfanos. | Ejecución detrás del filesystem/proxy de staging. |
| CHO-012 | Corregido en superficies auditadas: filtros/KPIs reducidos y DatePicker. | Revisión visual/responsive completa del resto de rutas. |
| CHO-013 | Corregido con variante compartida: `icon-mobile`/`icon-mobile-sm` en `components/ui/button.tsx`, aplicada en Usuarios, stock mínimo y las dos cotizaciones (repuestos/servicios) (Pasada 7). | Aplicar la variante al resto de botones de icono de la app (~13 archivos restantes detectados por grep: PDTP, prevención, dashboard, trazabilidad, etc.); auditoría manual teclado/touch de toda la app. |
| CHO-014 | Corregido: ExcelJS queda en import dinámico; build/bundle no lo cargan en la ruta de importación. | Medición completa de chunks en CI y rutas restantes. |
| CHO-015 | Corregido: cobertura reproducible en clean run (64,63/52,6/69,07/68,08%), presupuesto de bundle en CI, E2E global completa desde arnés limpio — 4 corridas completas entre Pasadas 8-9 (128/143 → 138/143 → 139/143 → 139/143, 2 skipped) — y ahora wireada como gate de CI (Pasada 10: paso único "E2E full suite" + `retries: 1` en CI para absorber contención de runner). Se corrigieron 11 bugs/selectores reales en el triage: 2 bugs de app reales (`revalidateTag` huérfano en 6 archivos; carrera `redirect` cliente vs `revalidatePath` en creación de PDTP) y una regla de negocio no satisfecha por los fixtures (cotizaciones/notas). | Confirmar la primera corrida real en GitHub Actions (no ejecutable desde este checkout); correr en un runner sin contención para ver si la fragilidad puntual de 1-2 tests desaparece del todo. |
| CHO-016 | Corregido: benchmark y fixture TAE incluyen tipo de equipo válido/equipment type; TAE aislado pasó 3/3, incluido histórico de 971 filas. | E2E global y validación externa del flujo público en staging. |
| CHO-017 | Corregido en PRODUCT/README y bitácora. | Revisar documentación operativa adicional en staging/release. |

## Resumen Ejecutivo de la línea base

La línea base confirmó dos bypasses de alcance de faena: uno exponía y permitía modificar trabajadores fuera del alcance del usuario; el otro agrupaba varias mutaciones de Combustibles que aceptaban IDs o creaban faenas sin aplicar el scoping de la sesión. También se documentaron descargas IDOR de cotizaciones, carreras en estados de OC y desechos de stock, un editor de roles funcionalmente roto, un deploy que podía dejar corriendo una imagen anterior y límites de carga contradictorios. Los cambios y la evidencia posterior están en la bitácora y en la matriz de estado actual.

**Lectura actual (post Pasada 10):** los 17 hallazgos tienen corrección de código, documentación y test negativo específico donde aplica (CHO-001/002/003 con 30 tests contra PGlite **y** 30 tests equivalentes contra PostgreSQL real, corriendo ambos en CI); la cobertura completa es reproducible en clean run (64,63/52,6/69,07/68,08%); la E2E global corre completa de forma repetida (139/143 en la última corrida, 2 skipped, fallos puntuales restantes confirmados como contención de entorno tras 4 corridas completas) y ya está wireada como gate de CI (`retries: 1` para absorber esa contención). Todo lo accionable dentro de este checkout local está cerrado. La salida continúa **NO-GO sin restricciones** únicamente por evidencia que requiere infraestructura fuera de este checkout: DSN de Sentry productivo y deploy/rollback verificado en staging.

| Severidad | Cantidad |
|---|---:|
| 🔴 Crítica | 2 |
| 🟠 Alta | 6 |
| 🟡 Media | 8 |
| 🔵 Baja | 1 |
| **Total** | **17** |

### Cinco riesgos principales

1. **PII y mutación cross-faena de trabajadores:** roles acotados reciben `admin:workers`, pero exportación e importación operan sobre todos los trabajadores.
2. **Bypass de alcance en Combustibles:** operaciones masivas, creación de faenas durante importación y vinculación de vehículos confían en IDs del cliente sin validar el alcance completo.
3. **Estados e inventario vulnerables a concurrencia:** las transiciones de OC y la rama `egreso_desecho` usan read-then-write sin lock ni compare-and-set.
4. **Deploy no determinista y desacoplado de CI:** `IMAGE_TAG` no se exporta, se usa una opción inexistente de Compose y el workflow puede declarar éxito sobre la imagen anterior.
5. **Gates incompletos:** la corrida E2E amplia se interrumpió tras 51 pasados y 5 fallos de contrato/fixture; las suites focales corregidas de PPA (4/4), TAE (3/3) y toggles (5/5) ya están verdes, pero falta una ejecución global completa y su gate en CI.

### Controles que sí resultaron sanos

- `npm run check:secrets`: aprobado.
- `npm audit --audit-level=high` y auditoría de producción: 0 vulnerabilidades conocidas.
- `npm run check:drizzle-aliases`: aprobado.
- `npm run typecheck`: aprobado.
- `npm run lint`: aprobado.
- `npm test`: 289 archivos aprobados, 5 omitidos; 2.617 tests aprobados, 6 omitidos.
- `npm run test:coverage`: última ejecución completa aprobada (Pasada 7, clean run reproducible) con 64,63 % statements, 52,6 % branches, 69,07 % functions y 68,08 % lines.
- `npm run build`: aprobado con Next.js 16.2.10/Turbopack.
- PostgreSQL real: 6/6 pruebas de concurrencia aprobadas para aprobaciones, entregas, recepción, egreso normal de stock y rate limit.
- 63 migraciones SQL y 63 entradas del journal; índices contiguos, tags uno-a-uno y timestamps estrictamente crecientes.
- Los exportes revisados usan Excel; no se encontró un flujo de exportación CSV.

## Hallazgos Detallados

### CHO-001 — Exportación e importación de trabajadores ignoran el alcance de faena

- **Severidad:** 🔴 Crítica
- **Tipo:** Seguridad / autorización / privacidad
- **Certeza:** Confirmado por código y por contraste entre la página acotada y sus endpoints
- **Archivos y líneas:** `app/api/admin/catalogos/export/route.ts:26-53,165-180`; `app/(app)/admin/trabajadores/actions.ts:148-193`; `lib/services/catalog-import.ts:72-92`; `modules/admin/manifest.ts:137-139`; referencia correcta en `app/(app)/admin/trabajadores/page.tsx:17-31`
- **Ruta/flujo:** `/admin/trabajadores` → `GET /api/admin/catalogos/export?tipo=trabajadores` → importación Excel
- **Problema:** `admin:workers` se concede a roles acotados por faena, pero el export consulta todos los trabajadores sin `worksiteScopeSql`. El import confía en la columna `ID` del Excel y actualiza por `workers.id` sin verificar que el trabajador pertenezca a una faena accesible. La creación usa la faena primaria o el literal `ws-default`, no una faena autorizada elegida/validada.
- **Impacto:** exposición de RUT, nombre, cargo, supervisor, prevencionista y faena de toda la organización; modificación cross-faena de PII; asignaciones incorrectas a `ws-default`.
- **Reproducción:** iniciar sesión como `solicitante_faena` o `prevencionista_faena`; solicitar el Excel de trabajadores y observar registros de otras faenas. Luego importar una fila cuyo `ID` corresponda a un trabajador fuera del alcance y modificar su cargo o estado.
- **Código exacto:**

```ts
case "trabajadores":
  report = await buildTrabajadoresReport()

const allWorkers = await db
  .select({ /* PII */ })
  .from(workers)
  .leftJoin(worksites, eq(workers.worksiteId, worksites.id))

await tx.update(workers).set({ /* datos del Excel */ })
  .where(eq(workers.id, row.existingId!))
```

- **Solución propuesta:** resolver el alcance una sola vez desde la sesión y aplicarlo en SQL al export. En import, cargar y bloquear los IDs existentes dentro de ese mismo alcance, rechazar IDs desconocidos/fuera de scope y exigir una faena destino accesible para nuevas filas. Agregar pruebas de integración con dos faenas y un rol no global.
- **Dependencias/orden:** corregir antes de permitir exportes/importes a roles acotados; revisar auditoría y notificar si estos endpoints ya estuvieron expuestos en producción.

### CHO-002 — Mutaciones de Combustibles permiten actuar fuera del alcance asignado

- **Severidad:** 🔴 Crítica
- **Tipo:** Seguridad / autorización / integridad multi-faena
- **Certeza:** Confirmado por código en tres caminos independientes
- **Archivos y líneas:** `app/(app)/combustibles/actions-module/vehicles.ts:232-255`; `app/api/combustibles/import/route.ts:66-118,157-180`; `app/(app)/combustibles/actions-consumos.ts:324-357`; `modules/combustibles/manifest.ts:123-131`
- **Ruta/flujo:** catálogo de vehículos de combustible; `POST /api/combustibles/import`; vinculación de patente en detalle de lote
- **Problema:** la acción masiva descarta la sesión y actualiza todos los IDs recibidos. El import crea faenas marcadas `CREATE_FAENA` antes de validar acceso y, cuando las cargas posteriores son rechazadas por scope, la transacción conserva la faena creada. La vinculación valida la faena del lote, pero no que el `vehicleId` pertenezca a esa misma faena o al alcance del usuario.
- **Impacto:** activación/desactivación de flota ajena, creación no autorizada de maestros globales y relaciones cross-faena que corrompen consumos e indicadores.
- **Reproducción:** con un rol `admin_contrato` o de faena, enviar a la Server Action IDs de vehículos de otra faena; importar un archivo con `faenaMapping: CREATE_FAENA` y cargas que después fallen scope; o vincular una patente de un lote autorizado con el ID de un vehículo restringido.
- **Código exacto:**

```ts
await requirePermission("combustibles:manage_vehicles")
await db.update(fuelVehicles)
  .set({ isActive: activate, updatedAt: now })
  .where(inArray(fuelVehicles.id, ids))

await tx.insert(worksites).values({ id, name, code, isActive: true })
// canAccessWorksite(...) ocurre después, por cada carga.

const vehicle = await db.query.fuelVehicles.findFirst({
  where: eq(fuelVehicles.id, vehicleId),
})
```

- **Solución propuesta:** centralizar guards `permission + worksite scope`; añadir `worksiteScopeSql` a toda mutación masiva; prohibir `CREATE_FAENA` a roles no globales o exigir `admin:worksites`; validar `vehicle.worksiteId === batch.worksiteId`; comprobar el número real de filas mutadas.
- **Dependencias/orden:** corrección inmediata y revisión de todas las actions bajo `actions-module/` y rutas de importación que reciben IDs.

### CHO-003 — IDOR en descargas de cotizaciones con permisos `view_own`

- **Severidad:** 🟠 Alta
- **Tipo:** Seguridad / control de acceso a archivos
- **Certeza:** Confirmado por código; la página de detalle implementa la regla correcta y las rutas de archivo no
- **Archivos y líneas:** `app/api/repuestos/quotaciones/[id]/route.ts:14-44`; `app/api/servicios/cotizaciones/[id]/route.ts:14-44`; `app/(app)/solicitudes/[id]/page.tsx:53-63`; `modules/repuestos/manifest.ts:13-18,43-50`; `modules/servicios/manifest.ts:13-18,43-50`
- **Ruta/flujo:** `GET /api/repuestos/quotaciones/:id` y `GET /api/servicios/cotizaciones/:id`
- **Problema:** las rutas aceptan `view_own` o `view_all`, pero después solo validan que la solicitud padre esté en una faena accesible. `requesterId` se consulta y nunca se compara con `session.user.id`. La página sí exige propietario o `view_all`.
- **Impacto:** un usuario con `view_own` puede descargar cotizaciones de otro solicitante de su misma faena si conoce o filtra el ID.
- **Reproducción:** crear dos usuarios de la misma faena con `repuestos:view_own`; obtener el ID de una cotización del usuario A y solicitarlo autenticado como B. La ruta no ejecuta el control de propietario.
- **Código exacto:**

```ts
if (!can(session, "repuestos:view_own") && !can(session, "repuestos:view_all")) {
  return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
}
const request = await db.query.purchaseRequests.findFirst({
  columns: { worksiteId: true, requesterId: true },
})
if (!request || !canAccessWorksite(session, request.worksiteId)) { /* 404 */ }
```

- **Solución propuesta:** replicar la política de la página: `view_all || (view_own && requesterId === session.user.id && canAccessWorksite(...))`; devolver 404 para evitar enumeración; cubrir repuestos y servicios con tests de propietario/no propietario.
- **Dependencias/orden:** puede resolverse independientemente, antes del próximo despliegue.

### CHO-004 — Transiciones de órdenes de compra son vulnerables a carreras

- **Severidad:** 🟠 Alta
- **Tipo:** Lógica de negocio / concurrencia / integridad
- **Certeza:** Confirmado por código; no existe una prueba PostgreSQL para estados de OC
- **Archivos y líneas:** `lib/services/purchasing-module/purchase-orders-status.ts:13-35,59-91,145-167,238-254`; `lib/services/purchasing-module/receiving.ts:23-39`; `lib/services/receiving.ts:58-69`
- **Ruta/flujo:** emitir, enviar, cancelar, confirmar y cerrar OC; recepción simultánea
- **Problema:** cada transición lee el estado y luego actualiza por `id` solamente. No usa `SELECT ... FOR UPDATE`, `WHERE status = expected` ni verifica `returning`. Dos transacciones pueden validar el mismo estado y aplicar transiciones incompatibles. El caso más riesgoso es cancelar mientras otra sesión registra recepción: pueden quedar recepción/stock confirmados y la OC finalmente `cancelled`.
- **Impacto:** estados imposibles, stock contabilizado para OC canceladas, auditorías contradictorias y pérdida del orden causal.
- **Reproducción:** lanzar en paralelo `cancelOrder` y la recepción para una OC `sent`, o dos transiciones desde `issued`; ambas leen el estado previo antes de que una confirme.
- **Código exacto:**

```ts
const order = await tx.query.purchaseOrders.findFirst({
  where: eq(purchaseOrders.id, orderId),
})
if (order.status !== "issued") throw new Error(/* ... */)
await tx.update(purchaseOrders)
  .set({ status: "sent", sentAt: now, updatedAt: now })
  .where(eq(purchaseOrders.id, orderId))
```

- **Solución propuesta:** bloquear la OC al inicio de toda transición o realizar compare-and-set atómico (`WHERE id = ? AND status = ? RETURNING`). En recepción/cancelación, bloquear la misma fila antes de tocar ítems/stock. Añadir un test PostgreSQL `cancel vs receive` y una matriz de transiciones concurrentes.
- **Dependencias/orden:** definir primero la máquina de estados canónica; luego ajustar historial y tests.

### CHO-005 — `egreso_desecho` pierde actualizaciones concurrentes de stock

- **Severidad:** 🟠 Alta
- **Tipo:** Lógica de negocio / inventario / concurrencia
- **Certeza:** Confirmado por código; la prueba PostgreSQL existente cubre `egreso_entrega`, no esta rama
- **Archivos y líneas:** `lib/services/stock-movement.ts:75-130`; `lib/__tests__/stock-concurrency-postgres.test.ts:55-90`
- **Ruta/flujo:** descarte/desecho de inventario
- **Problema:** la rama lee cantidad, calcula un valor absoluto y lo escribe sin lock ni condición sobre la cantidad anterior. Dos desechos simultáneos pueden leer el mismo stock y sobrescribirse; ambos movimientos quedan registrados, pero el saldo refleja solo uno.
- **Impacto:** kardex y saldo físico divergen; auditoría indica más material desechado que el realmente descontado.
- **Reproducción:** con stock 10, ejecutar simultáneamente dos desechos de 4. Ambos pueden registrar `stockBefore=10`, `stockAfter=6`; el saldo final queda 6 en vez de 2.
- **Código exacto:**

```ts
const existing = await tx.query.worksiteStock.findFirst({ where: /* ... */ })
const currentQty = existing?.quantity ?? 0
const deductQty = currentQty > 0 ? Math.min(input.quantity, currentQty) : 0
const newQty = currentQty - deductQty
await tx.update(worksiteStock)
  .set({ quantity: newQty, lastMovementAt: now, updatedAt: now })
  .where(and(eq(worksiteStock.worksiteId, input.worksiteId),
             eq(worksiteStock.productId, input.productId)))
```

- **Solución propuesta:** reutilizar el delta SQL atómico de los otros egresos o bloquear la fila `worksite_stock`; insertar el movimiento desde los valores devueltos dentro de la misma transacción. Agregar el caso concurrente específico de desecho.
- **Dependencias/orden:** independiente, pero debe salir junto con CHO-004 como hardening transaccional.

### CHO-006 — El editor de roles falla con múltiples permisos y con roles protegidos

- **Severidad:** 🟠 Alta
- **Tipo:** Lógica de negocio / administración / RBAC
- **Certeza:** Confirmado por código; la cobertura reporta `lib/services/admin-roles.ts` en 0 %
- **Archivos y líneas:** `lib/services/admin-roles.ts:153-162`; `app/(app)/admin/roles/role-form.tsx:105-108,124,149-156`; `app/(app)/admin/roles/actions.ts:36-49`; `lib/__tests__/admin-roles-actions.test.ts:31-36,61-84`
- **Ruta/flujo:** `/admin/roles` → crear/editar rol
- **Problema:** la validación compone `permission.id = A AND permission.id = B`; con dos IDs distintos devuelve cero filas y siempre lanza. Para roles protegidos, el input `name` está `disabled`, por lo que no viaja en el `FormData`, pero la acción exige un nombre. Los tests mockean el servicio defectuoso y no ejercitan SQL real.
- **Impacto:** no se pueden crear/editar roles reales con varios permisos; el administrador protegido no puede guardarse; la gestión RBAC aparenta estar cubierta sin estarlo.
- **Reproducción:** seleccionar dos permisos en un rol y guardar; `assertPermissionsExist` recibe ambos y falla. Editar `administrador` y guardar; la acción retorna “Ingresa un nombre de rol”.
- **Código exacto:**

```ts
.where(and(...permissionIds.map((pid) => eq(permissions.id, pid))))

<Input name="name" disabled={editRole?.isProtected} />

const name = (formData.get("name") as string | null)?.trim() ?? ""
if (!name) return { ok: false, fieldErrors: { name: ["Ingresa un nombre de rol"] } }
```

- **Solución propuesta:** reemplazar por `inArray(permissions.id, permissionIds)` y comparar IDs únicos; enviar el slug protegido mediante hidden input o recuperarlo por `id` en servidor; probar el servicio real contra PostgreSQL con 0, 1 y N permisos.
- **Dependencias/orden:** corregir antes de delegar administración RBAC a usuarios finales.

### CHO-007 — El workflow de deploy puede conservar la imagen anterior y no depende de CI

- **Severidad:** 🟠 Alta
- **Tipo:** Configuración / DevOps / confiabilidad de release
- **Certeza:** Confirmado por código y por la CLI local de Docker Compose 5.3.1; no ejecutado contra producción
- **Archivos y líneas:** `.github/workflows/deploy.yml:108-160`; `docker-compose.yml:25-35`; `.github/workflows/ci.yml:89-96`
- **Ruta/flujo:** push a rama desplegable → GHCR → SSH → `docker compose up`
- **Problema:** `IMAGE_TAG=${{ github.sha }}` es una variable shell no exportada, por lo que Compose no la recibe. `docker compose pull --image-tag` no es una opción válida. Se crea una etiqueta `${SHA}-deploy`, pero Compose referencia `${IMAGE_TAG:-latest}`, nunca `-deploy`. El healthcheck puede responder desde la imagen previa y declarar éxito. Además, el workflow de deploy no depende del workflow CI; solo de jobs internos de build/sync.
- **Impacto:** despliegues falsamente exitosos, rollback ineficaz y posibilidad de publicar aunque lint/tests/benchmark fallen.
- **Reproducción:** ejecutar el bloque en un host sin `IMAGE_TAG` exportado; `docker compose config` resuelve `latest` o el valor del `.env`, no el SHA shell. `docker compose pull --help` no lista `--image-tag`.
- **Código exacto:**

```sh
IMAGE_TAG=${{ github.sha }}
docker compose pull app --image-tag ${IMAGE_TAG} || docker pull ...:${IMAGE_TAG}
docker tag ...:${IMAGE_TAG} ...:${IMAGE_TAG}-deploy
docker compose up -d --no-deps app
```

```yaml
image: ghcr.io/${GITHUB_REPOSITORY:-chome/bodega}:${IMAGE_TAG:-latest}
```

- **Solución propuesta:** ejecutar `export IMAGE_TAG GITHUB_REPOSITORY`; eliminar `--image-tag`; validar con `docker compose config --images`; inspeccionar el digest/label del contenedor después de `up`; hacer deploy mediante `workflow_run` condicionado a CI exitoso o fusionar los gates en un único workflow. El rollback debe restaurar una referencia que Compose realmente use.
- **Dependencias/orden:** bloqueante de release; probar en staging con dos SHAs distinguibles.

### CHO-008 — Next.js rechaza archivos que la aplicación anuncia como válidos

- **Severidad:** 🟠 Alta
- **Tipo:** Configuración / funcionalidad / carga de archivos
- **Certeza:** Confirmado por configuración y por la guía local de Next.js 16 instalada
- **Archivos y líneas:** `next.config.ts:15-20`; `app/(app)/flota/actions.ts:28-40`; `app/(app)/soporte/actions.ts:51-60`; `app/(app)/combustibles/tae/importar/actions.ts:16,37-78`; `app/(app)/combustibles/actions-operaciones.ts:55-65`; `lib/services/system-settings.ts:18-48`
- **Ruta/flujo:** documentos de flota, adjuntos de soporte, importaciones TAE y operaciones, importación de productos/EPP
- **Problema:** el límite global de Server Actions es 6 MB, mientras las actions aceptan explícitamente 10 o 20 MB. Next.js rechaza el request antes de que se ejecute la validación de dominio. El setting administrable `feedbackAttachmentMaxMb` admite hasta 100 MB, pero el runtime usa 20 MB hardcodeados y el upstream sigue en 6 MB.
- **Impacto:** archivos de 6–20 MB que la interfaz considera válidos fallan con un error de infraestructura; configuración administrativa engañosa; soporte operativo difícil de diagnosticar.
- **Reproducción:** subir un PDF de 8 MB en Flota o un histórico TAE de 8 MB mediante la Server Action. No alcanza el `if (file.size > 20 MB)`.
- **Código exacto:**

```ts
experimental: {
  serverActions: { bodySizeLimit: "6mb" },
}

const MAX_MB = 20
if (file.size > MAX_MB * 1024 * 1024) { /* mensaje de dominio */ }
```

- **Solución propuesta:** fijar un contrato único. Si se requieren 20/25 MB, elevar el cap con margen controlado y validar MIME/magic bytes/tamaño en cada acción; si no, bajar UI/actions/settings a 6 MB. Para volúmenes mayores, preferir ruta de upload autenticada/streaming y límites del proxy coordinados.
- **Dependencias/orden:** revisar Nginx/ingress y almacenamiento antes de elevar el cap.

### CHO-009 — El historial registra estados de origen falsos

- **Severidad:** 🟡 Media
- **Tipo:** Lógica de negocio / auditoría
- **Certeza:** Confirmado por código
- **Archivos y líneas:** `lib/services/item-state-module/purchase-order.ts:45-75`; `lib/services/purchasing-module/purchase-orders-status.ts:169-199`; `lib/services/purchasing-module/purchase-orders-delete.ts:54-75`
- **Ruta/flujo:** añadir ítem a OC, cancelar OC, eliminar borrador
- **Problema:** después del `UPDATE ... RETURNING`, se usa el estado nuevo como `fromStatus`, produciendo `in_purchase_order → in_purchase_order`. Cancelación y eliminación aceptan ítems en dos estados, pero escriben un único origen fijo (`purchased` o `in_purchase_order`) para todos.
- **Impacto:** timeline y auditoría no pueden reconstruir el flujo real; reportes de cumplimiento y diagnóstico quedan contaminados.
- **Reproducción:** mover un ítem `approved` a una OC y consultar `status_history`; el origen será el estado actualizado. Cancelar una OC con ítems aún `in_purchase_order`; el historial los marca como provenientes de `purchased`.
- **Código exacto:**

```ts
const [updated] = await tx.update(purchaseRequestItems)
  .set({ status: "in_purchase_order" })
  .returning({ status: purchaseRequestItems.status })

fromStatus: updated.status,
toStatus: "in_purchase_order",
```

- **Solución propuesta:** conservar `locked.status` por ítem o retornar/leer el estado anterior antes del update; para lotes heterogéneos, registrar cada transición con su origen real. Añadir aserciones de historial a los tests de máquina de estados.
- **Dependencias/orden:** coordinar con CHO-004 para no duplicar locks.

### CHO-010 — Sentry no está conectado al ciclo de instrumentación de Next.js 16

- **Severidad:** 🟡 Media
- **Tipo:** Observabilidad / configuración
- **Certeza:** Confirmado por código y documentación oficial actual de Sentry; entrega real no probada sin DSN
- **Archivos y líneas:** `instrumentation.ts:1-8`; `lib/sentry.ts:13-30`; `app/global-error.tsx:1-14`; `sentry.server.config.ts`; `sentry.client.config.ts`
- **Ruta/flujo:** arranque del servidor, errores de request, errores globales cliente
- **Problema:** `instrumentation.ts` solo valida env; no importa `sentry.server.config`/`sentry.edge.config` ni exporta `onRequestError`. No existe `instrumentation-client.ts`. El wrapper asume erróneamente que `withSentryConfig` inicializa esos archivos “eagerly”; `global-error` solo llama `console.error`.
- **Impacto:** errores de servidor, edge y render pueden no llegar a Sentry aunque exista DSN; falsa percepción de monitoreo.
- **Reproducción:** inspeccionar el grafo de instrumentación o provocar una excepción con DSN de prueba y verificar que no hay inicialización explícita en los entrypoints requeridos.
- **Código exacto:**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") validateEnv()
}

// Comentario actual, no respaldado por el entrypoint:
// Sentry is initialized eagerly by sentry.server.config.ts / sentry.client.config.ts
```

- **Solución propuesta:** seguir el [manual oficial de Sentry para Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/): import dinámico server/edge en `register`, `export const onRequestError = Sentry.captureRequestError`, inicialización cliente en `instrumentation-client.ts` y captura en `global-error`. Añadir un smoke test con proyecto/DSN de staging.
- **Dependencias/orden:** requiere DSN de staging; no bloquear el fix de código por no disponer del DSN productivo.

### CHO-011 — Alta de soporte no es atómica entre disco, reporte y adjunto

- **Severidad:** 🟡 Media
- **Tipo:** Integridad / almacenamiento / configuración
- **Certeza:** Confirmado por código
- **Archivos y líneas:** `app/(app)/soporte/actions.ts:51-101`; `lib/services/feedback.ts:35-74`; `lib/services/system-settings.ts:18-48,70-93`
- **Ruta/flujo:** `/soporte/nuevo` con comprobante
- **Problema:** el archivo se escribe antes de crear el reporte. Luego reporte y attachment se insertan en sentencias separadas sin transacción. Si falla DB, queda un archivo huérfano; si falla el attachment, queda el reporte comprometido aunque la action responda error. El setting de tamaño de adjunto tampoco se consulta en este flujo.
- **Impacto:** basura en storage, reintentos duplicados y reportes sin evidencia asociada.
- **Reproducción:** provocar una falla de DB después de `fs.writeFile` o una constraint al insertar attachment; observar que el rollback lógico no elimina archivo/reporte.
- **Código exacto:**

```ts
await fs.writeFile(absolutePath, Buffer.from(fileBuf))
const report = await createReport(parsed.data, session.user.id, proofAttachment)

const [report] = await db.insert(feedbackReports).values(/* ... */).returning()
if (proofAttachment) await db.insert(attachments).values(/* ... */)
```

- **Solución propuesta:** transacción DB para reporte+metadata; escritura temporal y rename final después del commit, con compensación explícita ante fallos; job de garbage collection; leer `getOperationalSettings()` al validar tamaño.
- **Dependencias/orden:** coordinar con CHO-008 para un contrato único de tamaños.

### CHO-012 — Pantallas ejecutivas incumplen límites de densidad y controles canónicos

- **Severidad:** 🟡 Media
- **Tipo:** Frontend / UX / consistencia
- **Certeza:** Confirmado por código contra las reglas A1, A2 y A6 del repositorio
- **Archivos y líneas:** `app/(app)/combustibles/tae/tae-filters.tsx:19-31`; `app/(app)/reportes/page.tsx:125-151,217-230`; `app/(app)/analitica/page.tsx:89-127`; `app/(app)/combustibles/tae/page.tsx:140-143`
- **Ruta/flujo:** `/combustibles/tae`, `/reportes`, `/analitica`
- **Problema:** TAE muestra ocho controles/filtros visibles y usa dos `input type="date"` en vez del DatePicker. Reportes y Analítica presentan cinco tiles KPI simultáneos, no accionables. Las reglas del checkout exigen 4–6 filtros primarios con “Más filtros”, DatePicker y máximo cuatro tiles accionables.
- **Impacto:** “muro de controles”, peor escaneo en laptop/móvil, fechas dependientes del locale y métricas que ocupan espacio sin guiar acciones.
- **Reproducción:** abrir las rutas en viewport pequeño de laptop; antes del contenido principal se ven ocho filtros o cinco KPIs sin affordance de navegación/filtrado.
- **Código exacto:**

```tsx
<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
  <Input name="from" type="date" />
  <Input name="to" type="date" />
  {/* faena, punto, estado, sellos, evidencia, búsqueda */}
</div>

<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
  {metrics.map((metric) => <section>{/* 5 KPIs */}</section>)}
</div>
```

- **Solución propuesta:** dejar período, faena, estado y búsqueda como primarios; mover el resto a “Más filtros (N)” y mostrar chips activos. Usar `DatePicker`. Consolidar KPIs secundarios en `MetricBar` y hacer accionables los cuatro decisivos.
- **Dependencias/orden:** no bloquea seguridad; abordar por pantalla con pruebas responsive.

### CHO-013 — Targets móviles y nombres accesibles son insuficientes en acciones críticas

- **Severidad:** 🟡 Media
- **Tipo:** Accesibilidad / responsive / design system
- **Certeza:** Confirmado por código; axe E2E no detecta tamaño táctil
- **Archivos y líneas:** `components/ui/button.tsx:50-56`; `app/(app)/admin/usuarios/user-list.tsx:153-183,228-259`; `app/(app)/bodega/stock-table.tsx:67`; `docs/diseño/DESIGN.md:448-452`
- **Ruta/flujo:** acciones de tablas y tarjetas en móvil
- **Problema:** el design system define botones de 28, 32 y 36 px; el propio DESIGN exige 44×44 px en targets críticos móviles. En Usuarios, editar y activar/desactivar son 32×32 y dependen de `title`, sin `aria-label`; eliminar sí tiene label, demostrando inconsistencia.
- **Impacto:** mayor tasa de toque erróneo y acciones de icono ambiguas para tecnologías asistivas.
- **Reproducción:** viewport móvil en `/admin/usuarios`; medir los controles de la tarjeta y navegar por nombres accesibles. Los botones editar/toggle quedan por debajo de 44 px y no incluyen el usuario en su nombre.
- **Código exacto:**

```ts
sm: "h-7 px-3 text-xs",
default: "h-8 px-4",
lg: "h-9 px-5 text-[13px]",
icon: "h-8 w-8 p-0",
"icon-sm": "h-7 w-7 p-0",
```

- **Solución propuesta:** mantener densidad visual mediante icono pequeño y hit-area mínima `min-h-11 min-w-11` en móvil; añadir `aria-label` contextual a toda acción de icono; crear una variante `icon-mobile` y testearla.
- **Dependencias/orden:** cambio de sistema con revisión visual para no aumentar innecesariamente tablas desktop.

### CHO-014 — ExcelJS se carga de forma eager en rutas cliente de Combustibles

- **Severidad:** 🟡 Media
- **Tipo:** Rendimiento / bundle cliente
- **Certeza:** Confirmado por import y artefacto del build de producción
- **Archivos y líneas:** `lib/combustibles/wizard-helpers.tsx:1-24`; `.next/diagnostics/route-bundle-stats.json`; chunk `.next/static/chunks/3dtoegaq6-47y.js`
- **Ruta/flujo:** `/combustibles/importar`, `/combustibles/facturas`, revisión de importación de productos
- **Problema:** `wizard-helpers.tsx` importa `exceljs` estáticamente aunque solo se usa al descargar errores. El chunk asociado pesa 931.235 bytes sin comprimir. El build reporta 2.201.854 bytes first-load JS para `/combustibles/importar`, 2.192.366 para `/combustibles/facturas` y 2.026.654 para `/admin/productos/importar/[batchId]`.
- **Impacto:** parse/descarga innecesaria antes de que el usuario pida un Excel, especialmente costosa en faena con red o dispositivo limitado.
- **Reproducción:** ejecutar build y revisar `route-bundle-stats.json`; el chunk de 931 KB está en el first-load de las rutas.
- **Código exacto:**

```tsx
import * as ExcelJS from "exceljs"

export function downloadErrorsXlsx(/* ... */) {
  const workbook = new ExcelJS.Workbook()
  // Solo se necesita después del clic.
}
```

- **Solución propuesta:** `const ExcelJS = await import("exceljs")` dentro del handler o generar el Excel en una ruta/Server Action; separar helpers visuales de helpers de exportación para que el bundler pueda cortar la dependencia. Añadir presupuesto de first-load por ruta.
- **Dependencias/orden:** medir después del cambio con el mismo build.

### CHO-015 — Los gates automatizados no representan los flujos críticos

- **Severidad:** 🟡 Media
- **Tipo:** Tests / CI / regresión
- **Certeza:** Confirmado por configuración y por reproducciones E2E focalizadas; la corrida global quedó interrumpida
- **Archivos y líneas:** `.github/workflows/ci.yml:89-96`; `vitest.config.ts:26-45`; `lib/__tests__/admin-roles-actions.test.ts:31-36,61-84`; múltiples specs bajo `e2e/`
- **Ruta/flujo:** pipeline CI y suite local completa
- **Problema:** CI mantiene axe y el smoke de rutas críticas, pero aún no ejecuta la suite E2E completa. La corrida amplia de esta pasada fue interrumpida tras **51 pasados, 5 fallos y un caso en curso**; los fallos reproducidos de EPP, Flota, PPA, TAE, Combustibles y toggles se aislaron y las suites focales actualizadas quedaron verdes. La prueba negativa de rate limit puede bloquear logins posteriores por la misma IP. La cobertura ahora incluye rutas API y actions auditadas, pero la repetición completa del runner quedó prolongada y no terminó.
- **Impacto:** PRs verdes con flujos rotos; falsos positivos de cobertura; timeouts de 150 s hacen lento el feedback y esconden el primer punto causal.
- **Reproducción:** `npm run test:e2e`; contrastar con el smoke/axe E2E que actualmente ejecuta el workflow. `npm run test:coverage` usa un denominador ampliado de rutas/API auditadas, pero no representa cobertura global de toda la aplicación.
- **Código exacto:**

```yaml
- name: E2E accessibility audit
  run: npx playwright test e2e/accessibility.spec.ts
```

```ts
coverage: {
  include: ["lib/**/*.ts", "app/**/actions.ts"],
}
vi.mock("@/lib/services/admin-roles", () => ({
  assertPermissionsExist: mockAssertPermissionsExist,
}))
```

- **Solución propuesta:** clasificar E2E en smoke bloqueante y suites de dominio; actualizar fixtures/selectores al contrato actual; aislar rate limit por key/IP/servidor; ejecutar smoke de compras, RBAC, trabajadores y combustibles en CI; incluir rutas API y `actions-*/**` en cobertura; reemplazar mocks críticos por integración PostgreSQL.
- **Dependencias/orden:** primero estabilizar seeds y eliminar timeouts estructurales; luego convertir los smoke en required checks.

### CHO-016 — El benchmark de rendimiento está roto por deriva del esquema

- **Severidad:** 🟡 Media
- **Tipo:** Rendimiento / tooling / esquema
- **Certeza:** Confirmado por ejecución contra PostgreSQL desechable
- **Archivos y líneas:** `scripts/measure-operational-queries.ts:375-386,421-428`; `e2e/tae-reconciliation.spec.ts:5-18`; `.github/workflows/ci.yml:83-87`
- **Ruta/flujo:** `npm run perf:queries`; conciliación TAE E2E
- **Problema:** el seed inserta `fuel_vehicles` sin `equipmentTypeId`, columna actualmente `NOT NULL`. El benchmark termina antes de medir y la E2E de conciliación falla por la misma constraint. Es un step requerido de CI, por lo que el pipeline actual también debería quedar rojo; aun así, CHO-007 permite que el workflow de deploy avance por separado.
- **Impacto:** no existe evidencia vigente del SLO de 1.000 ms; fixtures no detectan/adoptan cambios obligatorios; release y CI discrepan.
- **Reproducción:** `PERF_DATABASE_URL=... PERF_ALLOW_DESTRUCTIVE_RESET=true npm run perf:queries`; PostgreSQL responde `23502 null value in column "equipment_type_id"`. La E2E de conciliación falla en 1 ms por la misma razón.
- **Código exacto:**

```ts
await insertChunks(db, schema.fuelVehicles, Array.from({ length: 60 }, (_, index) => ({
  id: `perf-vehicle-${index + 1}`,
  plate: `PERF-${index + 1}`,
  type: index % 3 === 0 ? "camion" : "camioneta",
  // equipmentTypeId ausente
})))
```

- **Solución propuesta:** sembrar primero tipos de equipo canónicos y referenciarlos; construir fixtures mediante factories tipadas sin casts `as never`; reutilizar la misma factory en E2E y benchmark; ejecutar el benchmark en CI antes del build y conservar su tabla de tiempos como artefacto.
- **Dependencias/orden:** actualizar fixture antes de afirmar cualquier SLO de consultas.

### CHO-017 — La documentación de producto y enlaces están desactualizados

- **Severidad:** 🔵 Baja
- **Tipo:** Documentación / mantenibilidad
- **Certeza:** Confirmado por contraste con el checkout
- **Archivos y líneas:** `docs/planificacion/PRODUCT.md:22-32,97-104,155-164,195-200`; `lib/auth/rbac.ts:18-23`; `README.md:84-93`
- **Ruta/flujo:** onboarding técnico y decisiones de producto
- **Problema:** PRODUCT habla de 23 permisos, siete secciones admin y caché RBAC de 60 s; el registro vigente tiene 109 permisos, la administración creció y el runtime usa 5 s. Declara transferencias/devoluciones/rechazos de stock que no corresponden a la unión de movimientos actual. README enlaza `docs/diseno/DESIGN.md`, pero el archivo vive en `docs/diseño/DESIGN.md`.
- **Impacto:** agentes y mantenedores toman decisiones sobre un contrato antiguo; enlace de diseño roto en sistemas sensibles a acentos/rutas.
- **Reproducción:** seguir el enlace README o comparar `RBAC_CACHE_TTL_MS = 5_000` con “60s” en PRODUCT.
- **Código exacto:**

```md
**Administrador** | Todas las faenas | Control total del sistema, 23 permisos
**RBAC con caché de 60s**
[docs/diseno/DESIGN.md](docs/diseno/DESIGN.md)
```

- **Solución propuesta:** actualizar PRODUCT desde `modules/registry.ts` y los manifiestos vivos, describir el inventario por capacidades y no congelar conteos cuando no son contractuales; corregir el enlace o normalizar la carpeta sin romper referencias.
- **Dependencias/orden:** después de cerrar cambios de RBAC/stock para no documentar dos veces.

## Resumen por Área

| Área | Total | 🔴 Críticos | 🟠 Altos | 🟡 Medios | 🔵 Bajos | Pendientes de verificación |
|---|---:|---:|---:|---:|---:|---:|
| Arquitectura | 0 | 0 | 0 | 0 | 0 | 1 |
| Base de datos/migraciones | 0 | 0 | 0 | 0 | 0 | 1 |
| Seguridad | 3 | 2 | 1 | 0 | 0 | 1 |
| Lógica de negocio | 4 | 0 | 3 | 1 | 0 | 2 |
| Frontend/UX | 2 | 0 | 0 | 2 | 0 | 1 |
| Tests/CI | 1 | 0 | 0 | 1 | 0 | 3 |
| Configuración/observabilidad | 4 | 0 | 2 | 2 | 0 | 2 |
| Documentación | 1 | 0 | 0 | 0 | 1 | 0 |
| Rendimiento | 2 | 0 | 0 | 2 | 0 | 2 |
| **Total** | **17** | **2** | **6** | **8** | **1** | **13** |

## Cobertura y pendientes de verificación

| Área/superficie | Estado | Evidencia | Pendiente real |
|---|---|---|---|
| Inventario y arquitectura | Revisado | 1.925 archivos versionados; 1.623 bajo superficies de app/lib/components/db/modules/e2e/scripts/workflows | Validar comportamiento de servicios externos en staging |
| Esquema y migraciones | Revisado | 37 archivos de schema; 63 SQL/63 journal; cadena estructural sana | Ejecutar restore de backup productivo en entorno aislado; no se tocó una DB productiva |
| Auth/RBAC/scoping | Revisado con hallazgos, corregidos y con test negativo | Manifiestos, helpers, páginas, Server Actions y rutas API sensibles; CHO-001/002/003 con 30 tests negativos PGlite/mocked-DB (Pasada 7), CHO-006 con 5/5 PGlite | Repetir la misma matriz contra PostgreSQL desplegado, no sólo PGlite |
| Secretos/dependencias | Aprobado | `check:secrets`; dos variantes de `npm audit`: 0 vulnerabilidades | Escaneo de imagen GHCR/SBOM en pipeline |
| Tipos/lint/build | Aprobado | typecheck, lint y build de producción verdes | Smoke del contenedor desplegado por digest |
| Unitarias | Aprobado, brecha reducida | `test:fast` 255/260 archivos (2.355 passed, 8 skipped); `test:pglite` 36/38 archivos (285 passed) — 2 archivos preexistentes sin relación con esta auditoría fallan al cargar por un problema de resolución ESM `next-auth`↔Next 16 (ver Pasada 7 y lista accionable) | Corregir la resolución ESM de esos 2 archivos; seguir ampliando integración real para rutas API y branches anidados |
| Cobertura | Umbral aprobado, clean run reproducible (Pasada 7) | 64,63/52,6/69,07/68,08 % | No interpretar el porcentaje como cobertura global de toda la app (denominador auditado en `vitest.config.ts`) |
| E2E completa | Parcial / no cerrada | Corrida amplia interrumpida tras 51 passed y 5 failed; PPA 4/4, TAE 3/3, toggles 5/5 focales; la Pasada 7 evaluó reintentarla y decidió no hacerlo por el riesgo de corromper el arnés sin señal nueva (ver Pasada 7) | Ejecutar suite global desde un arnés que no deje procesos huérfanos y añadir gate CI estable |
| Accesibilidad automatizada | Aprobada | La spec axe completa pasó | Auditoría manual teclado, lector y targets táctiles |
| Concurrencia PostgreSQL | Aprobada, incluye casos de carrera específicos | 6/6 generales más `cancel vs receive` y dos `egreso_desecho` simultáneos (subpasada 5.20) | Staging con tráfico representativo |
| Rendimiento SQL | Aprobado localmente | Benchmark PostgreSQL: 11 consultas, máximo 52,5 ms, bajo SLO de 1.000 ms | Repetir en CI/staging con cardinalidad representativa |
| Rendimiento cliente | Revisado por build, con tripwire de CI | first-load de 2,03–2,44 MB en rutas señaladas; chunk ExcelJS separado (CHO-014); `npm run check:bundle-budget` como paso de CI (Pasada 7, techo 3 MB) | Medir gzip, parse/interaction y dispositivo de gama media |
| Sentry | Wiring de código corregido (CHO-010) | `instrumentation.ts`/`instrumentation-client.ts`/`sentry.edge.config.ts` según el contrato Next 16; archivo huérfano eliminado (Pasada 7) | Smoke con DSN de staging y excepción server/client |
| React Doctor | Aprobado con advertencias | v0.7.8: 88/100 y 24 advertencias clasificadas, sin regresiones nuevas | Decidir si se abordan optimizaciones restantes |

### Riesgos no confirmados — no incluidos en el conteo

- **Lotes históricos TAE y grants directos:** varias superficies de lote no expresan scope propio. Los roles por defecto de importación son globales, pero un grant directo a un usuario acotado podría abrir una brecha. Requiere decisión explícita sobre si el permiso implica alcance global.
- **Sentry productivo:** el wiring es incorrecto por código; no se verificó entrega en el proyecto real porque no se usó un DSN productivo.
- **Deploy real:** el workflow local quedó corregido y parseado, pero no se ejecutó contra el servidor. Un `.env` del host podría enmascarar parcialmente un error operativo.
- **Escala de listados:** existen consultas administrativas/catálogos sin paginación. El benchmark local pasó, pero no se dispuso de cardinalidad/latencia productiva.
- **Fallas E2E individuales:** no todos los fallos de la corrida amplia eran defectos de aplicación. Se confirmaron selectors/copys viejos, seeds incompatibles y problemas de aislamiento; las suites focales corregidas quedaron verdes, pero falta ejecutar el conjunto global para descubrir cualquier interacción restante.

## Recomendaciones Prioritarias

**Actualizado en la Pasada 10 (2026-07-18):** todos los ítems P0/P1/P2 originales quedan cerrados. Sólo persisten los que dependen de infraestructura fuera de este checkout (staging, DSN de Sentry productivo) — ver detalle abajo y en las secciones Pasada 7-10 de la bitácora.

### P0 — antes de cualquier despliegue

1. ~~Cerrar CHO-001 y CHO-002 con las pruebas negativas específicas de export/import, mutaciones de Combustibles y cotizaciones (por endpoint, dos faenas, rol acotado).~~ **Cerrado** en la Pasada 7 (PGlite) y ampliado en la Pasada 10 (PostgreSQL real): `trabajadores-scope.test.ts`/`trabajadores-scope-postgres.test.ts` (7/7 cada uno) y `combustibles-scope.test.ts`/`combustibles-scope-postgres.test.ts` (7/7 cada uno) — los 3 caminos de CHO-002 y export+import+update+toggle de CHO-001, corriendo en CI contra ambos motores.
2. ~~Confirmar CHO-003 con tests HTTP negativos de propietario/no propietario.~~ **Cerrado** en la Pasada 7 (PGlite) y ampliado en la Pasada 10 (PostgreSQL real): `quotation-download-routes-scope.test.ts`/`quotation-download-routes-scope-postgres.test.ts` (16/16 cada uno) cubren el caso IDOR exacto del hallazgo para ambas rutas (repuestos y servicios), corriendo en CI contra ambos motores.
3. Ejecutar CHO-007 contra staging: SHA/digest verificado, rollback real y deploy condicionado a CI verde. **Sigue abierto** — requiere un host de staging; el workflow local ya está corregido y gateado por `workflow_run: CI` (ver CHO-007).
4. ~~Añadir integración PostgreSQL de CHO-006 para 0/1/N permisos y verificarla en CI.~~ **Cerrado** en la subpasada 5.21: `admin-roles-service.test.ts` 5/5 contra PGlite (Postgres-compatible) con 0/1/N permisos.

### P1 — antes de declarar estabilidad operativa

5. ~~Añadir pruebas PostgreSQL específicas de `cancel vs receive` y dos `egreso_desecho` simultáneos.~~ **Cerrado** en la subpasada 5.20: `receiving-concurrency-postgres.test.ts` y `stock-concurrency-postgres.test.ts`, 2/2 cada uno.
6. ~~Validar fallos de adjuntos/filesystem y ausencia de huérfanos para CHO-008/011.~~ **Cerrado** en la subpasada 5.21: `feedback.test.ts` (rollback transaccional con fallo inyectado) y `soporte-notificaciones.test.ts` (limpieza de temporal ante fallo de `rename`).
7. ~~Ejecutar la E2E global desde un arnés limpio y convertir la suite en gate de CI.~~ **Cerrado** en las Pasadas 8-10: `npm run test:e2e` corrió completo cuatro veces (128/143, 138/143, 139/143, 139/143), la primera vez que esta auditoría completa la corrida global — con fallos puntuales residuales confirmados como contención de recursos de la máquina, no defectos. La Pasada 10 wireó `ci.yml` para correr la suite completa (`npx playwright test`, sin filtro) como paso único, con `retries: 1` en CI para absorber esa contención. Pendiente sólo la primera confirmación real en un runner de GitHub Actions (no ejecutable desde este checkout). El benchmark de rendimiento se mantiene bajo SLO.
8. ~~Añadir aserciones de integración para historial heterogéneo y secuencias reales de punta a punta.~~ **Cerrado** en la subpasada 5.21: `purchasing-service.test.ts` focal valida `fromStatus` real por ítem en un lote heterogéneo al cancelar.

### P2 — siguiente ciclo de calidad

9. Completar instrumentación Sentry y probar captura en staging. **Parcialmente cerrado**: wiring de código completo (CHO-010), archivo huérfano `sentry.client.config.ts` eliminado en la Pasada 7; falta sólo el DSN de staging.
10. ~~Separar ExcelJS del first-load y establecer presupuestos de bundle.~~ **Cerrado** en la Pasada 7: split de ExcelJS (CHO-014) más `npm run check:bundle-budget` como paso de CI tras el build (tripwire a 3 MB first-load JS).
11. Aplicar las reglas de densidad, DatePicker y targets móviles en las pantallas señaladas. **Parcialmente cerrado**: TAE/Reportes/Analítica (CHO-012); la variante `icon-mobile`/`icon-mobile-sm` (CHO-013) se aplicó en la Pasada 8 a todos los botones de icono reales identificados por grep en toda la app (Usuarios, stock mínimo, cotizaciones, PDTP, documentación, trazabilidad — excluyendo deliberadamente los decorativos y los ya ocultos en mobile). Falta sólo una revisión manual del resto de pantallas no cubiertas por el grep automatizado (auditoría de teclado/lector de pantalla, fuera de alcance de este checkout).
12. ~~Sincronizar PRODUCT/README con los manifiestos y contratos vigentes.~~ **Cerrado** (CHO-017): sin conteos congelados, TTL de RBAC correcto, tipos de movimiento de stock alineados y enlace a `docs/diseño/DESIGN.md` corregido.

### Criterio mínimo de re-auditoría

- 0 hallazgos críticos abiertos y aceptación explícita de cualquier alto residual. *(cumplido: los 2 críticos, CHO-001/002, están corregidos y con test negativo — ver punto siguiente.)*
- ~~Tests negativos de cross-faena para cada endpoint corregido, incluida evidencia contra PostgreSQL real.~~ **Cumplido**: 30 tests en la Pasada 7 (PGlite/mocked-DB) + 30 tests equivalentes en la Pasada 10 (PostgreSQL real, mismo patrón que `*concurrency-postgres.test.ts`), ambos conjuntos corriendo en CI.
- ~~Nuevas pruebas PostgreSQL de `cancel vs receive` y dos `egreso_desecho` simultáneos.~~ **Cumplido** (subpasada 5.20).
- CI obligatorio verde, benchmark midiendo realmente y smoke E2E estable sin depender de orden. **Parcial** — benchmark, smoke de 8 rutas y presupuesto de bundle verdes; falta el gate de la E2E de dominio completa (P1.7).
- Deploy de staging que demuestre el SHA/digest exacto y rollback a un digest anterior. **Pendiente** — requiere host de staging, fuera del checkout local.

## Notas y Observaciones

- La ejecución modificó código, pruebas E2E, fixtures y este informe. La Pasada 7 no creó commits; sí se observó que un commit externo al agente (`5dc0d8d`, autor del checkout, 2026-07-17 22:53:18) capturó en `main` la mayor parte de los cambios de código de esta pasada mientras estaba en curso — el diff local restante al cierre quedó acotado a este documento, el guard de `undefined` en `check-bundle-budget.ts`, el registro en `tests/pglite-files.ts` y los tres archivos de test nuevos. No se apuntó a una base productiva.
- **Hallazgo nuevo, fuera de los 17 originales:** dos archivos de test PGlite preexistentes (`lib/__tests__/full-flow-integration.test.ts`, `lib/__tests__/receiving-two-stage.test.ts`, sin relación con esta auditoría) fallan al cargar con `Cannot find module '.../node_modules/next/server' imported from next-auth/lib/env.js`. Es una incompatibilidad de resolución ESM entre `next-auth@5.0.0-beta.31` (importa `next/server` sin extensión) y Next 16.2.10, reproducible en aislamiento, que sólo se dispara en tests PGlite que cargan el `@/lib/auth/auth` real sin mockear. No degrada `test:fast` (que sí mockea auth) ni ningún hallazgo CHO-*; queda como accionable de infraestructura de tests.
- `PROMPT_AUDITORIA_INTEGRAL.md` ya estaba modificado por el usuario antes de iniciar y se preservó intacto.
- Las pruebas de base usaron exclusivamente `bodega_e2e` en el contenedor desechable ya previsto por el repositorio; no se apuntó a una base productiva.
- El benchmark local pasó con la base desechable; queda pendiente repetirlo en CI/staging con cardinalidad representativa.
- Se encontró un archivo versionado vacío con un nombre accidental parecido a una comprensión de Python. Es deuda menor de higiene y no se elevó a hallazgo para evitar ruido.
- Se revisaron positivamente headers de seguridad/CSP, rutas de archivos representativas con path seguro, healthcheck compatible con BusyBox, logger con redacción, formato Excel, Docker standalone y guards públicos/rate limit representativos.
- Este informe describe el checkout del 17 de julio de 2026; no afirma el estado de una imagen productiva distinta ni de secretos/servicios externos no conectados durante la auditoría.
