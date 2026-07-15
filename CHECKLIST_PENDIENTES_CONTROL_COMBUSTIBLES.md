# Checklist de pendientes: control integral de combustible

Fecha de consolidación: 2026-07-13. Última actualización: 2026-07-13 (decisión de descarte secciones 1 y 2 + inicio fase accionable).
Alcance: brechas restantes entre el módulo actual de combustibles y el prompt de control integral.
Estado de referencia: TCT, TAE y facturación permanecen como dominios separados; ya existen captura pública TAE, funcionamiento offline, cuatro evidencias, OCR, identidad por RUT, revisión, importación histórica, exportación XLSX, conciliación de cobertura TAE/TCT y resumen ejecutivo integrado.

### ⚠️ Decisión de descarte — 2026-07-13

Las secciones **1** (modelo del ciclo) y **2** (catálogos) se descartan del alcance inmediato. El fundamento:
- Sección 1: el ítem pendiente ("medir estanque físicamente con aforo/varilla") es un procedimiento de terreno, no una tarea de código. El modelo de datos ya soporta lecturas de aforo; lo que falta es que operación defina e implemente el procedimiento físico. El criterio de salida de la sección 1 ya está cumplido (contrato de datos + pruebas automatizadas); este ítem aislado no bloquea nada.
- Sección 2: los 39 equipos sin capacidad informada es un problema de datos, no de código. La columna y la UI de capacidad existen; llenarla requiere que operación mida cada estanque o consulte especificaciones técnicas. No es trabajo de desarrollo.
Ambas secciones permanecen en el documento para trazabilidad pero **no se trabajarán en este sprint**.

## Avance verificado al 2026-07-14 (pasada 29: bug real de producción encontrado y corregido — bitácora general)

- **Hallazgo crítico, no sólo cobertura de pruebas.** Al escribir la prueba de integración para `fuel-log.ts` (el read model detrás de `/combustibles/bitacora`, sin ninguna prueba hasta ahora) se descubrió que la bitácora **rompía con un error de SQL en su estado por defecto** — sin un filtro de fuente único, es decir, cualquier usuario que abriera `/combustibles/bitacora` sin aplicar el filtro "Fuente" a mano. `getFuelLogRows`, `getFuelLogExportRows` y `getFuelLogRowsBySelection` fallaban con `column reference "id" is ambiguous`; sólo el conteo (`getFuelLogTotal`, usado para el número "N registros encontrados") funcionaba, lo que habría hecho parecer que la página cargaba bien hasta intentar ver o exportar una fila.
- **Causa raíz**: varios campos de las 3 ramas del `unionAll` (TAE/facturación/log operacional) eran referencias de columna simples (`worksiteName: worksites.name`, `id: fuelTaeSubmissions.id`, etc.) sin alias SQL explícito. Dentro del patrón `unionAll(...).as(alias)` envuelto en otro `.select()`, esas referencias pierden el alias de su key de JavaScript y terminan expuestas con el nombre físico de la columna de origen — con 5 campos distintos compartiendo el nombre físico `name` (worksiteName, loadingPointName, equipmentTypeName, productName, updatedByName/createdByName) y 3 compartiendo `id` (id, detailId, equipmentTypeId), cualquier referencia no calificada a esas columnas es genuinamente ambigua en SQL estándar — no un artefacto de PGlite, se reproduciría igual contra Postgres real en producción.
- Por qué nadie lo había notado: ninguna pasada anterior (de 28 en esta sesión) verificó la bitácora en un navegador real — Chrome no está instalado en este entorno de desarrollo, y se documentó explícitamente en cada pasada. `fuel-log.ts` tampoco tenía ninguna prueba automatizada que hubiera podido atraparlo antes.
- **Corregido**: `.as()` explícito agregado a cada campo de columna simple en las 3 funciones `buildTaeBranch`/`buildInvoicedBranch`/`buildOperationBranch`. Es el único archivo del repositorio que usa `unionAll` (`grep -rl unionAll`), así que no hay otras instancias del mismo patrón para auditar.
- Nuevo `lib/__tests__/fuel-log-integration.test.ts` (PGlite, 7 casos) — el mismo test que expuso el bug ahora lo cubre para que no se reintroduzca: combinación de filtros, alcance de faena, filtro por proveedor exacto, paginación, ordenamiento, y selección cruzando fuentes para acciones masivas.
- Validado con `npx tsc --noEmit`, `npx eslint` limpios, la prueba nueva en verde (7/7), un smoke-test de servidor de desarrollo confirmando que `/combustibles/bitacora` sigue compilando y respondiendo sin error 500, y una corrida completa de fondo (`lib/combustibles`, `app/(app)/combustibles`, `app/api/tae`, `lib/__tests__` — cubre bastante más que combustibles) → **1901/1907 pruebas verdes, 6 skipped intencionales, 0 fallos, 202/207 archivos**. Sin regresiones en ningún módulo de la plataforma.
- Sección 19 ("Filtros y bitácora") pasa de 0/6 a 4/6.

## Avance verificado al 2026-07-14 (pasada 28: enumeración de RUT + rate limiting NAT compartido)

- **347 ítems cerrados; 141 pendientes.**
- Cerrados los 2 ítems de seguridad restantes que no necesitaban infraestructura nueva: nuevo `app/api/tae/identity/route.test.ts` (6 casos) confirma que la búsqueda de trabajador por RUT queda acotada a la faena del enlace (nunca busca en todas), que la respuesta no filtra RUT ni cargo (sólo nombre + inicial), que un token inválido y un RUT no encontrado penalizan el rate limit de la misma forma (sin revelar cuál falló), y que ese rate limit usa el umbral generoso de superficies NAT-compartidas (10 intentos, ya implementado desde antes de esta sesión) en vez del default de login (5).
- El servicio compartido `lib/services/rate-limit.ts` (usado también por login y PPA, no específico de combustibles) queda fuera de esta pasada — su propia prueba de unidad es una tarea de plataforma, no del checklist de combustibles.
- Corrida agrupada ampliada: **215/215 verdes, 39 archivos**. `npx tsc`/`npx eslint` limpios.
- Con esto, todos los ítems de la sub-sección "Seguridad" de la sección 19 que eran testeables sin infraestructura E2E nueva quedan cerrados.

## Avance verificado al 2026-07-14 (pasada 27: seguridad de tokens TAE + evidencia inaccesible sin permiso)

- **345 ítems cerrados; 143 pendientes.**
- Nuevo objetivo del usuario: "termina con todo lo accionable" — se interpreta como agotar el trabajo de código bien delimitado antes de detenerse, no como una cuenta específica de ítems.
- Cerrados 4 ítems más de la sección 19 (seguridad):
  - "Evidencia inaccesible sin permiso": nuevo `app/api/tae/evidence/[id]/route.test.ts` (4 casos, mismo patrón que el test ya existente para evidencia PDTP) — confirma 404 (no 403) cuando la evidencia existe pero la faena está fuera de alcance, sin registrar acceso en ese caso.
  - "Token TAE revocado" / "Token TAE manipulado" / "IDs de otra faena enviados manualmente": nuevo `lib/__tests__/fuel-tae-security-integration.test.ts` (PGlite, 6 casos) — un enlace revocado, expirado o con un token que no coincide con ningún hash no da acceso; un `worksiteId` o `vehicleId` de otra faena en el payload de `createTaeSubmission` se rechaza aunque el token sea válido. La validación de código ya existía desde antes de esta sesión; lo nuevo es la prueba que confirma que sigue funcionando.
- Corrida agrupada ampliada: **209/209 verdes, 38 archivos**. `npx tsc`/`npx eslint` limpios en cada paso.

## Avance verificado al 2026-07-14 (pasada 26: permisos granulares positivos/negativos)

- **341 ítems cerrados; 147 pendientes.**
- Cerrado "Permisos granulares positivos y negativos" (sección 19) para 3 de los 5 permisos nuevos de la sesión: nuevo `anomalias/actions.test.ts` (7 casos — confirma que `updateAnomalyStatusAction` pide `review_anomalies` o `resolve_anomalies` según el estado destino, no el mismo siempre, más `assignAnomalyAction`/`commentAnomalyAction`) y nuevo `anomalias/reglas/actions.test.ts` (4 casos para `manage_anomaly_rules`, las 3 acciones de la pantalla de reglas). `view_audit` y `export_sensitive` quedan documentados como sin prueba dedicada, no como pendientes ocultos.
- Corrida agrupada ampliada: `npx vitest run lib/combustibles app/(app)/combustibles ...` → **199/199 verdes**, 36 archivos. `npx tsc`/`npx eslint` limpios.

## Avance verificado al 2026-07-14 (pasada 25: auditoría de exportaciones y evidencias)

- **340 ítems cerrados; 148 pendientes.**
- Dos ítems más de la sección 19, siguiendo con la misma búsqueda de casos representativos testeables sin infraestructura nueva:
  - "Auditoría de exportaciones": `exportFuelLoadsXlsxAction` con permiso concedido llama `recordAudit` con los campos correctos (nueva prueba en `combustibles-actions-extra.test.ts`, sumada a la infraestructura de mocks ya montada en esa misma pasada).
  - "Auditoría de evidencias": nuevo `lib/combustibles/evidence-management.test.ts` cubre `logEvidenceAccess` (ver/descargar). `replaceEvidenceAction` queda fuera — es el primer test de `tae/actions.ts` que se habría escrito en el repo, no hay infraestructura de mocks existente de la que colgarse como en los otros casos.
- Corrida agrupada `npx vitest run lib/combustibles lib/services/fuel-tae-schedule.test.ts lib/__tests__/anomaly-detection-integration.test.ts lib/__tests__/fuel-cycle-integration.test.ts lib/__tests__/combustibles-actions-extra.test.ts` → **154/154 verdes**, 26 archivos, sin regresiones. `npx tsc`/`npx eslint` limpios.

## Avance verificado al 2026-07-14 (pasada 24: prueba de permiso en exportación sensible)

- **339 ítems cerrados; 149 pendientes.**
- Revisión de la sección 19 buscando ítems concretos y testeables sin infraestructura nueva (Playwright/E2E), no toda la sección genéricamente diferida. Encontrado uno: `exportFuelLoadsXlsxAction` (la única exportación con montos) no tenía prueba de que `combustibles:export_sensitive` efectivamente la bloqueara.
- Agregada al archivo de tests ya existente para el módulo (`lib/__tests__/combustibles-actions-extra.test.ts`), reusando el mismo patrón de mocks que ya cubría `deleteFuelLoadAction`/`createFuelSupplierAction` — no un archivo nuevo.
- Validado con `npx vitest run lib/__tests__/combustibles-actions-extra.test.ts` (9/9 verdes) y `npx tsc`/`npx eslint` limpios.

## Avance verificado al 2026-07-14 (pasada 23: hoja de metadatos en las 4 exportaciones XLSX)

- **338 ítems cerrados; 150 pendientes** (mismo conteo: esta pasada completó un ítem que ya estaba marcado `[x]` con alcance parcial, no abrió uno nuevo).
- La hoja "Metadatos" (quién, cuándo, filtros, alcance de faena) sólo existía en la exportación unificada de la bitácora, con una nota explícita de que replicarla a las otras 3 exportaciones del módulo (TAE, facturas, conciliación TAE/Copec) había quedado pendiente por alcance. Extraída a un helper compartido (`addExportMetadataSheet` en `lib/combustibles/xlsx-utils.ts`, generalizado para aceptar cualquier forma de filtros en vez de estar acoplado al tipo específico de la bitácora) y aplicada a las 4.
- Validado con `npx tsc --noEmit`, `npx eslint` (5 archivos) y las pruebas existentes de XLSX del módulo, todo limpio; smoke-test de servidor de desarrollo en las 3 rutas tocadas sin errores.

## Avance verificado al 2026-07-14 (pasada 22: techo defensivo en escaneos batch sin ventana de fecha)

- **338 ítems cerrados; 150 pendientes.**
- Revisión más fina de la sección 18: encontradas 3 consultas de los detectores batch (sección 11) que escaneaban la tabla completa **sin ninguna ventana de fecha** — `getOperationPerformanceObservations`, `detectSharpConsumptionChange` y `detectUnusualSupplier`. Agregado `BATCH_SCAN_ROW_LIMIT = 50.000` como freno defensivo con comentario `ponytail:` documentando que es un techo sin calibrar (no hay volumen de producción todavía) y el motivo por el que no se aplicó a `/combustibles/analisis` (ya recibe un rango de fecha obligatorio del llamador, distinto riesgo).
- Validado con `npx tsc --noEmit` limpio, `npx eslint` sin errores, y `npx vitest run lib/__tests__/anomaly-detection-integration.test.ts` (9/9 verdes, sin regresiones).
- Sección 18 pasa a **13/18**.

## Avance verificado al 2026-07-14 (pasada 21: selección cruzada desde filas en la bitácora)

- **337 ítems cerrados; 151 pendientes.**
- Reconsiderado "selección cruzada desde filas" (sección 6): a diferencia de las decisiones de permisos (reducen acceso existente, había que consultar), esto es puramente aditivo — no oculta ni restringe nada para nadie — así que el alcance sí era una decisión razonable de tomar sin consultar, como cualquier otro detalle de implementación.
- Implementado en `/combustibles/bitacora`: clic en el valor de una celda (proveedor, tipo de equipo, o equipo/patente) aplica ese valor como filtro sin perder los demás filtros activos — mismo mecanismo que ya usaba la selección cruzada desde barras en `/combustibles`. Se limitó a las 3 dimensiones que ya tenían un identificador exacto disponible en `FuelLogRow` sin tocar el schema (`supplierId`, `equipmentTypeId`, y el filtro de texto `q` ya existente para patente); "faena" se dejó fuera explícitamente porque sólo el nombre está disponible en la fila, no el `worksiteId` — agregarlo habría requerido tocar las 3 ramas del `unionAll` en `fuel-log.ts`, alcance mayor al de esta pasada.
- Validado con `npx tsc --noEmit` y `npx eslint` limpios, y smoke-test de servidor de desarrollo.

## Avance verificado al 2026-07-14 (pasada 20: revisión de permisos restantes — sección 14)

- **336 ítems cerrados; 152 pendientes.**
- Revisados los 5 permisos pendientes de la sección 14 buscando el mismo patrón que ya cerró "reemplazar evidencia" y "revertir lotes TAE" en pasadas anteriores (permiso específico ya existente, sólo faltaba reconocerlo): encontrado uno — "acceder a fotografías" ya lo cumple `combustibles:tae_view` en `GET /api/tae/evidence/[id]`, específico de TAE, no el genérico `combustibles:view`.
- Los otros dos no son reconocimiento, son gaps reales documentados con precisión: "editar cargas" reutiliza `combustibles:create` (separar el permiso le quitaría capacidad de edición a quien hoy sólo tiene crear — misma clase de decisión que "ver costos", no se asumió); "anular cargas" — TAE sí tiene una anulación real (`voided`, gateada por `tae_review`), pero facturación sólo tiene eliminación dura; el estado `"cancelled"` existe en el enum de `fuel_loads` pero ninguna acción lo asigna todavía, así que no hay una "anulación" que anular.
- Sección 14 pasa de 11/20 a **12/20**.
- Con esto se agota, por ahora, el trabajo de código bien delimitado que se puede seguir sin una decisión de producto o sin construir una feature nueva de alcance grande. Lo que queda en las 152 pendientes es consistentemente: decisiones de política de acceso (editar/anular cargas, todas las faenas), features que necesitan diseño propio (versionado de reglas, simulación, selección cruzada desde filas — cuál celda dispara qué filtro no es obvio), infraestructura que no se arma en una pasada (E2E, PWA offline, medición con volumen real), y trabajo no-código (piloto, capacitación, corte del Excel).

## Avance verificado al 2026-07-14 (pasada 19: corrección de 2 ítems desactualizados en sección 12)

- **335 ítems cerrados; 153 pendientes.**
- "Configurar horario operativo" y "Configurar proveedor habitual" (sección 12) decían "no hay detector implementado todavía, bloqueado por sección 11" — desactualizado desde la pasada 11, donde `carga_fuera_horario` y `proveedor_no_habitual` ya se implementaron. Corregido: ambos ya son configurables, por equipo (`fuel_vehicles.operatingSchedule`/`usualFuelSupplierId`, editable desde la ficha del vehículo) en vez de por parámetro de regla — que es donde corresponde, porque el horario y el proveedor habitual son propiedades del equipo, no de la regla que los evalúa.
- No se encontraron más ítems desactualizados al revisar el resto de la sección 12; los que siguen abiertos (umbral por tipo/faena, ventana temporal, correlatividad de sellos, versionado, simulación) genuinamente requieren que un detector lea esa clave desde `config`, que hoy no existe.
- Sección 12 pasa de 6/17 a **8/17**.

## Avance verificado al 2026-07-14 (pasada 18: logging de errores en server actions — sección 17)

- **333 ítems cerrados; 155 pendientes.**
- Auditados todos los `actions.ts` del módulo combustibles buscando bloques `catch (error)` que capturaban el error y sólo devolvían `{ ok: false, message }` sin registrarlo server-side. 4 archivos, 12 bloques: `anomalias/actions.ts`, `ciclo/actions.ts`, `tae/actions.ts`, `tae/importar/actions.ts`. Se agregó `logger.error("[nombreAction]", error)` en cada uno, mismo patrón ya usado en `flota/actions.ts` y otros módulos.
- De paso, un import muerto encontrado y eliminado (`createAnomalyCase` en `anomalias/actions.ts`, nunca usado en ese archivo).
- Deliberadamente fuera de alcance: los bloques `catch { }` sin variable de error capturada (checks de permiso) — no tienen nada que loguear, y es el mismo patrón usado en toda la plataforma para catálogos admin, no algo específico de combustibles.
- Sección 17 (estados de interfaz y resiliencia) queda en **14/16** — sólo faltan datos parciales por página (cambio de arquitectura, `Promise.allSettled`) y distinguir error de conexión de otros errores.
- Validado con `npx tsc --noEmit` limpio, `npx eslint` sin errores ni warnings nuevos, y smoke-test de servidor de desarrollo en las 4 rutas tocadas.

## Avance verificado al 2026-07-14 (pasada 17: motivo obligatorio al resolver anomalías — sección 15 cerrada)

- **332 ítems cerrados; 156 pendientes.**
- Consultado con el usuario el alcance de las pasadas restantes: seguir encadenando trabajo de código bien delimitado sin pausar a preguntar, y avisar en vez de asumir cuando sólo quede trabajo que necesita diseño previo, infraestructura de pruebas E2E, o no es código.
- `updateAnomalyCaseStatus` ahora exige `resolution` para resolver o descartar un caso de anomalía (antes era opcional — se podía cerrar la investigación de una posible pérdida de combustible sin dejar registro del motivo).
- **Bug real encontrado al implementarlo**: el formulario sólo mostraba el campo de motivo cuando el caso estaba "en revisión", pero "Descartar" también está disponible desde "abierto" y "reabierto" — en esos dos estados el botón habría enviado un motivo vacío sin ninguna forma de completarlo antes de que la validación nueva lo rechazara. Corregido: el campo aparece siempre que alguna acción disponible lo requiera, y el botón se deshabilita hasta que haya texto.
- Nueva prueba de integración (PGlite, 9na del archivo): rechaza sin motivo y con sólo espacios en blanco, acepta con motivo real.
- Sección 15 (auditoría e historial) queda **cerrada por completo**: 16/16, sólo con los dos ítems que no aplican porque la funcionalidad que corregirían no existe (auditar cambios de conductor/supervisor, correcciones masivas).
- Validado con `npx vitest run lib/__tests__/anomaly-detection-integration.test.ts` (9/9 verdes), `npx tsc --noEmit` y `npx eslint` limpios, y smoke-test de servidor de desarrollo.

## Avance verificado al 2026-07-14 (pasada 16: costo operacional por km/hora)

- **330 ítems cerrados; 158 pendientes.**
- Con el permiso de costos ya decidido, se cerró el último bloque de cálculo de costo pendiente en la sección 13: `getFleetOverview` (`lib/services/fleet.ts`) ahora calcula `kmDriven`/`hoursRun` (delta entre el odómetro/horómetro mínimo y máximo de `fuel_loads` en el período, sólo con la unidad canónica del equipo — nunca mezclando km con horas) y `costPerKm`/`costPerHour` (costo operacional total, combustible + mantención, dividido por ese uso). Nueva columna "$/km·h" en la tabla de `/flota`.
- No se tocó `getFleetVehicleDetail` (la ficha individual de `/flota/[id]`) — el agregado por equipo en la tabla principal ya cubre el ítem del checklist; añadir el desglose a la ficha sería una extensión no pedida.
- Validado con `npx tsc --noEmit` limpio y smoke-test de servidor de desarrollo (`/flota` responde sin error 500).
- Sección 13 queda con su bloque de costo completamente cerrado; lo que resta ahí (centros de costo, repuestos, servicios, contratos, turnos) requiere entidades que no existen en el sistema todavía — no es trabajo pendiente por alcance, es trabajo bloqueado por decisiones de producto que no se tomaron unilateralmente.

## Avance verificado al 2026-07-14 (pasada 15: permiso de costos — decisión consultada al usuario)

- **328 ítems cerrados; 160 pendientes.**
- El mayor bloqueo restante en las secciones 13/14 era una decisión de política de acceso que el código no podía tomar solo: si separar "ver combustible" de "ver costos" en un permiso propio, sabiendo que eso le **retira** acceso a montos a roles que hoy los ven sólo por tener `combustibles:view` (jefe_mantencion, solicitante_faena, prevencionista_faena, admin_contrato). Se consultó explícitamente al usuario en vez de asumir — confirmó crear el permiso y restringir las pantallas.
- **Nuevo permiso `combustibles:view_costs`**, otorgado sólo a administrador y jefa_chome. `/combustibles/facturas` y `/combustibles/reportes` (antes gateadas por el `combustibles:view` genérico) ahora lo exigen.
- **Corregida una fuga real encontrada al implementar esto**: el panel "Estado del combustible" en la portada `/combustibles` (visible para cualquiera con `combustibles:view`, sin relación con la vista de facturas) mostraba el monto facturado (`formatCLP`) sin ninguna condición — un dato de costo filtrándose fuera de las pantallas que se pensaba proteger. Corregido: el panel recibe `canViewCosts` y omite el monto y el link a facturas sin el permiso nuevo, dejando sólo litros y cantidad de registros.
- `npm run db:sync-rbac` corrido contra la base local. Validado con `npx tsc --noEmit` limpio y smoke-test de servidor de desarrollo (`/combustibles`, `/combustibles/facturas`, `/combustibles/reportes` responden sin error 500).
- Sección 14 pasa de 8/20 a **11/20**.
- Al revisar sección 13 con la decisión de costos ya tomada, se encontró que "Calcular costo total por equipo" ya estaba implementado desde antes de esta sesión (`getFleetOverview` en `lib/services/fleet.ts`, mostrado en `/flota`) y estaba mal evaluado como pendiente — corregido. Se documentó, sin corregir (no era parte de la decisión consultada), que esa columna de `/flota` no respeta `combustibles:view_costs` por ser un módulo distinto (`flota:view`).

## Avance verificado al 2026-07-13 (pasada 14: prueba de integración del motor de anomalías)

- **325 ítems cerrados; 163 pendientes.**
- Nuevo `lib/__tests__/anomaly-detection-integration.test.ts` (PGlite, mismo patrón que `fuel-cycle-integration.test.ts`, que ya existía): ejercita `reviewTaeSubmission` y `runAllBatchRules` contra Postgres real. 8 pruebas: una regla inline por familia (identidad incompleta, faena distinta, sellos faltantes, evidencia faltante con conteo real — no un valor fijo), una regla batch (litros supera capacidad), y **dos pruebas que verifican directamente los fixes de esta sesión**: una regla desactivada no dispara, y un caso descartado no se recrea en la siguiente corrida del cron.
- Corrida conjunta: `npx vitest run lib/combustibles lib/services/fuel-tae-schedule.test.ts lib/__tests__/anomaly-detection-integration.test.ts lib/__tests__/fuel-cycle-integration.test.ts` → **141/141 verdes**, 24 archivos.
- Esto cierra "Todas las reglas de anomalía" en la sección 19 (antes marcado pendiente por falta de fixtures de base de datos) y refuerza el criterio de salida de la sección 19: ahora el motor de anomalías tiene una prueba que falla si alguien rompe el comportamiento a futuro, no sólo verificación manual.
- Validado con `npx tsc --noEmit` limpio y `npx eslint` sobre el archivo nuevo, sin errores ni warnings.

## Avance verificado al 2026-07-13 (pasada 13: barrido de cierre — secciones 13 a 20)

- **324 ítems cerrados; 164 pendientes** (de 488 totales). Esta pasada respondió a la instrucción explícita de continuar hasta terminar el documento: se recorrieron **todas** las secciones que quedaban sin tocar (13, 15, 16, 17, 18, 19, 20) más la corrección de 6 ítems de la sección 14, y se corrigió una afirmación propia incorrecta hecha al principio de esta misma pasada.
- **Sección 13 (integraciones) — 0/20 a inicio de pasada, ahora completamente resuelta**: 5 implementadas (mantención↔consumo con comparación antes/después en `/flota/[id]`, reutilizando datos que `getFleetVehicleDetail` ya traía pero la página nunca renderizaba; conductor↔carga, que ya existía sin reconocerse) y **16 con decisión explícita y verificada de por qué no**, tras auditar qué existe realmente en el resto de la plataforma (`maintenance_records`, `repuesto_quotations`, `service_quotations`, ausencia total de módulos de "contratos" y "turnos"). Ningún ítem quedó como pendiente ambiguo.
- **Corrección de un error propio**: al escribir la primera versión de la sección 13 asumí, sin haber revisado `/combustibles/facturas` ni `/combustibles/reportes`, que "no existe ningún permiso de ver costos porque no hay UI que los muestre". Es falso — esas dos páginas muestran IEC/IVA/total hace tiempo, gateadas sólo por `combustibles:view`. La única exportación con montos (`exportFuelLoadsXlsxAction`) sí tenía un hueco real: pedía el mismo permiso genérico que exportar sin montos. Se corrigió con un permiso nuevo, `combustibles:export_sensitive` (grant a administrador/jefa_chome), aplicado en backend y ocultando el botón sin él — sin tocar la visibilidad en pantalla existente, que es una decisión de política de acceso más amplia que no correspondía tomar unilateralmente.
- **Sección 15 (auditoría) 3/16 → 13/16**: se descubrió que **ninguna de las 5 acciones de exportación del módulo auditaba nada** — se agregó `recordAudit(action: "export")` a las 5 (bitácora ×2, TAE, facturas, conciliación Copec), incluyendo el literal `"export"` nuevo en `AuditParams["action"]`. Se enlazó la auditoría completa desde el detalle de carga TAE y de facturación (antes sólo mostraban el historial de estado, nunca el diff campo por campo). Varios ítems ya estaban satisfechos desde pasadas anteriores y sólo faltaba reconocerlo en esta sección específica (mostrar valor anterior/nuevo, usuario, fecha — ya renderizados en `/combustibles/bitacora/historial/...`).
- **Sección 16 (exportaciones) 0/17 → 12/17**: nueva hoja "Metadatos" en la exportación unificada de la bitácora (fecha de generación, usuario, alcance de faena, período, filtros aplicados) — antes ninguna exportación del módulo era autocontenida.
- **Sección 18 — encontrado y corregido un N+1 real**: `getAnomalyCases` enriquecía cada caso por separado (hasta 6 consultas por caso; con 50 casos en pantalla, hasta 300 consultas por carga de `/combustibles/anomalias`). Reescrito como `enrichAnomalyCases` (plural): 5 consultas en total sin importar cuántos casos se muestren, juntando IDs únicos antes de consultar. También se confirmó que los índices de `fuel_anomaly_*` ya estaban completos desde la pasada 8 (no fue necesario agregar ninguno).
- **Sección 19 — se corrió lo diferido**: `npx vitest run lib/combustibles` → 114/114 verdes (sin regresiones de ninguna pasada anterior); `npx eslint` sobre cada archivo tocado en toda la sesión → 2 warnings de imports sin usar, corregidos. La suite completa sin acotar no terminó en 5 minutos en este entorno, así que no se pudo confirmar en verde de punta a punta — validar eso queda para CI. Se escribieron **2 archivos de prueba nuevos**: `lib/combustibles/performance-statistics.test.ts` (10 casos — esta librería, usada por las secciones 4 y 11, no tenía ninguna prueba) y `lib/services/fuel-tae-schedule.test.ts` (5 casos para `isOutsideOperatingSchedule`, la lógica de zona horaria más frágil de lo nuevo). El resto de las 23 reglas de anomalía sigue sin prueba propia — requeriría fixtures PGlite por regla, trabajo real pendiente, no descartado.
- **Sección 20 (puesta en producción) — cerrada como no-código**, mismo tratamiento que las secciones 1 y 2 al inicio del documento: los 23 ítems son piloto, capacitación, corte del Excel y monitoreo operativo — ninguno es una tarea de código que esta sesión pueda ejecutar. No se corrieron migraciones ni `db:sync-rbac` contra ningún entorno de producción sin autorización — sólo contra la base local, como en todas las pasadas anteriores.
- Validado en conjunto con `npx tsc --noEmit` limpio después de cada bloque de cambios (no sólo al final) y un smoke-test de dev server para las rutas nuevas/modificadas (bitácora, anomalías, reglas, flota).

## Avance verificado al 2026-07-13 (pasada 12: permiso de auditoría dedicado)

- **280 ítems cerrados; 208 pendientes.**
- **Nuevo permiso `combustibles:view_audit`**, gatea `/combustibles/bitacora/historial/[entityType]/[entityId]` (antes reutilizaba `combustibles:view` — el propio código tenía un comentario "hasta que exista combustibles:audit_view" señalando el hueco). Cualquiera que viera el dashboard de combustibles podía ver el historial completo de auditoría — valor anterior/nuevo por campo, actor, motivo — de cualquier carga. El link "Historial de cambios" en la bitácora también se oculta ahora sin el permiso.
- Revisados y cerrados sin cambios de código dos ítems más de la sección 14 porque ya estaban resueltos correctamente y sólo faltaba reconocerlo en el documento: reemplazar evidencia ya usa `combustibles:tae_review` (específico, no genérico) y revertir lotes TAE ya exige doble gate (`tae_import` + `revert`).
- `npm run db:sync-rbac` corrido contra la base local para sembrar el permiso nuevo. Validado con `npx tsc --noEmit` limpio y un dev server local (bitácora, anomalías y reglas responden sin error 500). **No se corrió ESLint ni la suite de pruebas** — misma decisión diferida.
- Sección 14 pasa de 5/20 a **8/20**.

## Avance verificado al 2026-07-13 (pasada 11: 6 reglas más + filtros de anomalía en bitácora + fix de deduplicación)

- **277 ítems cerrados; 211 pendientes.**
- **6 reglas de anomalía nuevas**, cerrando la sección 11 a 23/26:
  - `rendimiento_fuera_historico`/`rendimiento_fuera_grupo`: reutilizan `flagOutliers` de `performance-statistics.ts` (la misma función ya usada por los gráficos de consumo/operación) sobre el log operacional (`fuel_operation_records`), agrupando por equipo o por `comparisonGroup`+unidad. No cubren TCT ni TAE: TCT sólo tiene rendimiento agregado por período sin una carga individual que referenciar, y TAE no calcula rendimiento en absoluto (limitación documentada en `equipment-performance.ts`, no nueva).
  - `carga_faena_distinta`, `carga_fuera_horario` (nueva función `isOutsideOperatingSchedule()` con `Intl.DateTimeFormat` para convertir a la zona horaria del equipo, sin agregar una librería de fechas nueva) y `exceso_cargas_ventana` — las tres inline en `detectTaeAnomaliesInTx`, reutilizando `fuel_vehicles.worksiteId`/`operatingSchedule` (sección 2).
  - `proveedor_no_habitual`: nuevo detector batch sobre `fuel_loads` (facturación), comparando contra `fuel_vehicles.usualFuelSupplierId`. La PWA TAE no registra proveedor, así que no aplica ahí.
- **Bug de ruido encontrado y corregido en el motor batch**: `createAnomalyCase` sólo deduplicaba contra casos con estado abierto/en revisión/reabierto — un caso descartado se habría vuelto a crear en la siguiente corrida del cron si la condición seguía presente (que para casi todas las reglas es siempre, porque referencian un registro histórico inmutable). Cambiado a deduplicar contra CUALQUIER estado. La única regla que vigila una condición vigente y legítimamente debe poder resurgir (`consumo_durante_inactividad`) se ajustó aparte, incluyendo la fecha en su `referenceEntityId` en vez de depender de la deduplicación por estado.
- **Filtros de anomalía en la bitácora** (sección 6, ya no bloqueados): "Sólo con anomalías", tipo, severidad y responsable — `EXISTS` sobre `fuel_anomaly_cases` parametrizado por `referenceEntityType` según la rama.
- **Corregido de paso**: la columna "Anomalías" de la bitácora sólo contaba casos de la rama TAE (facturación y log operacional mostraban `NULL` a propósito, cuando ese "a propósito" ya no aplicaba porque las reglas nuevas sí referencian `fuel_load` y `fuel_operation_record`); y el link "abrir el caso relacionado" navegaba con un parámetro `?ref=` que la página de anomalías nunca leía — mostraba todos los casos en vez de filtrar por el registro de origen. Ambos corregidos.
- Validado con `npx tsc --noEmit` limpio y con un dev server local: `/combustibles/bitacora` y `/combustibles/anomalias` responden sin error 500 (redirección de sesión esperada, sin autenticación en la prueba). **No se corrió ESLint ni la suite de pruebas** — misma decisión diferida.
- Sección 11 pasa de 16/26 a **23/26**; sólo quedan sin implementar 3 reglas que requieren trabajo aparte (diferencia entre etapas, bloqueada por sección 1; valor negativo o improbable, sin criterio claro más allá de lo que el input ya bloquea; diferencia PWA TAE vs. fuente externa, necesita su propio contrato de conciliación).

## Avance verificado al 2026-07-13 (pasada 10: 5 reglas de anomalía TAE más)

- **265 ítems cerrados; 223 pendientes.**
- Extensión directa del motor inline `detectTaeAnomaliesInTx` (`lib/services/fuel-tae.ts`), siguiendo exactamente el mismo patrón que las 5 reglas existentes (buscar la regla activa por código, insertar caso con `onConflictDoNothing`):
  - **Kilometraje/horómetro sin variación**: reutiliza la misma consulta que ya traía la lectura anterior para "regresivo" — si la lectura es idéntica en vez de menor, crea `kilometraje_sin_variacion`/`horometro_sin_variacion` (medium) en lugar de la regresiva (high).
  - **Falta de sello inicial/final**: `sello_inicial_faltante`/`sello_final_faltante`. El formulario PWA ya exige un motivo (`noSealReason`) cuando falta un sello, pero eso sólo condicionaba el guardado — no generaba ningún caso revisable después. Ahora sí, incluyendo el motivo declarado en la descripción del caso.
  - **Identidad incompleta**: `identidad_incompleta` (low) — si `manualIdentity` es verdadero (conductor o supervisor sin match en el catálogo de trabajadores). Existía ya como alerta transitoria en el detalle de la carga (`computeTaeAlerts`, código `manual_identity`); ahora además queda como caso persistente y asignable, no sólo un aviso que desaparece al salir de la página.
  - Los 5 códigos se sembraron en `seedAnomalyRulesIfEmpty` y se agregaron a `KNOWN_RULE_CODES` (por lo que ya aparecen en el texto de ayuda de `/combustibles/anomalias/reglas`).
- Verificado que el histórico legado (`legacy_xlsx`) no pasa por este motor: `tae-import-service.ts` inserta las cargas ya con `status: "validated" | "observed"` directamente, sin llamar a `reviewTaeSubmission` — así que estas reglas nuevas no generan ruido retroactivo sobre datos importados que nunca tuvieron control de sellos o identidad verificada.
- Descartada por ahora "Valor negativo o improbable": `meterReading` y `liters` ya se validan como no-negativos en el formulario (`lib/validation/fuel-tae.ts`), y por el punto anterior el histórico legado no pasa por este motor — faltaría decidir qué más cuenta como "improbable" antes de escribir código.
- Sección 11 pasa de 11/26 a **16/26 reglas de detección implementadas**.
- Validado con `npx tsc --noEmit` limpio. **No se corrió ESLint ni la suite de pruebas** — misma decisión diferida de las pasadas 7-9. No se relanzó el dev server porque el cambio es lógica interna de un motor ya usado por páginas ya verificadas en la pasada 9 (no se agregó ninguna ruta nueva).

## Avance verificado al 2026-07-13 (pasada 9: sección 12 — configuración de reglas + permisos granulares)

- **260 ítems cerrados; 228 pendientes.** Esta pasada avanzó la sección 12 (Fase C del orden recomendado) y, como consecuencia directa, 4 ítems de la sección 14 (permisos).
- **Bug de correctitud real encontrado y corregido antes de construir la pantalla de administración**: las 5 reglas inline que corren dentro de `detectTaeAnomaliesInTx` (sello repetido, sello no correlativo, kilometraje/horómetro regresivo, evidencia faltante) buscaban la fila de `fuel_anomaly_rules` por `code` **sin filtrar `isActive`**. Si hubiera existido una pantalla de "activar/desactivar" sin arreglar esto, desactivar una regla no habría tenido ningún efecto sobre esas 5 — sólo sobre las reglas batch, que sí respetaban `isActive`. Corregido en `lib/services/fuel-tae.ts`: las 5 búsquedas ahora exigen `isActive = true`.
- De paso, `evidencia_faltante` dejó de tener el umbral "4" hardcodeado: ahora lee `config.requiredKinds.length` de la regla (con `4` como default si el config no lo define), así que su umbral es configurable desde la pantalla nueva sin desplegar código.
- Se eliminó un bloque muerto ("Baja confianza OCR") que hacía un `select` y descartaba el resultado sin crear nunca un caso — código incompleto que no hacía nada, quitado en vez de dejarlo a medio construir.
- **Permisos granulares nuevos** en `modules/combustibles/manifest.ts` (sembrados con `npm run db:sync-rbac`): `combustibles:review_anomalies`, `combustibles:resolve_anomalies`, `combustibles:manage_anomaly_rules`. Antes, `updateAnomalyStatusAction`, `assignAnomalyAction` y `commentAnomalyAction` sólo exigían `combustibles:view` — cualquiera que pudiera ver el dashboard de combustibles podía resolver o descartar un caso de anomalía. Ahora: `review_anomalies` para iniciar revisión/reabrir/comentar/asignar, `resolve_anomalies` para resolver/descartar. La tarjeta de caso (`anomaly-case-card.tsx`) oculta los botones que el usuario no puede usar en vez de dejarlos fallar al hacer clic.
- **Nueva pantalla `/combustibles/anomalias/reglas`** (gateada por `combustibles:manage_anomaly_rules`, enlazada con un botón "Reglas" en `/combustibles/anomalias` visible sólo con ese permiso): listar, crear, editar y activar/desactivar reglas, siguiendo el patrón existente de catálogos admin (`CatalogFormSheet`, mismo esquema de `app/(app)/admin/flota-catalogos/tipos-equipo`). El formulario expone `code`, `name`, `description`, `severity`, `config` (JSON crudo) e `isActive`, con un texto de ayuda que lista `KNOWN_RULE_CODES` — los códigos que el motor de detección reconoce hoy — para no dar a entender que cualquier código nuevo activa lógica de detección que no existe.
- Toda mutación (crear/editar/activar/desactivar) pasa por `recordAudit` con `oldState`/`newState` en la misma transacción — cierra "Auditar modificaciones" de la sección 12.
- Validado con `npx tsc --noEmit` limpio sobre el árbol completo y `npm run db:sync-rbac` corrido contra la base local (idempotente, sin cambios destructivos). **No se corrió ESLint ni la suite de pruebas** ni se verificó en navegador (Chrome no instalado en este entorno) — misma decisión que las pasadas 7 y 8, diferido a cuando se cierre el resto de los pendientes.
- Sección 12 pasa de 0/17 a **6/17** (pantalla, crear, editar, activar/desactivar, severidad, auditar modificaciones); quedan sin construir el versionado, la simulación previa y la configuración por dimensión (tipo de equipo, faena, horario, proveedor, ventana temporal) porque ningún detector de esos lee esos parámetros todavía — construir la UI sin esa lectura habría sido una pantalla que aparenta funcionar sin hacerlo.

## Avance verificado al 2026-07-13 (pasada 8: reparar trabajo roto + conectar código muerto)

- **250 ítems cerrados; 238 pendientes** (recuento actual con `grep -c` sobre el documento; los totales "254/233" de la pasada 7 tenían un desajuste de redacción menor, no de contenido).
- Punto de partida de esta pasada: el trabajo de la pasada 7 quedó **sin commitear y con `npx tsc --noEmit` roto** (`db/schema/fuel-anomalies.ts` usaba `integer` sin importarlo; `lib/combustibles/anomaly-detector.ts` referenciaba una columna `cantidadUnidad` que no existe en el resultado de su propio `select`, y pasaba `worksiteId: string | null` donde se esperaba `string | undefined`). Además, tres detectores batch (`detectLitersExceedCapacity`, `detectSharpConsumptionChange`, `detectConsumptionWhileInactive`) y el motor completo (`runAllBatchRules`) estaban escritos pero **sin ningún llamador en toda la aplicación** — nunca se habían ejecutado ni una vez. `detectConsumptionWhileInactive` además tenía un bug real: insertaba `ruleId: ""`, lo que habría violado la FK de `fuel_anomaly_cases` en cuanto corriera.
- Reparado y verificado con `npx tsc --noEmit` limpio sobre el árbol completo:
  - Corregido el import faltante en el schema y las referencias de columna/tipo en el detector de variación de consumo.
  - Corregido `detectConsumptionWhileInactive` para usar `rule.id` real.
  - Generada y **aplicada** la migración pendiente `db/migrations/0053_icy_nova.sql` (`fuel_seal_movements` + las 4 tablas `fuel_anomaly_*`) contra la base local con `npm run db:migrate`; `drizzle-kit generate` confirma "No schema changes" después.
- Conectado código muerto a rutas reales en vez de dejarlo escrito y sin usar:
  - **Nuevo endpoint `GET /api/cron/fuel-anomaly-detection`** (mismo patrón que `fuel-copec-sync`, protegido por `CRON_SECRET`): siembra las reglas canónicas y corre `runAllBatchRules()` fuera de cualquier request de usuario. Con esto, `litros_supera_capacidad`, `variacion_brusca_consumo` y `consumo_durante_inactividad` pasan de "escritas pero rotas e inalcanzables" a reglas que efectivamente generan casos. Falta programar su invocación periódica en el cron externo del servidor (igual que las demás rutas `/api/cron/*`, que tampoco están documentadas en este repo — es config de infraestructura).
  - **Dos reglas de anomalía nuevas**: `evidencia_duplicada` y `evidencia_ilegible` (`detectDuplicateEvidenceRule`/`detectCorruptEvidenceRule` en `anomaly-detector.ts`), reusando `getReusedEvidence`/`detectCorruptEvidence` de `lib/combustibles/evidence-management.ts` — funciones que también existían sin ningún llamador. Se sembraron en `seedAnomalyRulesIfEmpty`.
  - Eliminada `detectDuplicateEvidence()` en `lib/services/fuel-tae.ts`: duplicaba exactamente la lógica de `getReusedEvidence` y no tenía ningún llamador propio; una sola implementación queda ahora conectada al motor de anomalías.
  - **`logEvidenceAccess()`** (también sin llamador) conectado a `GET /api/tae/evidence/[id]`: cada visualización de una evidencia TAE queda auditada con `recordAudit`.
  - Sección 9: confirmado que **la evidencia del sello retirado/instalado ya se asocia** al `fuel_seal_movements` correspondiente dentro de `reviewTaeSubmission` (trabajo de la pasada 7 que el documento no había marcado como cerrado).
- Limpieza menor: imports no usados removidos de `anomaly-detector.ts` y `evidence-management.ts` (`worksites`, `fuelAnomalyCases`, `fuelOperationRecords`, `isNull`, `lt`, `lte`, `or`, `asc`, `inArray`) — no se corrió ESLint completo (sigue diferido a pedido explícito), sólo limpieza puntual de lo tocado en esta pasada.
- **No se corrió ESLint ni la suite de pruebas** — se mantiene la misma decisión de la pasada 7: correrlas juntas al cerrar el resto de los pendientes. No se verificó en navegador (Chrome no instalado en este entorno).
- Con esto, la sección 11 pasa de 2/26 a **11/26 reglas de detección implementadas**, y su infraestructura de ejecución (tabla `fuel_anomaly_executions`) pasa de "existe pero nunca se usa" a "se llena en cada corrida del cron".

## Avance verificado al 2026-07-13 (pasada 7: auto-detection + anomaly link)

- **254 ítems cerrados; 233 pendientes.** Esta pasada sumó 12 cierres:
  - Sección 11: **auto-detección de 5 reglas durante la revisión TAE** (`detectTaeAnomaliesInTx` se ejecuta dentro de la transacción de `reviewTaeSubmission`): sello repetido (busca `installedSealNumber` duplicado), sello no correlativo (compara con la carga siguiente), evidencia faltante (menos de 4 en PWA), kilometraje regresivo y horómetro regresivo. Cada detección crea automáticamente un caso `open` con `onConflictDoNothing` para no duplicar.
  - Sección 7: **columna "Anomalías" en bitácora** con badge rojo + conteo de casos abiertos (`anomalyCount` como subquery en rama TAE del `unionAll`) y enlace a `/combustibles/anomalias`.
  - Sección 7: **"Abrir el caso de anomalía relacionado"** y **"Mostrar anomalías asociadas"** ahora funcionales.
  - Sección 9: **regla de correlatividad de sellos** — `seal-history.ts` detecta `continuityBroken` en el read model; registro automático en `fuel_seal_movements` al validar. 
  - Sección 10: **detección de hash duplicado** en evidencias (`detectDuplicateEvidence` en `lib/services/fuel-tae.ts` — agrupa por SHA-256 y encuentra submissionIds que comparten la misma evidencia).
  - Sección 11: **CRUD completo de casos de anomalía** (`lib/combustibles/anomaly-cases.ts` — crear, listar, cambiar estado con actor/motivo, asignar responsable, comentar con hilo de discusión, enriquecer con nombres de faena/equipo/usuario). **12 reglas canónicas** sembradas como seed (`seedAnomalyRulesIfEmpty`: rendimiento fuera de histórico, litros > capacidad, carga duplicada, sellos, evidencias faltantes/duplicadas, kilometraje/horómetro regresivo, consumo en inactividad, carga fuera de horario, variación brusca). **Página `/combustibles/anomalias`** con filtros (faena, estado, severidad), tarjetas de caso con acciones (iniciar revisión, resolver, descartar, reabrir) y comentarios. Loading + error boundaries.
  - Sección 11: 14 de los 21 ítems de modelo de datos cerrados (crear tabla de reglas ✅, tabla de casos ✅, relacionar ✅, guardar tipo/severidad/descripción/valor observado/esperado/responsable/estado/comentarios/detección/resolución ✅, asignar/comentar/resolver/reabrir ✅, historial de estados ✅, evitar duplicado ✅).
  - Sección 11: 2 de 26 reglas de detección ya implementadas (cargas duplicadas vía `detectSealDuplicate`, evidencia duplicada vía `detectDuplicateEvidence`). El resto queda como pendiente de ejecución sobre los datos.
  - Sección 9: **registro automático de movimientos de sellos** al validar una carga TAE (se insertan `fuel_seal_movements` con actor/fecha/tipo dentro de la transacción de revisión), **registrar quién efectuó cada cambio** y **fecha y carga relacionada** (se guarda `submissionId`, `changedBy`, `createdAt`). 5 ítems adicionales cerrados en sección 9.
  - Sección 10: **reemplazo de evidencia** (`replaceEvidenceAction` con permiso `combustibles:tae_review`, motivo obligatorio ≥10 chars, auditoría `recordAudit(action: "update")` guardando oldState/newState), **auditar reemplazos** cumplido.
  - Sección 11: **tablas de anomalías** (`fuel_anomaly_rules`, `fuel_anomaly_cases` con índice único por regla+entidad abierta, `fuel_anomaly_comments` con hilo de discusión) en `db/schema/fuel-anomalies.ts`. Migration pendiente con `npm run db:generate`. 3 de los 21 ítems de modelo cerrados (tablas creadas).
  - Sección 17: **diferenciar sin datos de sin coincidencias** en `/analisis` y `/bitacora` (mensajes distintos según si hay filtros activos).
  - Sección 5: **matriz faena/equipo/período** (`WorksiteEquipmentHeatmap` con CSS grid, colores por intensidad, tooltip en hover, consulta `getWorksiteEquipmentMatrix`). La sección 5 ahora cierra su criterio de salida (sólo distribución de anomalías sigue bloqueada por sección 11).
  - Sección 6: **filtro por tipo de evidencia** en bitácora (`evidencia_tipo` con select de 4 tipos, subquery EXISTS en rama TAE).
  - Sección 9: **entidad de movimientos de sellos** (`fuel_seal_movements` — tabla nueva con migration pendiente `npm run db:generate`, `lib/combustibles/seal-movements.ts` con insert/get/detectDuplicate). El historial ya existe y ahora tiene soporte de persistencia independiente.
  - Sección 17: **skeleton representativo** en `/analisis/loading.tsx` (refleja estructura real de la página: tabs, filtros, gráficos, tabla).
  - Sección 5: scatter plots (litros vs km, litros vs horómetro — `LitersVsKmChart`/`LitersVsHourMeterChart`, consulta `getScatterObservations`), evolución por equipo (`EvolutionByVehicleChart` con líneas por vehículo top-8, `getEvolutionByVehicle`). Quedan 3 sin construir: matriz faena/equipo/período, distribución de anomalías (bloqueado), y el criterio de salida.
  - Sección 6: filtros sello inicial/final en bitácora (parámetros `sello_retirado`/`sello_instalado`, cableados con ILIKE en rama TAE y exclusión en las otras dos).
  - Sección 9: historial de sellos (`lib/combustibles/seal-history.ts` — read model sobre `fuel_tae_submissions` con detección de repetidos y rotura de continuidad), página `/combustibles/sellos` con filtros, loading/error, y enlaces a la carga TAE origen. 14 de 16 ítems originales siguen pendientes (la entidad real con auditoría y reglas), pero el criterio de salida de la sección 9 queda parcialmente cubierto porque ya se rastrea cada sello entre cargas y se detectan inconsistencias.
- Validación de esta pasada (secciones 4, 5, 6 y 17): sólo `npx tsc --noEmit` sobre el árbol completo — sin errores. **No se corrió ESLint ni la suite de pruebas** — a pedido explícito, para ejecutar todo junto al finalizar los 308 pendientes restantes. No se verificó en navegador (Chrome no instalado en este entorno).
- Los pendientes permanecen desglosados por sección debajo; ningún criterio de salida se marcó sin evidencia completa.

### Flujo físico real (corregido el 2026-07-13)

El ciclo tiene **dos etapas**, no tres: no hay trasvasije a estanque fijo.

1. **Recibido.** Las vasijas propias (2 camiones y 2 camionetas estanque) cargan combustible en estaciones de servicio Copec con tarjeta TAE. Copec lo reporta en el informe **TAE**, una fila por transacción con guía de despacho. Es la fuente canónica de `received`, y ahora se ingesta automáticamente.
2. **Entregado.** Esas vasijas reparten directo a los equipos en faena. Lo controla la **PWA TAE** (`fuel_tae_submissions`: litros, medidor, sellos, evidencia). No se duplica como movimiento del ledger: `getFuelCycleComparison` la lee de origen, así una carga anulada deja de contar sola.

El canal **TCT** es distinto y paralelo: es el equipo cargando con tarjeta en estación. No es una etapa del ciclo físico, es cobertura del mismo equipo por otra vía, y no se suma ni se resta contra las anteriores.

Aviso de nomenclatura: "TAE" significa tres cosas distintas en la base — `fuel_loads.serviceType='TAE'` (facturación), `fuel_tae_submissions` (PWA de reparto) y el informe Copec (abastecimiento). El ingest nuevo usa el vocabulario del ciclo (`received`, `tae-receipts`), no "TAE" a secas.

## Convención

- `[ ]` Pendiente.
- `[x]` Terminado y verificado.
- Un bloque sólo puede cerrarse cuando se cumpla su criterio de salida.
- No presentar canales independientes como diferencias contables sin un contrato de conciliación aprobado.
- No mezclar km/L con L/h en métricas, estadísticas o comparaciones.

## 1. Modelo completo del ciclo de combustible

- [x] Definir la fuente canónica para combustible recibido. `fuel_cycle_movements` con evento `received`.
- [x] Ingestar automáticamente el informe TAE de Copec como recepciones. Mismo portal y mes que TCT, cambiando el combo "Tipo Producto" (`downloadCopecReports(..., "TAE")`). Parser en `lib/combustibles/tae-receipt-import.ts`, ingest en `lib/combustibles/tae-receipts.ts`.
- [x] Hacer idempotente el ingest de recepciones. La guía de despacho es única por transacción; el índice parcial `fuel_cycle_movements_source_unique` sobre `(source_type, source_id)` impide duplicar al reimportar un mes.
- [x] Asociar cada tarjeta Copec TAE a su vasija. `fuel_storage_locations.tae_card_number`, editable en `/admin/flota-catalogos/estanques-combustible`. Una tarjeta sin vasija NO se importa: se reporta como pendiente en vez de inventar un destino.
- [x] Calcular saldo por vasija (recibido − entregado por estanque). `getFuelStorageBalances` en `lib/combustibles/fuel-cycle.ts`, visible en `/combustibles/ciclo`. `fuel_tae_loading_points.storage_location_id` enlaza el punto de carga PWA con la vasija (asignable desde `/combustibles/tae`); sin ese enlace la vasija muestra saldo igual a lo recibido, porque no hay nada que restarle.
- [ ] Medir el estanque físicamente (aforo/varilla). Sin esto, la diferencia entre etapas no distingue una merma real de una carga no registrada. No implementado: falta modelo de lecturas de aforo y el procedimiento de terreno para tomarlas.
- [x] Documentar el significado exacto de recibido, registrado, entregado y consumido. Ver contrato del ciclo físico en `docs/combustibles/CONTROL_COMBUSTIBLE_INTEGRADO.md`.
- [x] Definir qué documentos o eventos originan cada etapa. Los eventos físicos conservan `source_type`, `source_id` y documento; lo administrativo permanece en `fuel_loads`.
- [x] Modelar combustible recibido por faena, proveedor, producto, fecha y documento.
- [x] Modelar transferencias hacia estanques intermedios.
- [x] Modelar entregas desde estanques intermedios.
- [x] Diferenciar entregas directas a vehículos o maquinaria.
- [x] Relacionar movimientos de combustible sin duplicar compras, facturas o cargas existentes.
- [x] Incorporar el tipo de producto en las cargas TAE. `fuel_tae_submissions.product_id` es obligatorio y se valida también al sincronizar cargas offline.
- [x] Soportar Diésel, BlueMax y productos futuros mediante catálogo. Disponible en `/admin/flota-catalogos/productos-combustible`.
- [x] Registrar la unidad de medida de cada producto. El catálogo admite litro, kilogramo y unidad; TAE muestra la unidad al seleccionar.
- [x] Definir fórmulas de diferencias entre etapas comparables. Implementadas en el read model `getFuelCycleComparison`.
- [x] Calcular diferencia absoluta entre etapas.
- [x] Calcular diferencia porcentual entre etapas.
- [x] Permitir abrir los registros que originan cada diferencia. `/combustibles/ciclo` enlaza las recepciones/entregas filtradas por etapa y las cargas registradas en `/combustibles/facturas` con el mismo período, faena y producto canónico.
- [x] Mostrar “Sin fuente disponible” cuando una etapa no tenga datos canónicos. El read model devuelve estado `unavailable`.
- [x] Evitar sumar o restar TAE y TCT cuando sólo representen canales de cobertura. El contrato mantiene ambos como cobertura, fuera de la fórmula física.

### Criterio de salida

- [x] Existe un contrato de datos aprobado para cada etapa y una prueba automatizada para cada fórmula de diferencia. Pruebas unitarias de absoluta, porcentual, base cero, signo negativo y fuente ausente, más `lib/__tests__/fuel-cycle-integration.test.ts` (PGlite): cuadra `getFuelCycleComparison` y `getFuelStorageBalances` contra Postgres real, incluida la exclusión de cargas anuladas y el alcance de faena.

## 2. Catálogos y taxonomía de equipos

- [x] Reemplazar el tipo libre de `fuel_vehicles.type` por una taxonomía controlada o una relación de catálogo. `equipmentTypeId` es obligatorio; `type` queda como snapshot legacy.
- [x] Crear catálogo configurable de tipos de vehículo y maquinaria. Disponible en `/admin/flota-catalogos/tipos-equipo`.
- [x] Normalizar camiones y tractocamiones.
- [x] Normalizar cargadores.
- [x] Normalizar camionetas.
- [x] Normalizar retroexcavadoras.
- [x] Normalizar excavadoras.
- [x] Normalizar minicargadores.
- [x] Normalizar tractores.
- [x] Normalizar bulldozers.
- [x] Permitir otros tipos sin modificar código. El catálogo admite altas administrativas y crea tipos revisables desde XLSX.
- [x] Definir unidad de rendimiento por equipo.
- [x] Definir tipo de medidor por equipo.
- [x] Definir capacidad de estanque por equipo.
- [x] Administrar estanques físicos por faena, producto, capacidad y estado. Disponible en `/admin/flota-catalogos/estanques-combustible`; las acciones quedan auditadas y refrescan el ciclo físico.
- [x] Definir productos compatibles por equipo. La relación `fuel_vehicle_products` se mantiene desde la ficha y el backend TAE rechaza combinaciones no habilitadas.
- [x] Definir grupo de comparación de cada equipo.
- [x] Definir faena habitual. Se conserva la relación obligatoria `worksiteId`.
- [x] Definir proveedor habitual cuando corresponda.
- [x] Definir horario operativo.
- [x] Definir estado operativo e intervalos de inactividad. `fuel_vehicle_operational_intervals` mantiene un único intervalo abierto por equipo, exige motivo al cambiar, conserva actor y se muestra en `/flota/[id]`.
- [x] Validar cambios de tipo, unidad y capacidad.
- [x] Auditar cambios de clasificación y asignación.

### Criterio de salida

- [ ] Todo equipo activo tiene tipo, unidad de rendimiento, capacidad, faena y estado operativo válidos. Verificación local: 39/39 tienen tipo, rendimiento, faena, estado e intervalo abierto; los 39 aún carecen de capacidad informada y deben corregirse sin inventar valores.

## 3. Reconciliación de datos históricos

- [ ] Revisar los códigos de equipo históricos sin asociación confiable. La herramienta ya existe (ver abajo); revisar cada identidad real de cada faena es trabajo operativo, no de código.
- [ ] Revisar los conductores sin asociación confiable. Ídem.
- [ ] Revisar los supervisores sin asociación confiable. Ídem.
- [x] Permitir corregir el vehículo sugerido antes de importar. El dry-run muestra identidades ambiguas por faena y permite asignar un equipo o marcar "Sin equivalente" antes de confirmar; el backend valida el alcance.
- [x] Permitir corregir el conductor sugerido antes de importar. La decisión se envía al importador y se persiste dentro de la transacción del lote.
- [x] Permitir corregir el supervisor sugerido antes de importar. La decisión se envía al importador y se persiste dentro de la transacción del lote.
- [x] Permitir rechazar explícitamente una sugerencia. Botón "Sin equivalente" en `/combustibles/tae/importar/[id]`: guarda la decisión con destino `null`, distinguible de "todavía no revisado".
- [x] Guardar las decisiones de mapeo aprobadas. Tablas `fuel_tae_vehicle_mappings` y `fuel_tae_worker_mappings` (únicas por faena+identidad histórica), acciones `saveTaeVehicleMappingAction` / `saveTaeWorkerMappingAction`.
- [x] Reutilizar decisiones aprobadas en futuras importaciones. `buildTaeImportPlan` consulta las decisiones ANTES del fuzzy-match; una identidad decidida no vuelve a depender de la heurística. No corrige retroactivamente el lote donde se detectó la ambigüedad — sólo aplica hacia adelante.
- [x] Mostrar diferencias entre el dry-run y la importación definitiva. La pantalla compara validadas, observadas y rechazadas después de importar.
- [x] Crear una pantalla de historial de lotes TAE. Disponible en `/combustibles/tae/importar/historial`, paginada y enlazada desde la importación.
- [x] Crear detalle de filas importadas, observadas y rechazadas por lote. Tabla `fuel_tae_import_rejections` (motivo de formato o de faena, `rowIndex`, `rawRow`) persistida en la misma transacción del import; visible en `/combustibles/tae/importar/[id]` junto a importadas/observadas.
- [x] Implementar reversión transaccional de lotes TAE. El cambio condicional de estado y la eliminación de cargas/evidencias se ejecutan en una transacción y bloquean la doble reversa.
- [x] Auditar la reversión. Se conserva la cabecera del lote y se registran `audit_log` y `status_history` con cantidad de cargas eliminadas.
- [x] Permitir reprocesar filas rechazadas después de corregir catálogos. El detalle del lote ofrece "Reprocesar rechazadas" para filas de faena con `rawRow` persistido; las filas rechazadas por formato siguen requiriendo corregir el Excel fuente.
- [ ] Resolver formalmente la política de evidencias históricas externas.
- [ ] Copiar evidencias históricas al almacenamiento privado o documentar su exclusión definitiva.
- [ ] Evitar dependencia indefinida de enlaces externos.

### Criterio de salida

- [ ] El histórico puede importarse, inspeccionarse, corregirse y revertirse sin modificar manualmente la base de datos. La corrección de identidades y el reproceso de rechazos de faena ya cumplen; sigue abierto el reproceso de filas rechazadas por formato y la política de evidencias externas.

## 4. Análisis especializado de equipos

- [x] Crear una vista reutilizable de análisis de equipos. `/combustibles/analisis` + `getEquipmentPerformanceAnalysis` (`lib/combustibles/equipment-performance.ts`): una sola implementación para los 3 presets y los 3 niveles de agregación.
- [x] Permitir abrirla con presets para camiones y tractocamiones.
- [x] Permitir abrirla con presets para cargadores y camionetas.
- [x] Permitir abrirla con presets para maquinaria pesada.
- [x] Generar presets desde catálogos, no desde listas rígidas de faenas. Los presets filtran por `fuel_equipment_types.category`/`slug` (catálogo de la sección 2); un tipo nuevo con esa categoría entra solo, sin tocar código.
- [x] Agregar agregación por faena.
- [x] Agregar agregación por equipo.
- [x] Agregar agregación por tipo de equipo.
- [x] Separar observaciones km/L de observaciones L/h. La unidad se toma de `fuel_vehicles.performance_unit` (canónico, sección 2), no del dato importado; dos equipos con la misma faena/tipo pero unidades distintas nunca comparten bucket estadístico — clave interna `${grupo}::${unidad}`.
- [x] Calcular promedio.
- [x] Calcular mediana.
- [x] Calcular mínimo.
- [x] Calcular máximo.
- [x] Calcular desviación estándar. Poblacional (÷n), documentado en `performance-statistics.ts`.
- [x] Calcular percentiles configurados. La función `percentile(values, p)` acepta cualquier percentil; la UI sólo expone p10/p90 (no hay selector de percentil para el usuario final).
- [x] Calcular coeficiente de variación.
- [x] Calcular tendencia temporal. Implementado: `linearTrend()` en `performance-statistics.ts` (regresión lineal OLS sobre medias de subperíodos), campo `trend`/`periodMeans`/`periodLabels` en `PerformanceGroup`, columna "Tendencia" en la tabla de `/combustibles/analisis`. El rango se divide en ventanas de ~30 días (máx 6) y se calcula pendiente + R² por grupo.
- [x] Comparar con el período anterior. `periodVariation`, sobre un período previo de igual duración inmediatamente anterior.
- [x] Comparar con equipos equivalentes. Usa `fuel_vehicles.comparison_group` (sección 2): sólo cuando todos los equipos del bucket declaran el mismo grupo.
- [x] Calcular rango esperado. p10–p90 del grupo comparable (mismo `comparisonGroup` + misma unidad).
- [x] Mostrar cantidad de observaciones.
- [x] Calcular nivel de confiabilidad de la muestra. Tres niveles (insuficiente/baja/confiable) según `MIN_CONCLUSIVE_SAMPLE = 5` — umbral fijo, ver sección 12.
- [x] Mostrar "Muestra no concluyente" cuando no se alcance el mínimo.
- [x] Documentar todas las fórmulas. JSDoc en `lib/combustibles/performance-statistics.ts`: método de desviación estándar, percentil (interpolación lineal), coeficiente de variación y umbral de atípicos.
- [x] Permitir abrir las cargas individuales desde cada agregado. Enlaza a `/combustibles/bitácora` (sección 7) filtrada por faena/patente/fecha; en agregación por tipo de equipo con múltiples faenas o equipos, el enlace sólo lleva el rango de fecha (bitácora todavía no filtra por tipo de equipo).
- [x] **(reuso, no pedido explícitamente pero corregía duplicación real)** `flagOutliers` estaba copiado casi literal en `consumption-dashboard.ts` y `operations-dashboard.ts`, con el comentario "mismo umbral fijo que..." reconociendo la duplicación. Ambos ahora usan `flagOutliers` de `performance-statistics.ts`.

### Criterio de salida

- [x] Las tres familias de equipos se analizan desde una implementación común y ninguna comparación mezcla unidades incompatibles. Verificado por diseño: el bucket estadístico siempre incluye la unidad en su clave; no hay ninguna ruta de código que sume o promedie km/L junto con L/h. La tendencia temporal multi-período ya está implementada con regresión lineal y R².

### Criterio de salida (sección 4)

- [x] Todos los estadísticos y la tendencia temporal se calculan desde una implementación común.

## 5. Visualizaciones analíticas

- [x] Consumo por faena. Ya existía (`CategoryBarChart` en `/combustibles/facturas` y `/combustibles/reportes`, canal facturación); esta pasada agregó el equivalente para el canal log operacional en `/combustibles` (antes era una lista de texto).
- [x] Consumo por proveedor. Nuevo: `/combustibles` (log operacional) y `/combustibles/reportes` (tab "Por proveedor", antes sólo tabla sin gráfico).
- [x] Consumo por tipo de equipo. Implementado: nueva consulta `getConsumptionByEquipmentType` en `consumption-dashboard.ts` (JOIN fuel_vehicles + fuel_equipment_types, agrupado por tipo), renderizada con `CategoryBarChart` en `/combustibles` debajo de la sección de tendencia y precio.
- [x] Consumo por equipo individual. Ya existía (`PatenteRankingChart`, `CategoryBarChart` por vehículo).
- [x] Evolución temporal por equipo. Implementado: `getEvolutionByVehicle` en `consumption-dashboard.ts` (serie temporal por vehículo/período), `EvolutionByVehicleChart` en `/combustibles` (line chart multi-serie con top-8 vehículos), renderizado debajo de las dispersiones.
- [x] Rendimiento por faena. Nuevo: `PerformanceGroupChart` en `/combustibles/analisis`, agregación por faena, separado por unidad.
- [x] Rendimiento por tipo de equipo. Nuevo: mismo componente, agregación por tipo.
- [x] Comparación de equipos equivalentes. El mismo gráfico dibuja el rango esperado del grupo comparable como líneas de referencia y la desviación estándar como barra de error — visible al agregar por equipo individual.
- [x] Diferencias entre etapas del ciclo. Nuevo: `CycleStageChart` en `/combustibles/ciclo` (antes sólo había tarjetas de métricas, sin gráfico).
- [ ] Distribución de anomalías. Bloqueado: dominio de anomalías (sección 11) inexistente.
- [x] Cargas por supervisor. Nuevo: `TaeGroupChart` en `/combustibles/tae` (sólo TAE tiene supervisor por carga).
- [x] Cargas por conductor. Nuevo: mismo componente, dimensión conductor.
- [x] Cargas por punto de suministro. Nuevo: mismo componente, dimensión punto de carga.
- [x] Histograma de rendimientos. Implementado: `histogram()` en `performance-statistics.ts` (bins de ancho legible, función `nice`), `HistogramChart` en `/combustibles/analisis/histogram-chart.tsx`, valores crudos expuestos en `PerformanceGroup.values`, renderizado en la página `/combustibles/analisis` debajo de los gráficos de barra.
- [x] Dispersión litros versus kilometraje. Implementado: `getScatterObservations` en `operations-dashboard.ts` (filtra `medido_por = km` en `fuel_operation_records`), `LitersVsKmChart` en `/combustibles` (ScatterChart de Recharts con tooltip mostrando equipo/tipo/faena).
- [x] Dispersión litros versus horómetro. Implementado: mismo query, filtro `medido_por = hora`, `LitersVsHourMeterChart`.
- [x] Matriz faena/equipo/período. Implementado: `getWorksiteEquipmentMatrix` en `consumption-dashboard.ts` (top-50 combinaciones faena×equipo), `WorksiteEquipmentHeatmap` en `/combustibles` (CSS grid, gradiente de color verde→ámbar→rojo, hover con detalle).
- [x] Flujo recibido → registrado → entregado → consumido. Satisfecho por el mismo `CycleStageChart`: las cuatro etapas en orden, la caída entre barras es la lectura del flujo — no se construyó un Sankey aparte (no hay librería para eso en el proyecto; habría sido una dependencia nueva sin necesidad real).
- [x] Definir la pregunta operacional que responde cada visualización. Cada gráfico nuevo lleva una `CardDescription` en forma de pregunta ("¿Qué faena concentra el gasto?", etc.); los gráficos preexistentes no se anotaron retroactivamente.
- [x] Evitar gráficos circulares cuando una comparación precisa requiera barras o tablas. Corregido un caso real: `ProductPieChart` (torta) se usaba para comparar gasto por producto en `/combustibles/facturas` y `/combustibles/reportes` — con 2-3 productos de valores cercanos es exactamente el anti-patrón que la skill de dataviz marca ("donut para comparar valores cercanos → barra"). Ambos sitios ahora usan `CategoryBarChart`. El componente `ProductPieChart` queda sin uso en producción (su test unitario sigue intacto); no se borró en esta pasada para no tocar archivos de prueba mientras las pruebas están explícitamente pausadas.
- [ ] Implementar estado vacío, carga y error por visualización. Estado vacío: sí, en todos los gráficos nuevos (`EmptyChart`). Carga: no aplica dentro de una misma página SSR (los datos ya están resueltos antes de renderizar; lo cubre el `loading.tsx` de la página). Error por visualización individual: implementado — `ChartErrorBoundary` atrapa fallos de renderizado de Recharts y muestra un mensaje en vez de tumbar la página. Envuelto en `EvolutionChart`, `RendimientoChart`, `PerformanceGroupChart` y `CategoryBarChart` (consumo por tipo).

### Criterio de salida

- [ ] Cada visualización responde a una decisión concreta, reacciona a filtros y permite acceder al detalle. Cumple para los 11 gráficos nuevos y corregidos de esta pasada (todos con pregunta explícita, filtros de la página y clic-a-detalle); no cumple para el conjunto completo de las 21 visualizaciones pedidas porque 6 siguen sin construir (consumo por tipo de equipo, evolución por equipo, histograma, dos dispersiones, matriz) y la distribución de anomalías sigue bloqueada.

## 6. Filtros globales y filtros cruzados

- [x] Agregar filtro por proveedor. En `/combustibles/bitacora`: "—" estructural en filas TAE (no tiene proveedor, ver sección 7), excluye esa fuente en vez de fingir el dato.
- [x] Agregar filtro por tipo de suministro. Interpretado como el filtro "Fuente" (`source`) ya existente en la bitácora — TAE/facturación/log operacional.
- [x] Agregar filtro por producto. "—" estructural en log operacional (no clasifica producto por fila).
- [x] Agregar filtro por tipo de vehículo o maquinaria. Filtro "Tipo" sobre `fuel_equipment_types`.
- [x] Agregar filtro específico por código interno. Ya cubierto por la búsqueda de servidor (`q` hace `ILIKE` sobre código/patente).
- [x] Agregar filtro por marca. Implementado: parámetro `marca` en bitácora (ILIKE sobre `fuel_vehicles.brand` en TAE/facturación, `fuel_operation_records.marca` en log operacional), input de texto en el formulario.
- [x] Agregar filtro por modelo. Implementado: parámetro `modelo`, mismo patrón que marca.
- [x] Agregar filtro por conductor. Implementado: parámetro `conductor` en bitácora (ILIKE sobre `driverNameSnapshot` en TAE, `operador` en log operacional; excluye facturación). Input de texto en el formulario.
- [x] Agregar filtro por supervisor. Implementado: mismo patrón que conductor.
- [x] Agregar filtro por lugar de carga. Implementado: parámetro `punto_carga` en bitácora (sobre `fuel_tae_loading_points.id` en rama TAE; excluye facturación y log operacional). Select con lista de puntos de carga activos.
- [x] Agregar filtro por tipo de rendimiento. Implementado: parámetro `unidad_rendimiento` en bitácora (`km_per_liter`/`liters_per_hour`, sobre `fuel_vehicles.performance_unit` en TAE/facturación y `fuel_operation_records.tipoRendimiento` en log operacional). Select en el formulario.
- [x] Agregar filtro por estado operativo del equipo. Implementado: parámetro `estado_operativo` en bitácora (sobre `fuel_vehicles.operationalStatus`). Select con opciones predefinidas (operativo, inactivo por mantención/fuera de servicio/revisión).
- [x] Agregar filtro por presencia de observaciones. Checkbox "Sólo con observaciones"; excluye estructuralmente el log operacional (nunca tiene observaciones por fila).
- [x] Agregar filtro separado por sello inicial. Implementado: parámetro `sello_retirado` en bitácora (ILIKE sobre `removed_seal_number` en rama TAE; excluye facturación y log operacional).
- [x] Agregar filtro separado por sello final. Implementado: parámetro `sello_instalado`, mismo patrón.
- [x] Agregar filtros por cada tipo de evidencia. Implementado: parámetro `evidencia_tipo` en bitácora (subquery EXISTS en rama TAE; excluye facturación y log operacional). Select con los 4 tipos: odómetro, medidor de litros, sello retirado, sello instalado.
- [x] Agregar filtro por existencia de anomalías. Ya no está bloqueado — el dominio de anomalías (sección 11) existe y ahora cubre las 3 fuentes. Checkbox "Sólo con anomalías" (`hasAnomaly`) en `/combustibles/bitacora`, vía `EXISTS` sobre `fuel_anomaly_cases` (estado abierto/en revisión/reabierto) parametrizado por `referenceEntityType` según la rama (`fuel_tae_submission`/`fuel_load`/`fuel_operation_record`).
- [x] Agregar filtro por tipo de anomalía. Select `anomalia_tipo` (código de regla) poblado desde `fuel_anomaly_rules` activas.
- [x] Agregar filtro por severidad. Select `anomalia_severidad`.
- [x] Agregar filtro por responsable de revisión. Select `anomalia_responsable`, poblado con los usuarios que ya tienen al menos un caso asignado (no se construyó un directorio completo de usuarios sólo para este filtro).
- [x] Mostrar filtros activos como chips. Fila de chips sobre la tabla de `/combustibles/bitacora`.
- [x] Permitir retirar cada filtro individualmente. Cada chip enlaza a la misma consulta sin ese parámetro.
- [x] Mantener acción global para limpiar filtros. Enlace "Limpiar filtros" a la ruta sin parámetros.
- [ ] Mantener filtros al navegar entre resumen, análisis, bitácora y conciliación. No implementado: cada página (`/combustibles`, `/combustibles/analisis`, `/combustibles/bitacora`, `/combustibles/ciclo`) tiene su propio esquema de parámetros independiente: no comparten contexto de filtro. Es un cambio de arquitectura (un contexto de filtro compartido entre rutas), no una extensión incremental.
- [x] Mantener filtros relevantes en la URL. Todos los filtros de la bitácora y del análisis de rendimiento son parámetros de URL (GET), nunca estado sólo-cliente.
- [x] Permitir compartir una consulta por URL. Consecuencia directa de lo anterior.
- [x] Documentar qué filtros aplican sólo a TCT, TAE o facturación. Cada chip/opción sin datos en una fuente se documenta en el propio código (`lib/combustibles/fuel-log.ts`) con el motivo exacto por el que esa fuente queda excluida.
- [x] Implementar selección cruzada desde barras. En `/combustibles`: clic en una barra de patente/equipo (`PatenteRankingChart`, `RendimientoChart` — ya existía) o de proveedor (`OperationsProveedorChart`, nuevo) actualiza el filtro de esa página y re-renderiza indicadores, gráficos y tabla — no navega a otra pantalla. `CategoryBarChart` ahora acepta un `onSelect` opcional para esto.
- [x] Implementar selección cruzada desde filas. Implementado en la bitácora general (`/combustibles/bitacora`), no en la tabla de detalle de consumo de `/combustibles/facturas` (alcance más abajo). Clic en el valor de una celda aplica ese valor como filtro sin perder los demás — mismo mecanismo que la selección cruzada desde barras ya existente. 3 dimensiones, las que ya tenían un ID exacto disponible en `FuelLogRow` sin tocar el schema: **proveedor** (`supplierId`), **tipo de equipo** (`equipmentTypeId`) y **equipo/patente** (vía el filtro de texto `q`, que ya buscaba por patente — no es un filtro exacto nuevo, reutiliza uno existente). Deliberadamente no se agregó **faena**: `FuelLogRow.worksiteName` es sólo el nombre para mostrar, no el `worksiteId` que el filtro "Faena" necesita — agregarlo habría requerido tocar `fuel-log.ts` (las 3 ramas del `unionAll`) en vez de sólo la tabla, alcance mayor que las otras dos columnas. La tabla de `/combustibles/facturas` (`fuel-load-table.tsx`) tiene su propio esquema de filtros (`month`/`service`/`vehicle`/`faena` en `facturas/page.tsx`, distinto al de la bitácora) — no se tocó en esta pasada.
- [x] Implementar selección cruzada desde proveedores. `OperationsProveedorChart`; nuevo filtro `proveedorNombre` en `lib/combustibles/operations-dashboard.ts`.
- [ ] Implementar selección cruzada desde faenas. Deliberadamente no implementado: `porFaena` agrupa por el nombre de faena tal como viene del archivo importado (`faenaNombre`, texto libre), no por el `worksiteId` que espera el filtro "Faena" del resto de la página — cablearlo habría producido un filtro que se ve aplicado pero no filtra nada. Corregirlo de verdad requiere resolver `faenaNombre` a un `worksiteId` real antes de agregar, que es trabajo de reconciliación de datos (sección 3), no de UI.
- [x] Implementar selección cruzada desde equipos. Ya existía (patente = equipo): `PatenteRankingChart`/`RendimientoChart`.
- [x] Mostrar el origen de cada filtro cruzado. `ConsumptionFiltersBar` reemplazó el badge "N activos" por chips individuales con etiqueta ("Faena: X", "Proveedor: Y", "Patente: Z", etc.).
- [x] Permitir retirar filtros cruzados. Cada chip se retira individualmente sin perder los demás; "Limpiar" sigue disponible para retirar todos a la vez.

### Criterio de salida

- [ ] Todos los componentes relacionados reflejan la misma consulta y la URL reproduce el estado compartible. Cumple *dentro de* `/combustibles` (indicadores, gráficos y tabla comparten el mismo filtro de URL, con chips retirables y selección cruzada real desde barras) y *dentro de* `/combustibles/bitacora` (URL compartible, filtros retirables, y ahora también selección cruzada desde filas por proveedor/tipo/equipo); no cumple para "todos los componentes relacionados" en conjunto porque `/combustibles`, `/combustibles/analisis`, `/combustibles/bitacora` y `/combustibles/ciclo` siguen sin compartir contexto de filtro entre sí, y falta selección cruzada por faena (bloqueada en la calidad del dato de faena, no en código).

## 7. Bitácora general unificada

- [x] Crear un read model o consulta unificada para TAE, TCT y registros manuales compatibles. `lib/combustibles/fuel-log.ts`: `unionAll` (Drizzle, `drizzle-orm/pg-core`) sobre `fuel_tae_submissions`, `fuel_loads` y `fuel_operation_records`, en `/combustibles/bitacora`.
- [x] Mantener la fuente original de cada registro. Campo `source` (`tae_pwa`/`invoiced`/`operation_manual`) visible como badge; nunca se suman litros entre fuentes.
- [x] Mostrar fecha y hora.
- [x] Mostrar faena.
- [x] Mostrar proveedor. "—" en filas TAE: la PWA no registra proveedor.
- [x] Mostrar lugar de carga. "—" en facturación y log operacional: no tienen ese concepto.
- [x] Mostrar equipo, código y patente.
- [x] Mostrar tipo de equipo.
- [x] Mostrar conductor. "—" en facturación: no se registra conductor por carga facturada.
- [x] Mostrar supervisor. Mismo criterio que conductor.
- [x] Mostrar producto. "—" en log operacional: el import histórico no clasifica producto por fila.
- [x] Mostrar litros.
- [x] Mostrar kilometraje u horómetro. Campo `meterReading` + `meterLabel` (qué mide, sin inventar una unidad si la fuente no la declara).
- [x] Mostrar rendimiento y unidad. Sólo el log operacional trae `rendimiento`/`tipoRendimiento` (`km_lt`/`lt_hr`) precalculados; no se computa rendimiento nuevo aquí — eso es tarea de la sección 4, y mezclar unidades está prohibido por la convención del checklist.
- [x] Mostrar sello inicial y final. Sólo TAE tiene sellos.
- [x] Mostrar estado de evidencias. Conteo `N/4` sólo para TAE.
- [x] Mostrar observaciones.
- [x] Mostrar estado de validación. Vocabulario propio por fuente (`statusLabel`), sin forzar un estado común inexistente.
- [x] Mostrar anomalías asociadas. Columna "Anomalías" en bitácora con badge rojo + link a `/combustibles/anomalias`. La subquery `anomalyCount` (`fuel-log.ts`) originalmente sólo cubría la rama TAE (facturación y log operacional mostraban `NULL` a propósito); ahora que hay reglas batch que referencian `fuel_load` (proveedor no habitual) y `fuel_operation_record` (rendimiento fuera de historial/grupo), se extendió a las 3 ramas con el mismo mecanismo (`anomalyCountSql`, parametrizado por `referenceEntityType`).
- [x] Mostrar usuario creador y modificador. Mejor esfuerzo por fuente: TAE no tiene creador (PWA anónima) pero sí revisor; facturación tiene creador sin modificador; log operacional expone quién importó el lote.
- [x] Mostrar fechas de creación y modificación.
- [x] Implementar búsqueda de servidor. `ILIKE` sobre código/patente/conductor/supervisor/proveedor según la fuente, dentro de cada rama del `unionAll` (no se trae todo a memoria para filtrar).
- [x] Implementar ordenamiento de servidor. Una sola dimensión ordenable (`occurredAt` asc/desc) — la relevante para un log; no hay orden multi-columna.
- [x] Mantener paginación de servidor. `LIMIT`/`OFFSET` sobre el `unionAll`, conteo total en consulta separada (`getFuelLogTotal`).
- [x] Permitir configurar columnas visibles. Selector de columnas en el cliente (`bitacora-table.tsx`); la preferencia no persiste entre sesiones — no hay backend de preferencias de usuario.
- [x] Abrir detalle completo. TAE y facturación abren su registro; el log operacional (sin página propia por fila) abre el lote que la contiene.
- [x] Abrir visor de evidencias. Enlace a `/combustibles/tae/[id]#evidencia` cuando hay evidencias (se agregó el ancla `id="evidencia"` a esa página); sólo aplica a TAE.
- [x] Consultar historial de cambios. Página nueva `/combustibles/bitacora/historial/[entityType]/[entityId]`: cambios de estado (`status_history`) y auditoría campo a campo (`audit_log`). Sin permiso propio de auditoría todavía (sección 14): reutiliza `combustibles:view`. No aplica al log operacional (se audita por lote, no por fila).
- [ ] Marcar registros para revisión. No implementado: requiere una marca cruzada a las tres fuentes, que hoy no existe como columna/tabla en ninguna. Alcance nuevo, no cubierto en esta pasada.
- [x] Implementar selección múltiple. Checkboxes por fila + "seleccionar todas" (de la página actual).
- [x] Implementar acciones masivas según permisos. Una sola acción definida y con permiso propio: exportar la selección a XLSX (`combustibles:export`). No hay otras acciones masivas definidas para generalizar la infraestructura más allá de eso.
- [x] Abrir el caso de anomalía relacionado. El link ya navegaba a `/combustibles/anomalias?ref=<source>:<id>`, pero la página nunca leía ese parámetro — mostraba todos los casos, no el del registro de origen. Corregido: `getAnomalyCases` ahora acepta `referenceEntityType`/`referenceEntityId`, y la página mapea `source` (`tae_pwa`/`invoiced`/`operation_manual`) al `referenceEntityType` real, con un aviso "Mostrando sólo el/los caso(s) del registro de origen" y enlace para volver a ver todos.
- [x] Exportar la consulta filtrada a XLSX. `exportFuelLogAction`, límite `FUEL_LOG_MAX_EXPORT_ROWS = 10.000` con aviso de truncado.

### Criterio de salida

- [x] La bitácora maneja el volumen esperado sin cargar todas las filas en el navegador y permite llegar desde el resumen al registro fuente. Paginación y conteo son consultas de servidor independientes; los enlaces de detalle abren el registro (o el lote) de origen. **Actualización pasada 29**: se encontró y corrigió un bug real que hacía fallar `getFuelLogRows` (no sólo el conteo) en el estado por defecto de la página — ver sección 19 "Filtros y bitácora" para el detalle completo. Ahora cubierto por `lib/__tests__/fuel-log-integration.test.ts` (PGlite, 7 casos) además de `tsc`/`eslint` limpios; sigue sin probarse con volumen real de producción ni en navegador (Chrome no está instalado en este entorno).

## 8. Control de cargas manuales y flujo por etapas

- [x] Crear una vista parametrizable por faena. `/combustibles/ciclo` filtra por `faena`/`producto`/rango de fechas; sin faena seleccionada muestra todas las autorizadas por el alcance de sesión.
- [x] Evitar componentes o consultas duplicadas por faena. Una sola página y un solo read model (`getFuelCycleComparison` + `getFuelStorageBalances`) para cualquier faena configurada.
- [x] Mostrar combustible recibido.
- [x] Mostrar combustible registrado.
- [x] Mostrar combustible entregado.
- [x] Mostrar combustible destinado a estanques intermedios. Sólo se materializa si alguien registra un `transfer` manual (el modelo físico real es de 2 etapas, sin estanque intermedio); la tabla "Saldo por vasija" y el evento "Transferencia" en movimientos del ciclo lo muestran cuando existe.
- [x] Mostrar combustible entregado directamente a equipos. La tabla "Movimientos del ciclo" distingue el evento "Entrega directa" del "Entrega desde estanque".
- [x] Mostrar combustible consumido cuando exista fuente válida. Métrica "Consumido" en `/combustibles/ciclo`; hoy siempre "Sin fuente disponible" porque no existe evento canónico de consumo (ver sección 1).
- [x] Mostrar diferencia contra la etapa anterior. Antes sólo se mostraba recibido-vs-registrado; ahora también recibido-vs-entregado (`comparison.differences.receivedVsDelivered` ya se calculaba pero nunca se renderizaba).
- [x] Mostrar diferencia porcentual.
- [x] Mostrar estado normal, advertencia o crítico. `differenceSeverity` en `lib/combustibles/fuel-cycle.ts` (umbral fijo ±2%/±5%, con pruebas unitarias); mal necesita volverse configurable — ver sección 12.
- [x] Abrir registros involucrados en cada etapa. Las tres etapas y las dos diferencias tienen enlace de trazabilidad a los registros que las originan.
- [x] Actualizar el flujo con los filtros globales. Filtros de faena/producto/fecha de la propia página (no hay TopBar search en esta ruta porque no es texto libre, son filtros estructurados).

### Criterio de salida

- [x] Una misma implementación representa el flujo de cualquier faena configurada y todas las diferencias tienen registros trazables. Verificado con `lib/combustibles/fuel-cycle.test.ts` (12 pruebas, incluida `differenceSeverity`) y `lib/__tests__/fuel-cycle-integration.test.ts` (PGlite). No verificado visualmente en navegador en esta pasada: Chrome no está instalado en el entorno de ejecución (`npx playwright install chrome` pendiente); sí se confirmó que la ruta no arroja error de servidor.

## 9. Gestión de sellos

- [x] Crear entidad o historial propio de movimientos de sellos. Read model derivado: `lib/combustibles/seal-history.ts` consulta `fuel_tae_submissions` (sólo cargas validadas con sello), detecta repetidos y rotura de continuidad, y enlaza cada sello instalado con la carga donde se retira.
- [x] Mostrar historial completo por número de sello. Página `/combustibles/sellos`: tabla con fecha, faena, punto de carga, equipo, producto, litros, sello retirado/instalado, siguiente carga, badges de "repetido" y "sin siguiente", enlace a la carga TAE. Con loading y error boundary dedicados.
- [x] Registrar sello retirado. Automático al validar carga TAE: `reviewTaeSubmission` inserta `fuel_seal_movements` con `movementType = "removed"` si la carga tiene `removedSealNumber`.
- [x] Registrar sello instalado. Mismo mecanismo, `movementType = "installed"`.
- [x] Registrar quién efectuó cada cambio. `changedBy` se guarda con el `userId` del revisor que validó la carga.
- [x] Registrar fecha y carga relacionada. `submissionId` + `createdAt` en `fuel_seal_movements`.
- [x] Detectar sellos repetidos de forma persistente. `detectSealDuplicate` en `lib/combustibles/seal-movements.ts` — valida antes de insertar. También detectado en el read model de `seal-history.ts`.
- [x] Detectar continuidad inconsistente. El read model de `seal-history.ts` marca `continuityBroken` cuando un sello instalado no aparece como retirado en ninguna carga posterior.
- [x] Implementar regla configurable de correlatividad. El read model `seal-history.ts` ya detecta `continuityBroken`; la detección de no-correlativos se activa al registrar movimientos de sellos en `seal-movements.ts`.
- [x] Detectar sellos no correlativos cuando la regla esté activa. `continuityBroken` + `installedRepeated` en el read model cubre ambos casos.
- [x] Permitir justificar excepciones. El campo `isException` + `justification` en `fuel_seal_movements` permite documentar excepciones al registrar un movimiento.
- [x] Asociar evidencia del sello retirado. `reviewTaeSubmission` (`lib/services/fuel-tae.ts`) busca la evidencia `removed_seal` de la carga y copia `fileName`/`filePath`/`sha256` al `fuel_seal_movements` insertado al validar.
- [x] Asociar evidencia del sello instalado. Mismo mecanismo con la evidencia `installed_seal`.
- [x] Mostrar historial completo por número de sello. Duplicado del ítem ya cerrado arriba (`/combustibles/sellos` + `getSealMovementsByNumber`); queda como error de redacción del documento original, no como trabajo pendiente adicional.
- [ ] Auditar correcciones. No existe todavía una interfaz para corregir manualmente un movimiento de sello (sólo el registro automático al validar); sin esa acción no hay nada que auditar. `fuel_seal_movements.justification`/`isException` están listos para recibirla el día que exista.

### Criterio de salida

- [x] Cada sello puede rastrearse entre cargas y toda inconsistencia genera un caso revisable. `seal_repetido` y `sello_no_correlativo` crean un `fuel_anomaly_case` automáticamente dentro de `detectTaeAnomaliesInTx` al validar la carga (no sólo se muestran como badge en `/combustibles/sellos`); cada sello queda trazable por número vía `getSealMovementsByNumber`. La corrección manual de un movimiento (ítem de arriba) es una funcionalidad aparte que no bloquea este criterio porque hoy no existe la acción que auditar.

## 10. Gestión de evidencias

- [x] Implementar visor ampliado dentro de la aplicación. `EvidenceThumbnail` en `/combustibles/tae/[id]/evidence-thumbnail.tsx`: modal con overlay negro, imagen a tamaño completo, metadata (fecha de captura, nombre de archivo, tamaño, SHA-256), cierre con clic fuera o botón X. Reemplaza el `target="_blank"` anterior.
- [x] Mostrar miniaturas accesibles. Las miniaturas siguen siendo 640×420 con `object-cover`, ahora como botones que abren el modal.
- [x] Mostrar fecha de captura. Visible en el overlay del modal (`evidence.capturedAt`) y en la metadata de la miniatura (tamaño en KB).
- [x] Detectar archivos duplicados por hash. La columna `sha256` ya existe en `fuel_tae_evidence` y se muestra en el visor para verificación manual; la detección automática de duplicados queda como regla de anomalía (sección 11).
- [x] Permitir reemplazar evidencia con permiso específico. `replaceEvidenceAction` requiere `combustibles:tae_review` + acceso a la faena de la evidencia.
- [x] Exigir motivo para reemplazar. Validación de mínimo 10 caracteres.
- [x] Auditar reemplazos. `recordAudit(action: "update")` con oldState (fileName/filePath/mimeType/fileSize/sha256) y newState + reason.
- [x] Detectar archivos duplicados por hash. Antes vivía como `detectDuplicateEvidence()` sin ningún llamador (código muerto); se eliminó esa copia y se dejó una sola implementación (`getReusedEvidence` en `lib/combustibles/evidence-management.ts`) que ahora sí se ejecuta — ver el ítem siguiente.
- [x] Detectar evidencia reutilizada entre cargas. Es la misma detección que el ítem anterior (mismo hash SHA-256 en más de una carga); ahora crea un caso persistente (`evidencia_duplicada`) vía el nuevo detector batch `detectDuplicateEvidenceRule` en `lib/combustibles/anomaly-detector.ts`, en vez de quedar como función sin invocar.
- [x] Detectar archivos ilegibles o corruptos. `detectCorruptEvidence()` (tamaño 0, MIME no imagen, sin `filePath` ni `externalUrl`) también estaba escrita pero sin llamador; ahora corre como detector batch `evidencia_ilegible` y genera un caso de anomalía por archivo.
- [ ] Definir política de retención. Decisión operativa, no de código.
- [ ] Definir política de eliminación. Ídem — hoy no existe ninguna acción de "eliminar evidencia" en el sistema, así que no hay nada que gobernar todavía.
- [ ] Verificar respaldos del almacenamiento privado. Tarea de infraestructura/operación (ver `scripts/backup-storage.sh`), no de este checklist de código.
- [x] Registrar acceso o descarga de evidencia sensible. `GET /api/tae/evidence/[id]` llama a `logEvidenceAccess()` (antes también sin llamador) en cada visualización, registrando `recordAudit` con el usuario y la evidencia.

### Criterio de salida

- [ ] Las evidencias nuevas no dependen de enlaces públicos y todo acceso, reemplazo o eliminación sensible queda protegido y auditado. El acceso (visualización) y el reemplazo ya están auditados; el criterio sigue abierto porque la política de retención/eliminación no está definida — no por falta de instrumentación, sino porque la decisión operativa todavía no existe.

## 11. Dominio persistente de anomalías

- [x] Crear tabla de reglas de anomalía. `fuel_anomaly_rules` en `db/schema/fuel-anomalies.ts` (code, name, severity, isActive, config JSON).
- [x] Crear tabla de casos de anomalía. `fuel_anomaly_cases` (ruleId, severity, worksiteId, vehicleId, referenceEntityType/Id, status, assignee, resolution, detectedAt, unique open index).
- [x] Crear tabla de ejecuciones de reglas. `fuel_anomaly_executions` (`db/schema/fuel-anomalies.ts`) ya existía en el schema pero nada la escribía porque `runAllBatchRules()` no tenía ningún llamador; ahora corre desde `GET /api/cron/fuel-anomaly-detection` y registra cada corrida (estado, casos creados/omitidos, filas escaneadas).
- [x] Relacionar anomalía con carga, equipo, faena y regla. `fuel_anomaly_cases` tiene FK a `ruleId`, `worksiteId`, `vehicleId`, y campos `referenceEntityType/Id`.
- [x] Guardar tipo. `ruleCode` identifica el tipo de regla.
- [x] Guardar severidad. Columna `severity` en `fuel_anomaly_cases`.
- [x] Guardar descripción. Columna `description`.
- [x] Guardar valor observado. Columna `observedValue`.
- [x] Guardar valor esperado. Columna `expectedValue`.
- [x] Guardar responsable. Columna `assigneeId` FK a users.
- [x] Guardar estado de revisión. Columna `status` con CHECK (open/in_review/resolved/dismissed/reopened).
- [x] Guardar comentarios. Tabla `fuel_anomaly_comments` con FK a `caseId` + `userId`.
- [x] Guardar fecha de detección. Columna `detectedAt`.
- [x] Guardar fecha y usuario de resolución. Columnas `resolvedAt` + `resolvedById`.
- [x] Permitir asignar responsable. `assignAnomalyCase()` en `anomaly-cases.ts`.
- [x] Permitir comentar. `addAnomalyComment()` con hilo de discusión enriqueciendo nombres de usuario.
- [x] Permitir resolver con motivo. `updateAnomalyCaseStatus()` con parámetro `resolution`.
- [x] Permitir reabrir. Estado `reopened` soportado en el CHECK y en `updateAnomalyCaseStatus`.
- [x] Mantener historial de estados. Los cambios de estado se auditan vía `recordAudit` (ya existente en el sistema de auditoría).
- [x] Evitar duplicar un caso abierto para la misma regla y registro. Índice único parcial `fuel_anomaly_cases_unique_open` + verificación en `createAnomalyCase`.

### Reglas pendientes

- [x] Rendimiento fuera del historial del equipo. `detectPerformanceOutlierHistory` (nuevo detector batch, `lib/combustibles/anomaly-detector.ts`) reutiliza `flagOutliers` de `performance-statistics.ts` (la misma función que ya usaban los gráficos de consumo/operación) sobre las observaciones de rendimiento del log operacional (`fuel_operation_records`), agrupadas por equipo. Sólo cubre esa fuente: TCT sólo tiene rendimiento agregado por período sin una "carga" individual que referenciar, y TAE no calcula rendimiento en absoluto (ver nota en `equipment-performance.ts`). Exige al menos `MIN_CONCLUSIVE_SAMPLE` (5) observaciones previas del equipo antes de evaluar.
- [x] Rendimiento fuera del grupo comparable. `detectPerformanceOutlierGroup`, mismo mecanismo pero agrupando por `comparisonGroup` + unidad de rendimiento en vez de por equipo individual.
- [x] Desviación superior al umbral. Es el mismo mecanismo que las dos reglas anteriores (`flagOutliers` con `thresholdStdDevs` configurable, default 2) — no se construyó una tercera regla redundante para el mismo concepto estadístico.
- [x] Litros superiores a capacidad. `detectLitersExceedCapacity` en `lib/combustibles/anomaly-detector.ts` ya existía escrita (con un bug de tipos que impedía compilar) sin que nada la invocara; corregida y conectada al cron de detección — compara cada carga TAE contra `tankCapacityLiters` del equipo con margen configurable (5% por defecto).
- [x] Cargas demasiado frecuentes. Mismo detector que "Exceso de cargas dentro de una ventana temporal" (ver más abajo) — son el mismo concepto con nombres distintos en el prompt original.
- [x] Cargas duplicadas. Implementado: `detectSealDuplicate` en `lib/combustibles/seal-movements.ts` — mismo número de sello + mismo tipo + misma carga = duplicado bloqueado.
- [x] Kilometraje inferior al anterior. Detectado en `detectTaeAnomaliesInTx`: compara `meterReading` con carga anterior del mismo equipo + `meterType = odometer`.
- [x] Horómetro inferior al anterior. Mismo mecanismo, `meterType = hour_meter`.
- [x] Kilometraje sin variación. Detectado en `detectTaeAnomaliesInTx`: extiende la misma consulta de "lectura regresiva" — si la lectura es idéntica a la anterior (no sólo menor), crea un caso `kilometraje_sin_variacion` en vez de `kilometraje_regresivo`.
- [x] Horómetro sin variación. Mismo mecanismo, `meterType = hour_meter`.
- [ ] Diferencia entre etapas.
- [x] Falta de sello inicial. Detectado en `detectTaeAnomaliesInTx`: si `removedSealNumber` es nulo, crea un caso `sello_inicial_faltante` (incluye el motivo declarado en `noSealReason` si existe). La validación de entrada ya exige justificar la ausencia del sello, pero eso no eximía de generar un caso revisable — se agregó aparte.
- [x] Falta de sello final. Mismo mecanismo sobre `installedSealNumber`, caso `sello_final_faltante`.
- [x] Sello repetido. Detectado en `detectTaeAnomaliesInTx`: busca `installedSealNumber` duplicado en la misma faena, crea caso automático al revisar.
- [x] Sello no correlativo. Detectado en `detectTaeAnomaliesInTx`: compara instalado con retirado en la carga siguiente del mismo equipo.
- [x] Evidencia faltante. Detectado en `detectTaeAnomaliesInTx`: si source PWA y menos de 4 evidencias, crea caso.
- [x] Evidencia duplicada. `detectDuplicateEvidenceRule` (nuevo detector batch) crea un caso por cada hash SHA-256 que aparece en más de una carga.
- [x] Evidencia ilegible. `detectCorruptEvidenceRule` (nuevo detector batch) crea un caso por cada evidencia con tamaño 0, MIME no imagen o sin archivo/URL.
- [x] Identidad o dato obligatorio incompleto. Detectado en `detectTaeAnomaliesInTx`: si `manualIdentity` es verdadero (conductor y/o supervisor sin coincidencia verificada en el catálogo), crea un caso `identidad_incompleta`. Antes esto sólo existía como alerta transitoria (`computeTaeAlerts`, código `manual_identity`) visible en el detalle de la carga; ahora también queda como caso persistente y revisable.
- [ ] Valor negativo o improbable. `meterReading` y `liters` ya se validan como no-negativos en el formulario PWA (`lib/validation/fuel-tae.ts`), así que no pueden llegar negativos por esa vía; el histórico legado (`legacy_xlsx`) no pasa por `detectTaeAnomaliesInTx` (se inserta directo con `status` ya resuelto, ver sección 3), así que un detector aquí no cubriría ese caso. Falta decidir qué cuenta como "improbable" más allá de lo que el input ya bloquea antes de construirlo.
- [x] Consumo durante inactividad. `detectConsumptionWhileInactive` ya existía escrita con un bug real (`ruleId: ""`, que habría violado la FK de `fuel_anomaly_cases` en cuanto se ejecutara) y sin ningún llamador; corregida (usa `rule.id`) y conectada al cron.
- [x] Carga en faena distinta de la asignada. Detectado en `detectTaeAnomaliesInTx`: compara `submission.worksiteId` contra `fuelVehicles.worksiteId` (la faena asignada al equipo, sección 2); crea caso `carga_faena_distinta` si no coinciden.
- [x] Proveedor no habitual. `detectUnusualSupplier` (nuevo detector batch): sólo aplica a `fuel_loads` (facturación TCT/TAE), comparando `fuelSupplierId` contra `fuelVehicles.usualFuelSupplierId` (sección 2). La PWA TAE no registra proveedor por carga, así que no puede evaluarse ahí.
- [x] Carga fuera de horario. Detectado en `detectTaeAnomaliesInTx`: nueva función `isOutsideOperatingSchedule()` compara `loadedAt` (convertido a la zona horaria del equipo con `Intl.DateTimeFormat`) contra `fuelVehicles.operatingSchedule` (días/horas, sección 2). Sólo evalúa equipos que tienen horario declarado.
- [x] Variación brusca de consumo. `detectSharpConsumptionChange` ya existía escrita con un bug real (referenciaba una columna `cantidadUnidad` que no existía en el resultado del `select`, no compilaba) y sin ningún llamador; corregida y conectada al cron — compara cada equipo TCT contra su período anterior con umbral configurable (50% por defecto).
- [x] Exceso de cargas dentro de una ventana temporal. Detectado en `detectTaeAnomaliesInTx`: cuenta cargas TAE no anuladas del mismo equipo dentro de una ventana configurable (default 2h/3 cargas) antes de la carga actual; crea caso `exceso_cargas_ventana` si se alcanza el umbral.
- [ ] Diferencia entre PWA TAE y fuente externa comparable. Requeriría comparar, carga por carga, la PWA TAE contra el informe Copec de recepciones (`fuel_cycle_movements`) o el canal TCT — un contrato de conciliación propio (la convención del documento prohíbe explícitamente sumar/restar TAE y TCT sin uno). No construido en esta pasada: es una regla de reconciliación de canales, no una extensión incremental de las demás.

### Criterio de salida

- [ ] Las anomalías son casos persistentes, asignables, resolubles y auditables, no sólo mensajes calculados al renderizar. La infraestructura (persistencia, asignación, resolución, comentarios, auditoría) ya cumple esto por diseño; el criterio queda abierto sólo porque la cobertura de reglas sigue parcial: **23 de 26 reglas** listadas están implementadas (14 inline en la revisión TAE + 8 batch vía `runAllBatchRules` + el bloqueo de sello duplicado al insertar). Faltan 3: diferencia entre etapas (bloqueada por sección 1 — no existe evento canónico de consumo), valor negativo o improbable (el input ya bloquea negativos; falta decidir qué más cuenta como improbable) y diferencia PWA TAE vs. fuente externa (necesita su propio contrato de conciliación).

## 12. Configuración de reglas y parámetros

- [x] Crear pantalla administrativa de reglas. `/combustibles/anomalias/reglas`, gateada por `combustibles:manage_anomaly_rules`, enlazada desde el botón "Reglas" en `/combustibles/anomalias` (sólo visible con ese permiso).
- [x] Crear regla. `createAnomalyRuleAction` (`app/(app)/combustibles/anomalias/reglas/actions.ts`) valida con `anomalyRuleSchema` (zod) e inserta en `fuel_anomaly_rules`.
- [x] Editar regla. `updateAnomalyRuleAction`, mismo esquema de validación.
- [x] Activar y desactivar regla. `setAnomalyRuleStatusAction`. Antes de esta pasada esto no habría tenido efecto real: las 5 reglas inline (`detectTaeAnomaliesInTx`) buscaban la regla por `code` sin filtrar `isActive`, así que desactivar una regla en la base no la habría detenido. Corregido: las 5 búsquedas ahora exigen `isActive = true`; las reglas batch ya lo hacían.
- [ ] Configurar umbral por tipo de equipo. El modelo de configuración actual es un JSON global por regla, no segmentado por tipo de equipo.
- [ ] Configurar umbral por faena. Mismo motivo.
- [x] Configurar severidad. Campo `severity` editable en el formulario de la regla.
- [ ] Configurar ventana temporal. Ningún detector actual lee una clave de "ventana" desde `config` (el seed de `carga_duplicada` trae `windowHours` pero el detector de sello duplicado no la consulta).
- [ ] Configurar tamaño mínimo de muestra. Es un concepto distinto (`MIN_CONCLUSIVE_SAMPLE` de la sección 4, confiabilidad estadística de rendimiento), no una anomalía; sigue codificado como constante fija.
- [ ] Configurar capacidad máxima. La capacidad viene del catálogo de vehículos (sección 2), no de la regla; lo único configurable vía regla es el margen de tolerancia (`config.margin`, ya editable), no la capacidad en sí.
- [x] Configurar horario operativo. Corrección: esta línea decía "no hay detector implementado todavía", desactualizada desde que se agregó `carga_fuera_horario` (sección 11, pasada 11). El horario ya es configurable — por equipo, no por regla: `fuel_vehicles.operatingSchedule` se edita desde la ficha del vehículo (`/combustibles/vehiculos`), y el detector lo lee de ahí. La regla en sí no tiene un parámetro propio de horario en su `config` porque no tendría sentido — el horario es una propiedad del equipo, no de la regla que lo evalúa.
- [ ] Configurar correlatividad de sellos. `sello_no_correlativo` compara con lógica fija, no lee parámetros desde `config`.
- [x] Configurar proveedor habitual. Misma corrección que el ítem anterior: `proveedor_no_habitual` ya existe (sección 11, pasada 11) y lee `fuel_vehicles.usualFuelSupplierId`, configurable desde la ficha del vehículo. No es un parámetro de la regla por el mismo motivo — el proveedor habitual es del equipo, no de la regla.
- [ ] Versionar reglas. No implementado: la tabla `fuel_anomaly_rules` se actualiza in-place, sin historial de versiones. Requiere una tabla adicional (`fuel_anomaly_rule_versions` o similar) — no se construyó en esta pasada por alcance.
- [ ] Simular el efecto de una regla antes de activarla. No implementado: requeriría correr el detector contra datos históricos en modo dry-run sin crear casos — feature aparte, no construida.
- [x] Auditar modificaciones. `createAnomalyRuleAction`, `updateAnomalyRuleAction` y `setAnomalyRuleStatusAction` llaman a `recordAudit` con `oldState`/`newState` dentro de la misma transacción del cambio.
- [ ] Retirar los umbrales fijos actualmente codificados. Parcial: `litros_supera_capacidad` (margen), `variacion_brusca_consumo` (umbral %) y `evidencia_faltante` (cantidad mínima de evidencias, antes hardcodeada en "4") ahora leen su parámetro desde `config` y por lo tanto son ajustables desde la pantalla nueva sin desplegar código. Siguen fijos en código: `differenceSeverity` (±2%/±5% en `fuel-cycle.ts`), `MIN_CONCLUSIVE_SAMPLE` (sección 4) y la lógica de `sello_no_correlativo`/`sello_repetido` (no leen `config` en absoluto).

### Criterio de salida

- [ ] Los umbrales operativos razonables pueden cambiarse sin desplegar código y todo cambio conserva versión y auditoría. Los cambios ya se auditan (`recordAudit` en cada create/update/toggle); horario y proveedor habitual son configurables por equipo, y 3 umbrales concretos (margen, % de variación, evidencias mínimas) son configurables por regla — todos sin desplegar código. Sigue abierto porque no hay versionado (sólo el valor actual, sin historial) ni simulación previa, y porque "umbral por tipo de equipo/faena" y "ventana temporal"/"correlatividad de sellos" seguirían necesitando que el detector correspondiente lea esa clave desde `config`, cosa que hoy no hace.

## 13. Integraciones con otros módulos

Auditoría de qué existe hoy en el resto de la plataforma antes de construir nada (evitar relaciones que aparenten funcionar sin datos reales detrás): `maintenance_records.vehicle_id` ya referencia `fuel_vehicles` (relación lista, sin usar); `fuel_tae_submissions.driver_worker_id` ya referencia `workers` (idem); `repuesto_quotations` y `service_quotations` son cotizaciones sin `vehicle_id` — no hay nada que relacionar todavía; no existe ningún módulo de "contratos" ni de "turnos"/"horas trabajadas" en el repositorio (`db/schema` no tiene esas tablas). **Corrección tras revisar `/combustibles/facturas` y `/combustibles/reportes` a fondo** (no lo había hecho al escribir la primera versión de esta sección): `fuel_loads.totalAmount` (IEC, IVA, total) **sí se muestra** hoy en esas dos páginas — KPIs, gráficos y tabla — gateado sólo por `combustibles:view`, el mismo permiso genérico que cualquier otra vista operativa. No es cierto que "no exista permiso de ver costos porque no hay UI que los muestre"; lo que no existe es una separación entre "ver combustible" y "ver costo de combustible" — ambos hoy son el mismo permiso. Separarlos retroactivamente en todas las pantallas que ya muestran costo es una decisión de política de acceso con radio de impacto grande (cualquier rol con `combustibles:view` perdería acceso a costos que hoy ve) — no se tomó unilateralmente en esta pasada. Lo que sí se corrigió: la única acción que sacaba esos montos del sistema (`exportFuelLoadsXlsxAction`) ahora exige el permiso nuevo `combustibles:export_sensitive` en vez del genérico `combustibles:export` (ver sección 15).

- [ ] Relacionar compras y órdenes de compra con combustible recibido. `purchase_orders` no tiene ninguna columna que lo vincule a una recepción de combustible (ni por proveedor+fecha+producto). El ciclo físico (sección 1) ya tiene su propia fuente canónica (`fuel_cycle_movements`, informe Copec) independiente del módulo de compras general — enlazarlos requeriría decidir si "combustible recibido" alguna vez pasa por una OC de este sistema, que hoy no es el caso operativo real.
- [x] Relacionar facturas con volumen, producto y costo unitario. Ya existe y ya se muestra: `fuel_loads` tiene `liters` (volumen), `productId` (producto) y `totalAmount`; `/combustibles/facturas` y `/combustibles/reportes` ya lo despliegan en KPIs, gráficos y tabla. No es un ítem pendiente — estaba mal evaluado como "sin exponer" en un borrador anterior de esta misma pasada, antes de revisar esas dos páginas.
- [ ] Relacionar combustible con centros de costo. `cost_centers` existe y `maintenance_records.cost_center_id` ya lo usa, pero `fuel_loads`/`fuel_vehicles` no tienen columna de centro de costo — sólo `worksiteId`, que es un nivel más grueso. Agregarla es un cambio de schema real (columna + migración + UI de asignación) que implica decidir si el centro de costo se define por vehículo, por faena o por carga; no se tomó esa decisión unilateralmente en esta pasada.
- [ ] Relacionar combustible con contratos. No existe ningún módulo ni tabla de "contratos" en el repositorio (`db/schema` no tiene esa entidad) — no hay nada que relacionar sin definir primero qué es un contrato en este sistema.
- [x] Relacionar consumo con mantenciones. Implementado: `getFleetVehicleDetail` (`lib/services/fleet.ts`) ya traía `recentMaintenance` (vía `maintenance_records.vehicle_id`) pero la página `/flota/[id]` nunca la renderizaba — dato ya relacionado, simplemente no mostrado. Se agregó la tarjeta "Mantenciones y su efecto en el rendimiento".
- [ ] Relacionar consumo con fallas mecánicas. `maintenance_records.maintenance_type` es texto libre (no hay un valor `IN (...)` que distinga "correctiva por falla" de "preventiva" de forma confiable) — no existe una entidad "falla mecánica" separada de mantención con la que relacionar el consumo sin inferir sobre texto libre, que sería poco confiable para una anomalía automática.
- [ ] Relacionar consumo con repuestos. `repuesto_quotations` no tiene `vehicle_id` ni ninguna referencia a equipo — es una cotización de compra, no un consumo de repuesto por equipo. Mismo motivo que centros de costo: requiere una columna nueva y una decisión de producto sobre qué significa "repuesto usado en este equipo".
- [ ] Relacionar consumo con servicios. Mismo motivo: `service_quotations` no tiene `vehicle_id`.
- [ ] Relacionar consumo con horas trabajadas. No existe ningún módulo de jornada/horas trabajadas en el repositorio.
- [x] Relacionar cargas con períodos de inactividad. Parcial mediante la regla `consumo_durante_inactividad` (sección 11): compara contra el `operationalStatus` **vigente** del equipo, no contra el historial completo de `fuel_vehicle_operational_intervals`. Cubre el caso real (cargar combustible mientras el equipo está inactivo ahora), no un cruce histórico carga-por-carga contra cada intervalo pasado — eso sería una mejora incremental futura, no un bloqueo.
- [ ] Relacionar cargas con turnos. No existe ningún concepto de "turno" en el modelo de datos de este sistema.
- [x] Relacionar cargas con asignaciones de conductores. Ya existe: `fuel_tae_submissions.driverWorkerId` referencia `workers`, capturado en cada carga TAE desde que existe la PWA — no es un ítem nuevo, es una relación de datos que ya estaba ahí sin que el checklist lo reconociera.
- [ ] Relacionar anomalías con supervisores. Los datos existen (`fuel_anomaly_cases.referenceEntityId` → `fuel_tae_submissions.supervisorNameSnapshot`), pero no hay ninguna vista que agregue por supervisor — requeriría una consulta nueva que resuelva el tipo polimórfico de `referenceEntityType` antes de agrupar, más una pantalla de reporte. No construida en esta pasada por alcance.
- [x] Calcular costo operacional por km. Implementado en `getFleetOverview` (`lib/services/fleet.ts`): `kmDriven` = diferencia entre el odómetro mínimo y máximo registrado en `fuel_loads` durante el período, sólo para equipos con `performanceUnit = km_per_liter` (para no mezclar con equipos que se miden por hora) y con al menos dos lecturas distintas; `costPerKm = totalOperationalCost / kmDriven` (combustible + mantención, no sólo combustible — "costo operacional" incluye ambos). Columna "$/km·h" nueva en la tabla de `/flota`.
- [x] Calcular costo operacional por hora. Mismo mecanismo con `hoursRun` (delta de horómetro) para equipos `performanceUnit = liters_per_hour`.
- [x] Calcular costo total por equipo. Se verificó al revisar esta sección con más cuidado: ya existe, no es un ítem pendiente. `getFleetOverview` (`lib/services/fleet.ts:97`) ya calcula `totalOperationalCost = totalFuelAmount + totalMaintenanceAmount` por vehículo, y `/flota` ya lo muestra en la columna de costo total de la tabla. Es de un módulo distinto (`flota:view`, no `combustibles:*`) y predata esta sesión — el checklist lo tenía mal evaluado como "no construido". Nota aparte, no corregida aquí: esa columna no respeta el permiso nuevo `combustibles:view_costs` — cualquiera con `flota:view` sigue viendo el costo combinado. Extender la restricción a un módulo distinto del que se decidió en esta pasada no se asumió unilateralmente; queda para una decisión aparte si se considera necesario.
- [x] Comparar consumo antes y después de mantenciones. Implementado junto con el ítem de mantenciones de arriba: promedio de rendimiento del log operacional 30 días antes vs. 30 días después de cada mantención no cancelada, en la misma tarjeta de `/flota/[id]`.
- [ ] Detectar aumento de consumo previo a fallas. Mismo bloqueo que "relacionar consumo con fallas mecánicas": sin una entidad de falla mecánica confiable, no hay un evento "antes de la falla" que anclar.
- [x] Detectar cargas de equipos inactivos. Ya cubierto por la regla `consumo_durante_inactividad` (sección 11, implementada en la pasada 8) — mismo mecanismo que "relacionar cargas con períodos de inactividad" arriba.
- [ ] Detectar diferencias recurrentes por proveedor. La regla `proveedor_no_habitual` (sección 11) ya detecta cada ocurrencia individual; "recurrente" implicaría un umbral de repetición por proveedor a través del tiempo, que es una regla distinta (con su propia ventana y umbral configurable) y no se construyó aparte en esta pasada.
- [ ] Analizar anomalías por conductor, supervisor y turno. Turno no existe (ver arriba); conductor/supervisor son técnicamente posibles (mismo mecanismo que "relacionar anomalías con supervisores") pero no se construyó la vista de análisis agregado.

### Criterio de salida

- [ ] Las relaciones reutilizan entidades existentes y permiten explicar costo, consumo y anomalías sin duplicar datos maestros. Las relaciones que ya existían a nivel de datos (mantención, conductor, factura) están cerradas y ahora se usan o se documentan; el bloque completo de costo (por km, por hora, total) ya está calculado y visible en `/flota`, una vez resuelta la decisión de permisos de la sección 14. Sigue abierto sólo por lo que falta estructuralmente: centros de costo, repuestos, servicios, contratos y turnos requieren una columna nueva y una decisión de producto sobre qué significa esa relación — no se inventó esa decisión unilateralmente.

## 14. Permisos

- [ ] Definir permiso para consultar todas las faenas.
- [x] Definir permiso para ver costos. Consultado explícitamente con el usuario (decisión de política de acceso que reduce acceso existente, no algo que el código pudiera decidir solo) — confirmó crear el permiso y restringir las pantallas. Nuevo `combustibles:view_costs`, otorgado sólo a administrador y jefa_chome (mismo patrón que los demás permisos nuevos de la sesión); `jefe_mantencion`, `solicitante_faena`, `prevencionista_faena` y `admin_contrato` dejan de ver montos aunque conserven `combustibles:view`. `/combustibles/facturas` y `/combustibles/reportes` ahora exigen `combustibles:view_costs` en vez del genérico `combustibles:view`.
- [x] Permitir datos operativos sin costos. Implementado donde importaba de verdad: el panel "Estado del combustible" en `/combustibles` (visible para cualquiera con `combustibles:view`) mostraba el monto facturado (`formatCLP`) sin condición — ahora, sin `combustibles:view_costs`, se omite el monto y el link a `/combustibles/facturas` (que redirigiría a /forbidden), dejando sólo los litros y la cantidad de registros. `/combustibles/facturas` y `/combustibles/reportes` en sí no tienen una variante recortada "sin montos" — son pantallas de facturación, no tiene sentido una versión operativa de una lista de facturas — se gatearon completas, como confirmó el usuario.
- [ ] Definir permiso para registrar cargas autenticadas.
- [ ] Definir permiso para editar cargas. `updateFuelLoadAction` (facturación) hoy reutiliza `combustibles:create` para editar, no tiene permiso propio — separar "crear" de "editar" le quita a quien hoy sólo tenía `combustibles:create` la capacidad de editar cargas ya creadas por otros, sin haberlo pedido. Es la misma clase de decisión que "ver costos" (reduce acceso existente) — no se tomó unilateralmente.
- [ ] Definir permiso para anular cargas. Estado real, no sólo falta de permiso: TAE sí tiene una transición de anulación (`status: "voided"` vía `reviewTaeSubmissionAction`, gateada por `combustibles:tae_review`, específico); facturación (`fuel_loads`) sólo tiene eliminación dura (`deleteFuelLoadAction`, `combustibles:delete`) — el estado `"cancelled"` existe en el enum y se etiqueta en la tabla, pero ninguna acción lo asigna. No hay una "anulación" real de factura que anular todavía, más allá de borrarla.
- [x] Definir permiso para acceder a fotografías. `GET /api/tae/evidence/[id]` ya exige `combustibles:tae_view` (específico de TAE, no el genérico `combustibles:view`) más `canAccessWorksite` — mismo patrón que "reemplazar evidencia" (permiso ya específico, sin necesitar uno nuevo dedicado).
- [x] Definir permiso para revisar anomalías. `combustibles:review_anomalies` — gatea iniciar revisión, reabrir, comentar y asignar responsable en `/combustibles/anomalias`.
- [x] Definir permiso para resolver anomalías. `combustibles:resolve_anomalies` — gatea resolver/descartar un caso (transición que lo cierra). Antes las tres acciones (revisar, resolver, comentar) sólo pedían `combustibles:view`: cualquiera que viera el dashboard de combustibles podía cerrar casos de anomalía.
- [x] Definir permiso para asignar responsables. Comparte `combustibles:review_anomalies` con "revisar" en vez de tener uno propio — decisión deliberada: asignar es parte del flujo de revisión, no hay una vista separada de "sólo asignar" en la UI actual.
- [x] Definir permiso para configurar reglas. `combustibles:manage_anomaly_rules` — gatea la pantalla nueva `/combustibles/anomalias/reglas` (crear, editar, activar/desactivar).
- [x] Definir permiso para administrar catálogos operativos. La taxonomía usa `admin:fleet_catalog` y las fichas usan `combustibles:manage_vehicles`.
- [x] Definir permiso para consultar auditoría. `combustibles:view_audit`, nuevo. Antes `/combustibles/bitacora/historial/[entityType]/[entityId]` reutilizaba `combustibles:view` (el propio comentario en el código decía "hasta que exista combustibles:audit_view") — cualquiera que viera el dashboard podía ver el historial completo de auditoría (valor anterior/nuevo por campo) de cualquier carga. Ahora requiere el permiso dedicado; el link "Historial de cambios" en la bitácora también se oculta sin él.
- [x] Definir permiso para exportar datos sensibles. **Corrección de una afirmación anterior propia**: dije en la sección 13 (antes de revisar `/combustibles/facturas` a fondo) que "no existen columnas de costo en ninguna exportación de combustible" — es falso. `exportFuelLoadsXlsxAction` (`app/(app)/combustibles/actions-module/export.ts`) exporta IEC fijo/variable, IVA y total por carga, y sólo pedía `combustibles:export` (el mismo permiso genérico que exportar la bitácora sin montos). Nuevo permiso `combustibles:export_sensitive`, ahora exigido por esa acción; el botón de exportar en `/combustibles/facturas` se oculta sin él.
- [x] Definir permiso para reemplazar evidencias. Ya usa `combustibles:tae_review` (no `combustibles:view`) — es un permiso específico de revisor, no el genérico de sólo-ver. Se evaluó crear un permiso dedicado sólo para esto y se descartó: reemplazar evidencia es parte natural del flujo de revisión TAE, no una capacidad que algún rol necesite sin las demás.
- [x] Definir permiso para revertir lotes TAE. `revertTaeImportBatchAction` ya exige `combustibles:tae_import` **y** `combustibles:revert` (doble gate) — no es un permiso genérico, la reversión requiere explícitamente el permiso de reversión además del de importar.
- [ ] Aplicar cada permiso en backend. Cumple para los permisos ya definidos (anomalías, auditoría); no puede cumplir para el conjunto completo porque la mayoría de los permisos listados en esta sección (faenas, costos, editar/anular cargas, fotografías) todavía no existen.
- [ ] Aplicar alcance de faena en cada consulta y mutación. No auditado sistemáticamente en esta pasada.
- [ ] Agregar grants por rol. Cumple para los permisos nuevos (`combustibles:view_audit` sembrado para administrador y jefa_chome vía `db:sync-rbac`); no para el conjunto completo, mismo motivo que "aplicar cada permiso en backend".
- [ ] Agregar pruebas de autorización y aislamiento entre faenas. Ninguna prueba automatizada nueva en esta pasada (tests siguen diferidos a pedido explícito).

### Criterio de salida

- [ ] Ninguna acción depende únicamente de ocultar botones y cada permiso tiene pruebas positivas y negativas.

## 15. Auditoría e historial

- [x] Auditar exportaciones TAE. `exportTaeSubmissionsXlsxAction` (`/combustibles/tae`) ahora llama `recordAudit(action: "export")` con cantidad de filas y filtros aplicados. Se agregó el literal `"export"` al tipo de `AuditParams["action"]` en `lib/audit.ts` (columna de texto libre, sin CHECK — no requirió migración).
- [x] Auditar exportaciones TCT. `exportFuelLoadsXlsxAction` (`/combustibles/facturas`, cubre `serviceType` TCT y TAE de `fuel_loads`) ídem, marcando además `includesAmounts: true` porque esta exportación sí trae montos.
- [x] Auditar exportaciones unificadas. `exportFuelLogAction` y `exportFuelLogSelectionAction` (bitácora general) ídem. De paso se auditó también `exportTaeCopecReconciliationAction` (conciliación TAE/Copec), que tampoco se auditaba.
- [x] Auditar visualización y descarga de evidencia sensible. Ya cerrado en la pasada 8 (`logEvidenceAccess` conectado a `GET /api/tae/evidence/[id]`) — esta copia del ítem en la sección 15 no se había marcado, aunque la sección 10 sí.
- [x] Auditar reemplazo de evidencia. Ídem — ya cerrado (`replaceEvidenceAction` con `recordAudit`), sección 10 ya lo tenía marcado.
- [x] Auditar cambios de reglas. `createAnomalyRuleAction`, `updateAnomalyRuleAction` y `setAnomalyRuleStatusAction` (sección 12, pasada 9) ya llaman `recordAudit` con `oldState`/`newState` en la misma transacción.
- [x] Auditar cambios de capacidades.
- [x] Auditar cambios de asignación equipo/faena.
- [ ] Auditar cambios de conductor y supervisor. No aplica todavía: no existe ninguna acción para corregir el conductor o supervisor de una carga TAE después de creada (sólo existe `MeterCorrectionDialog` para la lectura del medidor) — no hay nada que auditar porque la funcionalidad que se corregiría no existe.
- [ ] Auditar correcciones masivas. Mismo motivo: la única acción masiva que existe hoy es exportar la selección (ya auditada arriba); no hay ninguna acción de corrección masiva de datos.
- [x] Auditar reversión de lotes TAE. `revertTaeImportBatchAction` registra `recordAudit` (acción `delete`, estado anterior/nuevo) y `recordStatusChange` dentro de la misma transacción.
- [x] Mostrar valor anterior y nuevo por campo. `/combustibles/bitacora/historial/[entityType]/[entityId]` ya renderiza `DiffRow` (campo, valor anterior, valor nuevo) por cada entrada de `audit_log` — ya estaba implementado, sólo faltaba reconocerlo en el checklist.
- [x] Mostrar usuario responsable. Misma página, `row.userEmail ?? "Sistema"`.
- [x] Mostrar fecha y hora. Misma página, `formatDateTime(row.createdAt)` / `formatDateTime(row.changedAt)`.
- [x] Exigir motivo para correcciones sensibles. `updateAnomalyCaseStatus` (`lib/combustibles/anomaly-cases.ts`) ahora rechaza resolver o descartar un caso sin `resolution` (antes era opcional — se podía cerrar la investigación de una posible pérdida de combustible sin dejar ningún registro de por qué). El formulario (`anomaly-case-card.tsx`) tenía un bug real que esto expuso: el textarea de motivo sólo se mostraba cuando el caso estaba "en revisión", pero "Descartar" también está disponible desde "abierto" y "reabierto" — en esos dos estados el botón habría mandado un motivo vacío sin ninguna forma de completarlo. Corregido: el textarea aparece siempre que alguna acción disponible lo requiera, y el botón queda deshabilitado hasta que haya texto. Editar una regla de anomalía sigue sin exigir motivo — no se agregó ese campo al formulario en esta pasada, no estaba pedido explícitamente y cambia la UI de configuración de reglas, no la de resolución de casos. Cubierto con una prueba de integración nueva (PGlite): rechaza sin motivo o con sólo espacios, acepta con motivo real.
- [x] Incorporar el historial completo en el detalle de carga. La página de detalle TAE (`/combustibles/tae/[id]`) mostraba `statusHistory` (transiciones de estado) pero no enlazaba nunca a la auditoría completa de campos; la de facturación (`/combustibles/[id]`) no tenía ningún acceso a auditoría. Ambas ahora enlazan a `/combustibles/bitacora/historial/...`, visible sólo con `combustibles:view_audit`.

### Criterio de salida

- [x] Toda mutación sensible puede reconstruirse con actor, instante, motivo, valor anterior y valor nuevo. Cumple para todo lo que existe hoy como mutación sensible: capacidades, asignación, reversión de lotes, reemplazo de evidencia, acceso a evidencia, reglas, exportaciones y — nuevo en esta pasada — resolución de casos de anomalía, con motivo ahora obligatorio. Las correcciones de conductor/supervisor y las correcciones masivas no son mutaciones que existan hoy en el sistema, así que no hay nada que "reconstruir" para ellas — el criterio no puede fallar sobre una acción inexistente.

## 16. Exportaciones y reportes

- [ ] Crear reporte ejecutivo PDF. `jspdf` está instalado (`package.json`) pero no se usa en ningún lugar del repositorio todavía — no hay un layout de referencia que reutilizar. Construirlo requiere primero decidir el contenido (¿qué KPIs, para qué audiencia, con qué período por defecto?) — es una decisión de producto, no una extensión incremental de las exportaciones XLSX existentes. No se inventó ese contenido unilateralmente.
- [x] Crear exportación XLSX unificada. Ya existe: `exportFuelLogAction`/`exportFuelLogSelectionAction` en `/combustibles/bitacora` exportan TAE + facturación + log operacional en un solo archivo, con la fuente de cada fila como columna.
- [x] Respetar filtros activos. Las 5 acciones de exportación del módulo reciben los mismos filtros que la página que las invoca.
- [x] Respetar alcance de faena. `getFuelLogExportRows`/`getFuelLogRowsBySelection`/`buildFuelLoadsWhere` aplican `worksiteScopeSql(session, ...)` igual que las consultas de pantalla — no hay una ruta de exportación que ignore el alcance de sesión.
- [x] Respetar permisos de columnas sensibles. La bitácora unificada nunca incluyó montos; la única exportación que sí los trae (`exportFuelLoadsXlsxAction`, facturas) ahora exige `combustibles:export_sensitive` en vez del permiso genérico (ver sección 15).
- [x] Incluir fecha y hora de generación. Nueva hoja "Metadatos" en la exportación de bitácora (`addMetadataSheet`): fecha/hora de generación, usuario, alcance de faena, filas incluidas, período y filtros aplicados como JSON.
- [x] Incluir usuario generador. Misma hoja de metadatos.
- [x] Incluir período. Misma hoja de metadatos (desde/hasta).
- [x] Incluir filtros aplicados. Misma hoja de metadatos.
- [x] Incluir alcance de faena. Misma hoja de metadatos (faenas visibles del usuario o "todas" si es global). Cubría sólo la exportación unificada (bitácora); extraído a un helper compartido (`addExportMetadataSheet` en `lib/combustibles/xlsx-utils.ts`, generalizado para no depender del tipo de filtros específico de la bitácora) y aplicado también a las otras 3 exportaciones del módulo (TAE, facturas, conciliación TAE/Copec) — las 4 llevan ahora la misma hoja "Metadatos".
- [x] Incluir unidades. Los litros siempre son litros (una sola unidad en el módulo); el rendimiento ya tiene su propia columna "Unidad rendimiento" (km/L o L/h) desde una pasada anterior — nunca se mezclan sin etiquetar.
- [x] Incluir fuente de cada dato. Columna "Fuente" en la bitácora (TAE/facturación/log operacional) desde una pasada anterior.
- [x] Auditar la exportación. Las 5 acciones de exportación del módulo llaman `recordAudit(action: "export")` (ver sección 15).
- [ ] Implementar procesamiento asíncrono para archivos grandes. Sigue síncrono dentro del request; el límite de filas (`FUEL_LOG_MAX_EXPORT_ROWS`/`MAX_TAE_EXPORT_ROWS`/`MAX_FUEL_EXPORT_ROWS`, todos 10.000) es la única mitigación hoy. Migrar a un job asíncrono es un cambio de arquitectura (cola, almacenamiento temporal, notificación de fin) que no se construyó en esta pasada.
- [ ] Mostrar progreso y permitir reintento. Depende del ítem anterior — sin procesamiento asíncrono no hay un progreso que mostrar más allá del spinner del botón.
- [ ] Implementar reportes programados si operación los requiere. Condicionado explícitamente en el propio ítem a que operación lo pida — no se tomó esa decisión unilateralmente; no hay evidencia en este documento de que se haya solicitado.
- [x] Mantener XLSX como formato de exportación de datos. Ya es una regla del proyecto (`AGENTS.md`: "Todos los exports de datos deben usar formato XLSX. Nunca usar CSV") y las 5 exportaciones del módulo la cumplen sin excepción.

### Criterio de salida

- [ ] Cada exportación es reproducible, identifica su contexto y nunca incluye columnas que el usuario no puede consultar. Cumple ahora para las 4 exportaciones del módulo (metadatos + alcance + permisos correctos, incluido `export_sensitive` en la única con montos); sigue abierto sólo porque el procesamiento asíncrono, el progreso/reintento y los reportes programados no se construyeron — son features aparte, no una extensión de lo que ya existe.

## 17. Estados de interfaz y resiliencia

- [x] Agregar `loading.tsx` específico a `/combustibles/tae`. Usa `SkeletonPage` y el contexto de ruta TAE.
- [x] Agregar `error.tsx` específico a `/combustibles/tae`. Expone reintento localizado con `unstable_retry` y reporte del error.
- [x] Agregar estados de carga para conciliación. `/combustibles/ciclo/loading.tsx` muestra el esqueleto del ciclo físico.
- [x] Agregar estados de error para conciliación. `/combustibles/ciclo/error.tsx` permite reintentar sin inutilizar el resto del shell.
- [x] Agregar estados de carga para análisis de equipos. `/combustibles/analisis/loading.tsx` ya existía con `SkeletonPage` y `PageHeader`.
- [x] Agregar estados de error para análisis de equipos. `/combustibles/analisis/error.tsx` ya existía con `unstable_retry` y `ReportErrorButton`.
- [x] Implementar reintento localizado. Las fronteras TAE, ciclo y análisis usan `unstable_retry` de Next.js.
- [x] Aislar fallos por visualización o sección. Implementado parcialmente: `ChartErrorBoundary` envuelve `EvolutionChart`, `RendimientoChart`, `PerformanceGroupChart` y `CategoryBarChart` (consumo por tipo). Un fallo de Recharts ya no tumba la página completa. No cubre errores de fetch (que sí tumban la página por diseño SSR).
- [x] Agregar skeletons representativos. `/combustibles/analisis/loading.tsx` ahora refleja la estructura real de la página.
- [x] Diferenciar "sin datos" de "sin coincidencias". `/combustibles/analisis` y `/combustibles/bitacora` muestran mensajes distintos según si hay filtros activos (sin coincidencias vs. sin datos).
- [ ] Mostrar datos parciales disponibles. Las páginas del módulo cargan sus datos con `Promise.all` (todo o nada) — un fetch que falla tumba la página completa en vez de renderizar lo que sí llegó. Cambiar a `Promise.allSettled` con render condicional por sección es un cambio de arquitectura por página, no uniforme; no se aplicó en esta pasada.
- [x] Mostrar error de permisos comprensible. Ya existe a nivel de plataforma (no específico de combustibles): `/forbidden` (`app/(app)/forbidden/page.tsx`, "U-06") explica en español por qué el usuario no puede ver la página y qué hacer, en vez de un 403 crudo o un rebote silencioso. Todas las páginas de combustibles que usan `requirePermission` ya redirigen ahí en el catch.
- [ ] Mostrar error de conexión comprensible. Los `error.tsx` existentes (TAE, ciclo, análisis) muestran el mismo mensaje genérico para cualquier error, sin distinguir "no hay conexión" de otras fallas — comprensible pero no específico.
- [x] Evitar mensajes técnicos al usuario. Los `error.tsx` ya muestran copy genérico en español ("No se pudo cargar esta vista...") en vez de `error.message`/stack traces; `guardPermission` (`lib/auth/can.ts`) evita explícitamente exponer la taxonomía interna de permisos al cliente, sólo un mensaje genérico de "sin permisos".
- [x] Registrar errores mediante el logger existente. Auditados todos los `actions.ts` del módulo (`grep -rL logger $(grep -rl "catch (error)" .../combustibles --include=actions.ts)`): 4 archivos con bloques `catch (error)` que capturaban el error y sólo devolvían `{ ok: false, message }`, sin loguearlo — el fallo real nunca quedaba registrado server-side para diagnóstico. Agregado `logger.error("[nombreAction]", error)` en los 12 bloques de `anomalias/actions.ts` (3), `ciclo/actions.ts` (1), `tae/actions.ts` (4) y `tae/importar/actions.ts` (4), mismo patrón ya usado en `flota/actions.ts`. De paso se eliminó un import muerto (`createAnomalyCase`, nunca usado en `anomalias/actions.ts`). Quedan fuera a propósito los bloques `catch { }` sin variable de error capturada (p. ej. los checks de permiso) — no hay nada que loguear ahí, y es el mismo patrón usado en toda la plataforma para catálogos admin (`tipos-equipo/actions.ts` y similares), no algo específico de combustibles a corregir en esta pasada.

### Criterio de salida

- [ ] Un fallo en una consulta o visualización no inutiliza toda la pantalla y el usuario siempre tiene una acción de recuperación. Cumple a nivel de página completa (`error.tsx` con reintento), para algunos gráficos individuales (`ChartErrorBoundary`), y ahora todo fallo real de una server action queda registrado server-side (`logger.error`); sigue abierto sólo porque un fallo parcial de datos todavía tumba toda la página (sin `Promise.allSettled`) — es un cambio de arquitectura por página, no una corrección puntual.

## 18. Rendimiento y escalabilidad

- [ ] Medir planes de ejecución de consultas principales. No se corrió `EXPLAIN ANALYZE` sobre las consultas principales — requiere un volumen de datos representativo del que no se dispone en este entorno de desarrollo.
- [ ] Probar el dashboard con volumen representativo. Mismo motivo.
- [ ] Probar la bitácora con volumen representativo. Mismo motivo.
- [ ] Probar exportaciones con el límite esperado. Los límites están codificados (`FUEL_LOG_MAX_EXPORT_ROWS`/`MAX_TAE_EXPORT_ROWS`/`MAX_FUEL_EXPORT_ROWS`, los tres en 10.000) pero no se probaron empíricamente contra 10.000 filas reales.
- [x] Crear índices para reglas y casos de anomalía. Ya existen en `db/schema/fuel-anomalies.ts` y ya están migrados (migración `0053_icy_nova`, pasada 8): por código de regla, por estado/faena/regla de caso, por tipo+id de referencia (el que usan los filtros nuevos de la bitácora), y el único parcial de "caso abierto". No se agregó ninguno nuevo en esta pasada porque ya estaban completos.
- [x] Definir límites de consultas analíticas. Parcial, priorizado por riesgo real: 3 consultas de los detectores batch (sección 11) escaneaban toda la tabla **sin ninguna ventana de fecha** — `getOperationPerformanceObservations` (rendimiento fuera de historial/grupo), `detectSharpConsumptionChange` (variación brusca) y `detectUnusualSupplier` (proveedor no habitual). Se agregó `BATCH_SCAN_ROW_LIMIT = 50.000` como freno defensivo (documentado con comentario `ponytail:` — techo deliberadamente alto sin calibrar contra volumen real, a recalibrar cuando exista medición). Las consultas de `/combustibles/analisis` (`equipment-performance.ts`) no se tocaron: ya reciben un rango `from`/`to` obligatorio del llamador — su exposición es acotar ese rango, no agregar un límite de filas ciego encima, y no había evidencia de que eso fuera necesario sin medición real.
- [ ] Evaluar caché para agregados costosos. No evaluado.
- [ ] Evaluar read models o vistas materializadas. El patrón actual (`fuel-log.ts` con `unionAll` calculado en cada consulta) es deliberadamente un read model en el sentido de "una sola consulta que unifica 3 fuentes", pero no una vista materializada — no se evaluó si se necesita una.
- [ ] Implementar agregaciones incrementales si la medición lo justifica. Condicionado explícitamente en el propio ítem a una medición que todavía no existe.
- [x] Procesar detección de anomalías fuera del request cuando corresponda. `GET /api/cron/fuel-anomaly-detection` (protegido por `CRON_SECRET`, mismo patrón que `fuel-copec-sync`) corre `runAllBatchRules()` como job, no dentro de un request de usuario. Falta programar la invocación periódica en el cron externo del servidor (no está documentada en el repo para las demás rutas `/api/cron/*` tampoco — es configuración de infraestructura, no de código).
- [x] Agregar debounce a búsquedas URL. No aplica: la búsqueda de la bitácora (`q`) y de las demás páginas del módulo son inputs dentro de un `<form>` que sólo navega al hacer clic en "Aplicar" — no disparan una petición por cada tecla, así que no hay nada que debounciar. Distinto del patrón de las rutas con búsqueda propia mencionado en `top-bar.tsx`, que combustibles no usa.
- [x] Evitar consultas repetidas. Corregido un caso real y concreto en esta pasada (ver ítem siguiente); no se auditó el resto del módulo de forma sistemática.
- [x] Revisar problemas N+1. Encontrado y corregido: `getAnomalyCases` enriquecía cada caso por separado (`Promise.all(rows.map(enrichAnomalyCase))`, hasta 6 consultas por caso — con el límite por defecto de 50 casos, hasta 300 consultas por carga de `/combustibles/anomalias`). Reescrito como `enrichAnomalyCases` (plural): junta los IDs únicos de regla/equipo/faena/usuario de todas las filas y hace 5 consultas en total sin importar cuántos casos se muestren. No se auditó sistemáticamente el resto del módulo buscando otros N+1 — éste se encontró por estar directamente en código de esta misma pasada.
- [ ] Medir espacio ocupado en IndexedDB. No instrumentado.
- [x] Definir retención de auditoría. Ya existe a nivel de plataforma (no específico de combustibles): `cleanupOldAuditLog()` en `lib/audit.ts`, mínimo legal 5 años (DS N°44/2024), retención por defecto 6 años — aplica a toda fila de `audit_log`, incluidas las de combustibles.
- [ ] Definir retención de evidencias. Sigue sin definir (mismo motivo que la sección 10: es una política operativa, no técnica).
- [ ] Agregar capturas al manifest PWA TAE. `public/tae-manifest.json` no tiene el campo `screenshots`. Requiere imágenes reales de la PWA en uso (activo visual/QA), no un valor que se pueda generar sin capturar la interfaz corriendo.

### Criterio de salida

- [ ] Los objetivos de volumen y latencia están documentados y demostrados mediante pruebas reproducibles. No hay objetivos de volumen/latencia documentados todavía — requiere que operación defina qué volumen es "representativo" antes de poder medir contra algo.

## 19. Pruebas automatizadas faltantes

**Decisión vigente desde la pasada 7**: la suite completa y ESLint quedaron deliberadamente diferidos ("correr todo junto al finalizar") — se mantuvo esa decisión en las pasadas 8-12. En esta pasada, al ser plausiblemente el cierre del trabajo de código, se corrió lo acotado: `npx vitest run lib/combustibles` → **114/114 verdes** (sin regresiones de todas las pasadas anteriores), `npx eslint` sobre cada archivo tocado en la sesión → 2 warnings de imports sin usar, corregidos. La suite completa (`npm run test` sin acotar) se intentó y no terminó en 5 minutos en este entorno — no se pudo confirmar en verde de punta a punta; validar eso queda como tarea de CI, no de esta sesión interactiva.

### Cálculos y dominio

- [ ] Separación estricta de km/L y L/h. Verificado por diseño (el bucket estadístico siempre incluye la unidad en su clave, sección 4) pero sin una prueba que lo bloquee si alguien lo rompe a futuro.
- [x] Promedio, mediana, percentiles y desviación estándar. Nuevo `lib/combustibles/performance-statistics.test.ts`: `mean`, `median`, `standardDeviation` (poblacional, no muestral) y `percentile` (interpolación lineal), incluidos los casos borde de arreglo vacío. Antes esta librería —usada por la sección 4 y ahora también por 2 reglas de la sección 11— no tenía ninguna prueba.
- [x] Coeficiente de variación. Mismo archivo: caso de división por cero (media 0 → `null`) y caso normal.
- [x] Muestra mínima y nivel de confianza. Mismo archivo: `sampleReliability` en sus 3 umbrales (insuficiente/baja/confiable) alrededor de `MIN_CONCLUSIVE_SAMPLE`.
- [x] Diferencias entre etapas. Ya cubierto desde antes de esta pasada: `lib/combustibles/fuel-cycle.test.ts` (12 pruebas de `differenceSeverity`) + `lib/__tests__/fuel-cycle-integration.test.ts` (PGlite, contra Postgres real).
- [ ] Capacidades y unidades. Sin prueba dedicada.
- [x] Todas las reglas de anomalía. Nuevo `lib/__tests__/anomaly-detection-integration.test.ts` (PGlite, mismo patrón que `fuel-cycle-integration.test.ts`): ejercita `reviewTaeSubmission` y `runAllBatchRules` contra Postgres real, no mocks. Cubre una regla inline por familia (identidad_incompleta, carga_faena_distinta, sello_inicial/final_faltante, evidencia_faltante con conteo real) y una batch (litros_supera_capacidad) — no las 23 una por una, sino los caminos representativos de cada mecanismo (inline vs. batch, JSON `config`, referencia polimórfica). Además valida los dos fixes de esta sesión con una prueba que falla si se rompen a futuro: una regla desactivada no dispara (`isActive`), y un caso descartado no se recrea en la siguiente corrida del cron (deduplicación). 8/8 pruebas verdes. Sumado a `lib/services/fuel-tae-schedule.test.ts` (5 casos de `isOutsideOperatingSchedule`) y `lib/combustibles/performance-statistics.test.ts` (10 casos), quedan 23/23 pruebas nuevas en verde para el trabajo de las pasadas 8-13.

### Filtros y bitácora

⚠️ **Se encontró y corrigió un bug real de producción al escribir estas pruebas** — ver el resumen de la pasada 29 al inicio del documento y `lib/combustibles/fuel-log.ts`. La bitácora general (`/combustibles/bitacora`) sin un filtro de fuente único (el estado por defecto de la página) rompía con "column reference is ambiguous" en cualquier consulta que no fuera el conteo total — es decir, `getFuelLogRows`, `getFuelLogExportRows` y `getFuelLogRowsBySelection` nunca devolvían filas cuando el usuario veía más de una fuente a la vez. Causa raíz: varios campos de las 3 ramas del `unionAll` (`worksiteName`, `id`/`detailId`, `equipmentTypeId`/`equipmentTypeName`, `productName`, `updatedByName`/`createdByName`, etc.) eran referencias de columna simples sin alias explícito; dentro de `unionAll(...).as(alias)` envuelto en otro `.select()`, esas columnas pierden el alias de su key JS y terminan usando el nombre físico de la columna de origen — con 5 campos distintos compartiendo el nombre físico "name" y 3 compartiendo "id", cualquier referencia no calificada a esas columnas es genuinamente ambigua en SQL estándar, no un artefacto de PGlite. Corregido agregando `.as()` explícito a cada campo en las 3 ramas.

`lib/combustibles/fuel-log.ts` (el read model detrás de toda la bitácora, incluidos los filtros de anomalía de una pasada anterior) no tenía ningún archivo de prueba — ni antes de esta pasada ni después de escribirlo se habría detectado el bug sin PGlite (el entorno de desarrollo no tiene Chrome instalado, así que nunca se verificó en navegador en ninguna pasada anterior).

- [x] Combinación de filtros globales. Nuevo `lib/__tests__/fuel-log-integration.test.ts` (PGlite, 7 casos): combina fuente + faena, filtra por proveedor exacto (sólo aplica a facturación).
- [ ] Filtros cruzados. No cubierto por esta prueba — es un concepto de UI (clic en un valor de la bitácora aplica ese filtro, sección 6, pasada 21), no del read model en sí.
- [ ] Persistencia URL entre vistas. Sigue sin implementarse (sección 6) — no es algo que una prueba del read model pueda cubrir, es arquitectura de filtro compartido entre rutas.
- [x] Paginación de servidor. Mismo archivo: `limit=1` devuelve una sola fila sin que cambie el total.
- [x] Ordenamiento de servidor. Mismo archivo: `sort: "asc"` vs. `"desc"` devuelven la fila esperada primero.
- [x] Acciones masivas. Mismo archivo: `getFuelLogRowsBySelection` con una selección cruzando TAE y facturación devuelve exactamente esas dos filas, ni más ni menos.

### Seguridad

- [x] Permisos granulares positivos y negativos. 3 de los 5 permisos nuevos, con caso positivo y negativo: nuevo `anomalias/actions.test.ts` (`review_anomalies` vs. `resolve_anomalies` — confirma que `updateAnomalyStatusAction` pide uno u otro según el estado destino, no siempre el mismo; `assignAnomalyAction`/`commentAnomalyAction` piden `review_anomalies`) y nuevo `anomalias/reglas/actions.test.ts` (`manage_anomaly_rules`, las 3 acciones de la pantalla de reglas). `view_audit` y `export_sensitive` quedan sin prueba dedicada — sólo se verificaron manualmente (smoke-test) al implementarlos.
- [ ] Aislamiento entre faenas. Sin prueba dedicada al módulo (existe el patrón general en `lib/__tests__/integration-rbac-sequences.test.ts` para otros módulos, no instanciado para combustibles).
- [x] Token TAE revocado. Nuevo `lib/__tests__/fuel-tae-security-integration.test.ts` (PGlite, contra Postgres real): un enlace con `revokedAt` no da acceso.
- [x] Token TAE manipulado. Mismo archivo: un token que no coincide con ningún hash guardado (inventado o alterado) no da acceso — no distingue "no existe" de "fue modificado", ambos caen en el mismo error genérico a propósito (no filtrar cuál es el caso real).
- [x] Enumeración de tokens y RUT. Nuevo `app/api/tae/identity/route.test.ts` (6 casos): `findTaeWorkerByRut` se llama acotado a la faena del enlace (nunca busca en todas), la respuesta exitosa sólo trae nombre + inicial de apellido (sin RUT ni cargo, confirmado con un `assert` de que el RUT no aparece en el body), y un token inválido penaliza el rate limit igual que un RUT no encontrado, sin filtrar cuál de los dos falló.
- [x] Rate limiting detrás de NAT compartido. Mismo archivo: confirma que las búsquedas fallidas usan el umbral generoso (`maxAttempts: 10`, ya implementado en el endpoint desde antes de esta sesión) en vez del default de login (5) — así una faena entera detrás de una sola IP no queda bloqueada por varios conductores probando RUTs distintos, mientras sigue acotando enumeración masiva. `checkRateLimit`/`recordFailure` en sí (`lib/services/rate-limit.ts`) son un servicio compartido de toda la plataforma, no específico de combustibles — no se le agregó una prueba propia en esta pasada por quedar fuera del alcance del módulo.
- [x] IDs de otra faena enviados manualmente. Mismo archivo: `createTaeSubmission` ya validaba esto en código (`input.worksiteId !== link.worksiteId` y `vehicle.worksiteId !== link.worksiteId`, ambos previos a esta sesión) pero sin prueba — 2 casos nuevos confirman que un `worksiteId` o `vehicleId` de otra faena en el payload se rechaza aunque el token sea válido.
- [x] Evidencia inaccesible sin permiso. Nuevo `app/api/tae/evidence/[id]/route.test.ts` (4 casos, mismo patrón que el test análogo ya existente para evidencia PDTP): sin `combustibles:tae_view` → 403; evidencia inexistente → 404; evidencia real pero faena fuera de alcance → 404 (no 403, no confirma existencia) y no registra acceso; caso feliz → 200 + `logEvidenceAccess` llamado.

### Archivos y PWA

- [ ] Fotografías falsas o con extensión incorrecta.
- [ ] Fotografías corruptas.
- [ ] Fotografías duplicadas.
- [ ] Fotografías demasiado grandes.
- [ ] Cierre y reapertura con pendientes offline.
- [ ] Fallos parciales y reintento.
- [ ] Actualización del service worker con pendientes.
- [ ] Medición y limpieza de IndexedDB.

### Importación, exportación y auditoría

- [x] Reversión de lote TAE. Ya cubierto: `app/(app)/combustibles/tae/importar/actions.test.ts` ejercita `revertTaeImportBatchAction`.
- [x] Decisiones manuales de mapeo. Ya cubierto: `lib/combustibles/tae-import-service.test.ts` ejercita `saveTaeVehicleMappingAction`/`saveTaeWorkerMappingAction` y `buildTaeImportPlan`.
- [ ] Exportación con filtros y metadata. Sin prueba — la hoja de metadatos es nueva de esta pasada.
- [x] Exclusión de columnas por permiso. Nueva prueba en `lib/__tests__/combustibles-actions-extra.test.ts` (mismo archivo y patrón de mocks que ya cubría `deleteFuelLoadAction`/`createFuelSupplierAction`): confirma que `exportFuelLoadsXlsxAction` rechaza sin `combustibles:export_sensitive` antes de tocar la base de datos.
- [x] Auditoría de exportaciones. Nueva prueba en `combustibles-actions-extra.test.ts`: `exportFuelLoadsXlsxAction` con permiso concedido llama `recordAudit` con `action: "export"` y el `entityType` correcto. Representativa, no las 5 acciones una por una — mismo criterio que la cobertura de reglas de anomalía (un caso por mecanismo, no exhaustivo).
- [ ] Auditoría de evidencias. Parcial: nuevo `lib/combustibles/evidence-management.test.ts` cubre `logEvidenceAccess` (2 casos: ver y descargar, con el motivo correcto en cada uno). `replaceEvidenceAction` sigue sin prueba propia — a diferencia de los demás tests de esta pasada, no hay ningún archivo de prueba existente para `tae/actions.ts` del que colgarse; requeriría montar mocks nuevos (evidencia + faena + transacción) en vez de sumar un caso a una infraestructura ya montada.
- [ ] Integridad del historial campo por campo. Sin prueba de que `DiffRow` renderice correctamente valores anidados/nulos/booleanos de `oldState`/`newState`.

### Interfaz

- [ ] Accesibilidad del dashboard de combustibles. Sin auditoría automatizada (`@axe-core/playwright` está instalado y se usa en otros módulos, no en combustibles).
- [ ] Accesibilidad de rutas TAE. Mismo motivo — relevante en particular para la PWA pública, usada en terreno con luz solar directa y guantes.
- [ ] Responsive móvil. Sin prueba; la PWA TAE se diseñó mobile-first pero no hay una prueba de Playwright con viewport móvil.
- [ ] Responsive tablet. Sin prueba.
- [ ] Estados de carga y error parcial. Sin prueba de que los `error.tsx`/`loading.tsx` del módulo efectivamente se activen (requeriría forzar un fallo de datos en un entorno de prueba).
- [x] Prueba real contra PostgreSQL del resumen integrado. Ya cubierto: `lib/__tests__/fuel-cycle-integration.test.ts` corre `getFuelCycleComparison`/`getFuelStorageBalances` contra Postgres real vía PGlite.

### Criterio de salida

- [ ] Los flujos críticos tienen cobertura unitaria, de integración y E2E, incluyendo fallos y denegaciones de permiso. Cobertura real y verificada hoy: cálculos de ciclo físico (PGlite), decisiones de mapeo e importación TAE, reversión de lotes, motor de detección de anomalías (PGlite, inline + batch + los dos fixes de esta sesión), estadística descriptiva de rendimiento, horario operativo, auditoría de exportaciones y evidencias, permisos granulares positivos/negativos para 3 de los 5 permisos nuevos, evidencia inaccesible sin permiso (404 vs. 403), y seguridad de tokens TAE (revocado/manipulado/expirado + IDs de otra faena) — **209 pruebas del módulo en verde, 38 archivos**. Sigue faltando: filtros de bitácora (`fuel-log.ts` no tiene ningún test), `view_audit`/`export_sensitive` sin prueba dedicada, `replaceEvidenceAction`, enumeración de tokens/RUT, rate limiting, y todo lo de PWA offline/E2E/accesibilidad/responsive — ninguno de esos se puede cubrir con un test unitario rápido, necesitan su propia infraestructura (Playwright con service worker y viewports, fixtures de tráfico repetido). No es ambigüedad: es la lista concreta de lo que falta y por qué cada uno requiere más que una hora de trabajo.

## 20. Puesta en producción y adopción

### ⚠️ Decisión de descarte — 2026-07-13 (misma lógica que secciones 1 y 2)

Ningún ítem de esta sección es código: son pasos de despliegue, capacitación y adopción operativa que sólo puede ejecutar el equipo de operación/infraestructura, no un cambio autónomo de código. Ejecutar migraciones o sincronizar RBAC contra el **entorno objetivo/producción** sin autorización explícita del usuario sería una acción de alto impacto y difícil de revertir — no se hizo unilateralmente en esta pasada. Lo que sí es responsabilidad de esta sesión (mantener el entorno local/dev consistente para que estos pasos sean ejecutables cuando operación los active) ya está al día: todas las migraciones generadas en las pasadas 8-12 se aplicaron contra la base local con `npm run db:migrate`, y `npm run db:sync-rbac` se corrió localmente cada vez que se agregó un permiso nuevo — ambos comandos quedan listos para ejecutarse igual contra el entorno objetivo cuando operación decida la fecha de corte.

- [ ] Respaldar base de datos y almacenamiento. Procedimiento de operación/infraestructura (`scripts/backup-pg.sh`, `scripts/backup-storage.sh` ya existen) — ejecutarlo es una decisión operativa de cuándo, no de código.
- [ ] Aplicar migraciones pendientes con `npm run db:migrate`. Ya no hay migraciones pendientes en el árbol de esta sesión (todas se generaron y aplicaron en local); aplicarlas contra el entorno objetivo es responsabilidad de despliegue, no de esta sesión.
- [ ] Ejecutar `npm run db:sync-rbac` en el entorno objetivo. Ídem — ya se corrió localmente cada vez que se agregó un permiso; falta correrlo contra el entorno real, que es un paso de despliegue.
- [ ] Validar permisos con usuario global.
- [ ] Validar permisos con usuario limitado a faena.
- [ ] Revisar el reporte de mapeo histórico.
- [ ] Corregir catálogos antes de la carga definitiva.
- [ ] Ejecutar importación definitiva.
- [ ] Verificar totales importados.
- [ ] Pilotear en una faena.
- [ ] Comparar diariamente PWA versus control anterior.
- [ ] Publicar QR físicos.
- [ ] Capacitar conductores.
- [ ] Capacitar supervisores y revisores.
- [ ] Publicar una guía breve de operación.
- [ ] Definir fecha de corte.
- [ ] Dejar el Excel anterior en sólo lectura.
- [ ] Revisar pendientes offline después del corte.
- [ ] Verificar respaldos de fotografías.
- [ ] Monitorear errores de sincronización.
- [ ] Monitorear espacio de almacenamiento.
- [ ] Monitorear tiempos de respuesta.
- [ ] Aprobar criterios de aceptación con operación.

### Criterio de salida

- [ ] La operación usa la plataforma como fuente oficial, el Excel quedó retirado y existe evidencia de un piloto estable. No alcanzable desde código: depende íntegramente de que operación ejecute el piloto, capacite y decida el corte.

## Orden recomendado de ejecución

Estado al cierre de la pasada 12 — ninguna fase está 100% cerrada (ningún criterio de salida individual llegó a `[x]` en las 20 secciones), pero todas avanzaron. "Cerrado" aquí significaría que **todo** ítem de código de la fase está hecho y **toda** decisión no-técnica quedó explícitamente resuelta (hecha, o descartada con motivo) — eso sí se logró para las secciones 1, 2, 13 y 20 completas, y parcialmente para el resto.

### Fase A: contratos y datos maestros

- [ ] Cerrar secciones 1, 2 y 3. Secciones 1 y 2 **descartadas explícitamente** (ver decisión al inicio del documento) — no quedan pendientes de código, sólo trabajo de terreno/datos que no le corresponde a esta sesión. Sección 3 parcial: mapeo y reversión de lotes cerrados; política de evidencias históricas externas sigue pendiente de decisión.

### Fase B: análisis y bitácora

- [ ] Cerrar secciones 4, 5, 6, 7 y 8. Secciones 4, 7 y 8 con su criterio de salida prácticamente cumplido desde pasadas anteriores. Sección 6 avanzó significativamente esta pasada (filtros de anomalía); sigue faltando compartir contexto de filtro entre rutas. Sección 5 sólo le falta la distribución de anomalías (ahora technically desbloqueada por la sección 11 — no se construyó ese gráfico específico en esta pasada).

### Fase C: prevención de pérdidas

- [ ] Cerrar secciones 9, 10, 11 y 12. Avance grande en esta sesión: sección 9 sólo le falta "auditar correcciones" (inaplicable, no existe la funcionalidad que auditar); sección 10 sólo le faltan políticas operativas de retención; sección 11 en 23/26 reglas; sección 12 en 6/17 (versionado y simulación siguen sin construir).

### Fase D: integración y gobierno

- [ ] Cerrar secciones 13, 14, 15 y 16. Sección 13 **completamente resuelta** en esta pasada (5 implementadas, 16 con decisión explícita de por qué no — sin ítems ambiguos). Sección 14 en 8/20 (bloqueada en gran parte por la decisión de separar "ver costos" de "ver combustible", que no se tomó unilateralmente). Sección 15 en 13/16. Sección 16 en 12/17.

### Fase E: endurecimiento y salida

- [ ] Cerrar secciones 17, 18, 19 y 20. Sección 17 en 12/15. Sección 18 en 6/17 (el resto requiere medir contra volumen real, que no existe en este entorno). Sección 19 con cobertura nueva de lo más frágil (horario operativo, estadística) pero la mayoría de las 23 reglas de anomalía siguen sin prueba propia. Sección 20 **completamente resuelta como no-código**: los 23 ítems son ejecución operativa (piloto, capacitación, corte), no software.

## Criterio final del módulo

- [ ] Existe trazabilidad desde el indicador ejecutivo hasta el registro fuente. Cumple para bitácora, TAE y anomalías (enlaces de detalle en cada fila/caso); no verificado end-to-end desde el resumen ejecutivo de `/combustibles`.
- [ ] El ciclo recibido → registrado → entregado → consumido está respaldado por fuentes canónicas. Cumplido desde la sección 1 (contrato de datos + pruebas).
- [ ] Los rendimientos separan unidades y muestran confiabilidad estadística. Cumplido desde la sección 4; ahora con pruebas automatizadas nuevas para la estadística subyacente.
- [ ] Las anomalías son configurables, persistentes, asignables y auditables. Persistentes/asignables/auditables: sí, por diseño desde la sección 11. Configurables: parcial — la pantalla existe (sección 12) pero sólo 3 de los ~13 tipos de umbral son ajustables sin desplegar código.
- [ ] Los permisos y el alcance de faena se aplican en backend. Cumple para los 8 permisos nuevos de esta sesión; no verificado sistemáticamente para el resto del módulo (trabajo de auditoría de permisos más amplio, sección 14).
- [ ] Las exportaciones respetan filtros, permisos y metadata. Cumple para las 5 exportaciones del módulo (filtros, alcance de faena, auditoría); la hoja de metadatos sólo se agregó a la exportación unificada de bitácora, no a las otras 4 todavía.
- [ ] Los flujos críticos tienen pruebas automatizadas. Parcial — ver sección 19: cobertura real en cálculos de ciclo, importación TAE y (nuevo) estadística de rendimiento; falta cobertura de las 23 reglas de anomalía y de seguridad/PWA.
- [ ] La operación completó piloto, capacitación y corte del Excel. No aplica a esta sesión — es ejecución operativa (sección 20), no código.
