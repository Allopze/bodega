# Plan de implementación — integraciones Copec y Aramco

Fecha: 2026-08-23  
Estado: **propuesto; pendiente de aprobación para implementar**  
Origen: auditoría técnica de extracción, persistencia y conciliación Copec TCT/TAE y Aramco Fleet.

## Objetivo

Cerrar las brechas detectadas en las integraciones de combustible para que cada dato externo tenga identidad durable, validación de frontera, trazabilidad, reproceso y conciliación explícita con vehículo, faena, producto, ciclo físico, carga interna y DTE/factura.

Este documento es un plan y un TODO. No autoriza por sí solo migraciones, backfills, despliegues, llamadas reales a los portales ni cambios en secretos.

## Decisión registrada: los secretos no se rotarán

Por instrucción del usuario del 2026-08-23, **los secretos actualmente configurados no pueden rotarse**. Esto incluye no revocar, reemitir ni cambiar sus valores como parte de este plan.

Consecuencias y límites de la decisión:

- La recomendación de rotación de la auditoría queda reemplazada por una estrategia de contención y controles compensatorios.
- No se copiarán valores sensibles a este documento, issues, logs, pruebas, commits ni mensajes de error.
- Retirar un archivo del índice de Git o purgar historia reduce exposición futura, pero **no convierte los valores existentes en secretos desconocidos**.
- Mientras los valores sigan vigentes, el riesgo residual debe considerarse aceptado y visible; ningún control compensatorio equivale a una rotación.
- La remoción de `doc.env` del repositorio debe conservar la copia operacional necesaria fuera de Git. No se debe borrar el archivo de un servidor ni alterar su valor durante esta tarea.
- Cualquier reescritura de historia, cambio de infraestructura o despliegue requiere autorización separada por su impacto operacional.

### Controles compensatorios obligatorios

- Sacar `doc.env` del seguimiento de Git sin imprimir ni cambiar sus valores.
- Ignorar y rechazar en CI cualquier archivo `*.env`, salvo `.env.example` explícitamente saneado.
- Restringir el acceso al repositorio y revisar quién pudo obtener el historial que contiene los valores.
- Hacer que conocer `CRON_SECRET` no sea suficiente: limitar los endpoints cron por red/origen autorizado y aplicar rate limit.
- Mantener auditoría y alertas sobre ejecuciones manuales/cron, fallos de autenticación y cambios de configuración.
- Reducir a mínimo privilegio las cuentas Copec/Aramco si el proveedor permite ajustar capacidades sin cambiar la credencial.
- No registrar credenciales, tokens Bearer, cuerpos de autenticación ni parámetros codificados del login.

## Evidencia base y límites

- Las 11 suites enfocadas de Copec/Aramco pasaron: 105/105 pruebas.
- ESLint enfocado pasó sin errores.
- `check:secrets` pasó incorrectamente aun cuando `doc.env` está rastreado: existe un falso negativo confirmado.
- La base PostgreSQL local consultada en transacción `READ ONLY` no contiene lotes Copec, Aramco ni recepciones TAE; no existe evidencia local de integridad sobre datos reales.
- No se consultaron los portales externos ni producción en la auditoría. La documentación de Aramco declara una verificación previa en vivo, pero no fue revalidada.

## Hallazgos que debe cerrar el plan

| ID | Hallazgo | Prioridad | Tareas |
|---|---|---:|---|
| CA-01 | Secretos rastreados y control CI con falso negativo | P0 | T01–T03 |
| CA-02 | Sincronización/configuración global accesible con `combustibles:import` scoped | P0 | T04–T05 |
| CA-03 | Refresco abierto decide por totales y nunca retira registros desaparecidos | P1 | T10–T11 |
| CA-04 | Meses cerrados no incorporan correcciones o transacciones tardías | P1 | T10–T12 |
| CA-05 | No existe conciliación integral consumo–ciclo–carga–DTE/factura | P1 | T15–T18 |
| CA-06 | Excel/JSON externo sin validación semántica suficiente | P1 | T07–T09 |
| CA-07 | Patentes, tarjetas y filas inválidas se descartan o quedan como estado efímero | P1 | T13–T14 |
| CA-08 | Faltan invariantes únicas de lote y proyección por patente | P1 | T06, T19 |
| CA-09 | Salud, última ejecución y mensajes de UI no reflejan el flujo real | P2 | T20–T22 |

## Arquitectura objetivo

```text
Portal Copec / API Aramco
  -> adaptador validado por proveedor
    -> corrida durable + filas aceptadas/rechazadas
      -> ledger canónico por transacción externa
        -> resolución de producto, patente, vehículo y faena
          -> proyección mensual reemplazable
            -> conciliación física y documental
              -> excepciones, decisiones manuales y observabilidad
```

Principios:

- La respuesta externa es dato no confiable hasta validarse.
- El ledger transaccional es la evidencia; el agregado mensual es una proyección reconstruible.
- Una corrección de origen debe actualizar o invalidar la proyección incluso si el mes está cerrado.
- Los mappings manuales se conservan fuera de la proyección para que un rebuild no los borre.
- Ningún registro desaparece en silencio: se importa, se rechaza o queda pendiente con causa durable.
- El alcance por faena se comprueba en servidor; administrar una integración global exige capacidad global.
- Toda conciliación declara qué dos verdades compara y cuál es su tolerancia.

## Dependencias

```text
Contención y RBAC (T01–T05)
  -> modelo de corrida/ledger (T06)
    -> validadores Copec/Aramco (T07–T09)
      -> proyección y reproceso (T10–T14)
        -> conciliación integral (T15–T18)
          -> constraints, salud y UI (T19–T22)
            -> preflight, backfill y verificación (T23–T25)
```

## Fase 0 — Contención y autorización

### T01 — Retirar archivos de secretos del seguimiento de Git

**Alcance:** impedir nuevas copias versionadas sin rotar ni modificar valores.

**Aceptación:**

- [ ] `doc.env` deja de aparecer en `git ls-files` y permanece disponible sólo en el mecanismo operacional autorizado.
- [ ] `.gitignore` cubre `*.env` y conserva la excepción de `.env.example`.
- [ ] El diff y los logs de la tarea no muestran ningún valor sensible.

**Verificación:**

- [ ] `git ls-files '*env*'` devuelve sólo archivos permitidos.
- [ ] `git check-ignore -v doc.env` confirma la regla.
- [ ] Revisión manual del diff buscando nombres sensibles, sin imprimir valores.

**Archivos probables:** `.gitignore`, índice Git.  
**Dependencias:** ninguna.  
**Tamaño:** S.

### T02 — Corregir el guard de archivos de entorno

**Alcance:** reemplazar el match por prefijo por una política basada en basename/patrón y allowlist.

**Aceptación:**

- [ ] `doc.env`, `prod.env`, `config.env.local` y equivalentes fallan el check si están rastreados.
- [ ] `.env.example` es la única excepción y sigue verificándose como plantilla saneada.
- [ ] La lista de claves sensibles deja de ser la única defensa; cualquier archivo de entorno no permitido rompe CI.

**Verificación:**

- [ ] Regresión con repositorio temporal que prueba permitidos y prohibidos.
- [ ] `npm run check:secrets` pasa en el checkout saneado.
- [ ] ESLint y TypeScript del script pasan.

**Archivos probables:** `scripts/check-env-files.ts`, prueba nueva del script.  
**Dependencias:** T01.  
**Tamaño:** S.

### T03 — Aplicar controles compensatorios de infraestructura

**Alcance:** reducir el impacto de valores vigentes que no se pueden rotar.

**Aceptación:**

- [ ] `/api/cron/fuel-copec-sync` y `/api/cron/fuel-aramco-sync` sólo aceptan tráfico desde el runner/origen autorizado además del Bearer existente.
- [ ] Existe rate limit y auditoría de intentos rechazados sin registrar el token.
- [ ] Se documenta quién mantiene acceso al repositorio y al archivo operacional.

**Verificación:**

- [ ] Tests de ruta cubren secreto correcto desde origen permitido, origen denegado y rate limit.
- [ ] `docker compose config --no-interpolate --quiet` pasa si cambia Compose.
- [ ] Smoke en entorno controlado demuestra que el runner permitido funciona y un origen ajeno no.

**Archivos probables:** rutas cron, política de proxy/red, `docker-compose.yml`, pruebas de rutas.  
**Dependencias:** T01–T02.  
**Tamaño:** M; dividir red y aplicación si excede cinco archivos.

### T04 — Separar importación scoped de administración global

**Alcance:** crear permisos diferenciados, por ejemplo `combustibles:sync_integrations` y `combustibles:manage_integrations`.

**Aceptación:**

- [ ] `combustibles:import` ya no permite ejecutar un barrido global ni cambiar credenciales.
- [ ] Sólo roles globales expresamente concedidos pueden administrar o ejecutar integraciones globales.
- [ ] `admin_contrato` mantiene importación manual dentro de sus faenas, sin acceso a estado global o secretos.

**Verificación:**

- [ ] Pruebas negativas con `admin_contrato` y un rol custom scoped.
- [ ] Pruebas positivas con administrador global.
- [ ] Paridad manifiesto/seed/permisos pasa.

**Archivos probables:** `modules/combustibles/manifest.ts`, acciones Copec/Aramco, pruebas de autorización.  
**Dependencias:** ninguna.  
**Tamaño:** M.

### T05 — Aplicar scope explícito a estado y resultados

**Alcance:** evitar que DTOs y consultas auxiliares expongan métricas, patentes o lotes de otras faenas.

**Aceptación:**

- [ ] El estado global sólo se entrega a capacidades globales.
- [ ] Los usuarios scoped sólo ven lotes y pendientes de sus faenas.
- [ ] Patentes pendientes nunca cruzan alcance en responses o toasts.

**Verificación:**

- [ ] Pruebas PGlite/PostgreSQL con dos faenas y dos usuarios scoped.
- [ ] Server Actions repiten scope aunque la UI oculte el control.

**Archivos probables:** página de importación, acciones de estado, servicios de consultas, pruebas de scope.  
**Dependencias:** T04.  
**Tamaño:** M.

### Checkpoint F0

- [ ] No hay archivos de secretos rastreados ni valores copiados a nuevos artefactos.
- [ ] El check CI detecta nombres arbitrarios `*.env`.
- [ ] Conocer el Bearer cron no basta desde un origen no autorizado.
- [ ] Un usuario scoped no administra ni ejecuta integraciones globales.
- [ ] Riesgo residual por no rotación documentado y aceptado explícitamente.

## Fase 1 — Ledger y validación de origen

### T06 — Crear corrida y ledger de transacciones externas

**Alcance:** modelar `fuel_provider_sync_runs`, `fuel_provider_transactions` y `fuel_provider_rejections` con migración generada desde schema.

**Aceptación:**

- [ ] Cada corrida guarda proveedor, rango solicitado/recibido, estado, conteos, actor, timestamps y correlation ID.
- [ ] Cada transacción guarda identidad externa, payload/hash, valores crudos/canónicos y estado de resolución.
- [ ] Existe unicidad por cuenta/proveedor + identidad externa, y una vía explícita para transacciones Copec sin ID nativo estable.

**Verificación:**

- [ ] Pruebas de constraints, reintento idempotente y payload corregido.
- [ ] `npm run db:generate` crea una migración nueva y una segunda ejecución informa sin drift.
- [ ] `npm run db:verify-migrations` pasa; nunca editar journal o migraciones existentes.

**Archivos probables:** nuevos schemas de combustible, exports de schema, migración, pruebas PGlite/PostgreSQL.  
**Dependencias:** T04.  
**Tamaño:** M; separar corrida y transacción si crece.

### T07 — Validar semánticamente el reporte Copec TCT

**Alcance:** validar archivo, canal, producto, mes, fecha por fila, cantidades, montos e identidad de transacción antes de persistir.

**Aceptación:**

- [ ] Una fila fuera del período solicitado queda rechazada, no estampada dentro del mes pedido.
- [ ] Producto/canal inesperado queda en cuarentena con causa.
- [ ] Duplicados dentro del archivo se detectan por identidad estable o fingerprint documentado.

**Verificación:**

- [ ] Fixtures para archivo correcto, mes equivocado, producto equivocado, duplicado y reversa/valor negativo.
- [ ] El total aceptado + rechazado coincide con las filas fuente.

**Archivos probables:** `copec-reports.ts`, `consumption-import.ts`, adaptador nuevo, pruebas/fixtures.  
**Dependencias:** T06.  
**Tamaño:** M.

### T08 — Validar semánticamente el reporte Copec TAE

**Alcance:** aplicar el mismo contrato a recepción TAE y persistir errores/unmapped con litros y monto afectados.

**Aceptación:**

- [ ] Canal TAE, producto, fecha, guía, tarjeta, litros y monto se validan contra la solicitud.
- [ ] Una guía repetida o corregida queda representada como conflicto/revisión, no descartada sólo por log.
- [ ] El resultado informa tarjetas, filas y litros sin mapear; el detalle queda durable.

**Verificación:**

- [ ] Tests de guía duplicada, tarjeta sin estanque, fecha fuera de rango y producto incompatible.
- [ ] Reimportar no duplica movimientos ni pierde la causa del rechazo.

**Archivos probables:** `tae-receipt-import.ts`, `tae-receipts.ts`, ledger/rechazos, pruebas.  
**Dependencias:** T06.  
**Tamaño:** M.

### T09 — Validar la API Aramco en runtime

**Alcance:** sustituir casts por esquemas estrictos para autenticación, token, paginación y movimientos.

**Aceptación:**

- [ ] Fechas, `transactionId`, patente, producto, cantidad y montos se validan antes de agrupar.
- [ ] Respuestas fuera de rango, páginas repetidas o IDs duplicados quedan rechazados y visibles.
- [ ] Productos desconocidos se envían a revisión; no caen silenciosamente en “Otros”.

**Verificación:**

- [ ] Tests para JSON válido, campos faltantes, `NaN`, negativos, página repetida, fecha fuera de rango y producto desconocido.
- [ ] Ningún cuerpo de autenticación/token aparece en errores o logs.

**Archivos probables:** `aramco-client.ts`, adaptador/validation nuevo, `aramco-sync.ts`, pruebas.  
**Dependencias:** T06.  
**Tamaño:** M.

### Checkpoint F1

- [ ] Toda fila externa termina aceptada, rechazada o pendiente con causa durable.
- [ ] Se puede demostrar completitud por corrida: recibidas = aceptadas + rechazadas.
- [ ] Reintentos no duplican identidades externas.
- [ ] Los adaptadores no exponen secretos en DTOs o logs.

## Fase 2 — Proyección, correcciones y pendientes

### T10 — Reemplazar agregación incremental por proyección reconstruible

**Alcance:** construir `fuel_import_batches`/`fuel_consumption_records` desde el ledger validado bajo una política única.

**Aceptación:**

- [ ] La proyección se reemplaza atómicamente por (faena, mes, producto, proveedor).
- [ ] Una patente que desaparece del origen deja de contar sin perder su mapping manual histórico.
- [ ] Un cambio de composición con totales globales iguales sí actualiza el detalle.

**Verificación:**

- [ ] Regresiones para patente retirada, litros movidos A→B con mismo total y transacción corregida.
- [ ] Lote y suma de detalles quedan iguales después de cada rebuild.

**Archivos probables:** servicio de proyección nuevo, `open-period.ts`, syncs y pruebas.  
**Dependencias:** T06–T09.  
**Tamaño:** M por proveedor; no implementar ambos en un único cambio grande.

### T11 — Conservar mappings manuales fuera del agregado

**Alcance:** dar identidad durable a la relación patente externa → vehículo/faena, incluyendo excepciones manuales.

**Aceptación:**

- [ ] Un rebuild conserva la decisión manual aunque la patente del vehículo sea distinta.
- [ ] La decisión registra actor, fecha, causa y vigencia.
- [ ] Trasladar/inactivar un vehículo no reasigna silenciosamente consumo histórico.

**Verificación:**

- [ ] Tests de rebuild, traslado de faena, vehículo inactivo y supersesión de mapping.

**Archivos probables:** schema de mapping, servicio de resolución, acción existente de vínculo, pruebas.  
**Dependencias:** T06, T10.  
**Tamaño:** M.

### T12 — Reprocesar meses cerrados y movimientos tardíos

**Alcance:** usar fingerprint/versión de evidencia, no la condición “mes abierto”, para decidir rebuild.

**Aceptación:**

- [ ] Una transacción tardía en una patente existente actualiza un mes cerrado.
- [ ] Una corrección o anulación externa supersede la evidencia previa y recalcula.
- [ ] La ventana de lookback de Aramco produce cambios reales o se reduce con una justificación medible.

**Verificación:**

- [ ] Tests de movimiento tardío, corrección de monto/litros y eliminación en mes cerrado.
- [ ] Repetir sin cambios no altera `updatedAt` ni genera auditoría espuria.

**Archivos probables:** syncs, ledger/proyección, pruebas de regresión.  
**Dependencias:** T10–T11.  
**Tamaño:** M por proveedor.

### T13 — Crear bandeja durable de pendientes y rechazos

**Alcance:** sustituir `pending: string[]`, `pendingPlates` efímero y `console.warn` por work items consultables.

**Aceptación:**

- [ ] Patente, tarjeta, producto o fila inválida tiene estado `pending/resolved/dismissed`, causa y magnitud afectada.
- [ ] Resolver un mapping elimina el pendiente vigente y dispara reproceso idempotente.
- [ ] Los pendientes históricos no obligan a retroceder manualmente el cursor.

**Verificación:**

- [ ] Tests de creación, resolución, reapertura por nueva evidencia y scope por faena.
- [ ] Migración/backfill del estado Copec actual se diseña sin inventar litros no disponibles.

**Archivos probables:** schema/servicio de pendientes, acciones/UI mínima, syncs, pruebas.  
**Dependencias:** T06, T11.  
**Tamaño:** M; separar UI del servicio.

### T14 — Hacer visibles errores y litros omitidos

**Alcance:** proyectar métricas de calidad por corrida y permitir exportar errores en Excel.

**Aceptación:**

- [ ] La UI muestra recibidas, aceptadas, rechazadas, pendientes, litros y monto afectados.
- [ ] Los errores se descargan con el componente estándar de exportación Excel.
- [ ] Una corrida con archivo válido pero cero filas aceptadas no se reporta como éxito sano.

**Verificación:**

- [ ] Tests de DTO/redacción por permiso y exportación `.xlsx`.
- [ ] Prueba de corrida degradada con filas inválidas/unmapped.

**Archivos probables:** servicio de salud, página/estado de importación, export action, pruebas.  
**Dependencias:** T13.  
**Tamaño:** M.

### Checkpoint F2

- [ ] Mes abierto y cerrado comparten el mismo motor de proyección.
- [ ] Correcciones, eliminaciones y composición con igual total están cubiertas.
- [ ] Ningún pendiente es sólo un contador o toast efímero.
- [ ] Lote y detalle tienen invariantes comprobables.

## Fase 3 — Conciliación integral

### T15 — Canonicalizar proveedor y producto

**Alcance:** relacionar cada transacción con `fuel_suppliers` y `fuel_products` sin depender sólo de `fuente` textual.

**Aceptación:**

- [ ] Copec y Aramco tienen proveedor canónico y RUT verificable.
- [ ] Diésel, BlueMax/AdBlue y otros productos usan FK canónica más snapshot de origen.
- [ ] Un producto desconocido queda pendiente, no mezclado con otro.

**Verificación:**

- [ ] Tests de mappings, alias, producto desconocido y compatibilidad por vehículo/vasija.

**Archivos probables:** schemas de ledger, `fuel-products.ts`, `fuel-sources.ts`, seed/mapping, pruebas.  
**Dependencias:** T06–T09.  
**Tamaño:** M.

### T16 — Conciliar transacciones externas con cargas internas

**Alcance:** definir matching y excepciones entre ledger proveedor y `fuel_loads`.

**Aceptación:**

- [ ] La regla usa proveedor, folio/documento, fecha, producto, vehículo, litros y monto con tolerancias declaradas.
- [ ] Coincidencias ambiguas nunca se enlazan automáticamente.
- [ ] Existe vínculo N:1 para facturas mensuales que cubren varias transacciones.

**Verificación:**

- [ ] Tests exacto, fuera de tolerancia, proveedor distinto, folio repetido y factura mensual N:1.

**Archivos probables:** schema de vínculos/reviews, servicio de conciliación, tests PGlite/PostgreSQL.  
**Dependencias:** T10, T15.  
**Tamaño:** M.

### T17 — Conciliar con DTE/factura sin forzar el modelo 1:1

**Alcance:** extender la conciliación DTE para facturas de combustible agrupadas.

**Aceptación:**

- [ ] Un DTE puede documentar un conjunto explícito de cargas/transacciones sin vincularse arbitrariamente a una sola.
- [ ] La suma conciliada se compara con monto DTE y conserva discrepancia/aceptación auditada.
- [ ] Notas de crédito/débito quedan asociables sin auto-match por coincidencia de folio.

**Verificación:**

- [ ] Tests de DTE 1:N, montos, RUT, ambigüedad 33/34 y NC/ND.
- [ ] Preflight detecta vínculos históricos incompatibles antes de migrar.

**Archivos probables:** schema DTE/vínculos, `dte-portal/reconciliation.ts`, preflight, pruebas.  
**Dependencias:** T16.  
**Tamaño:** M; separar schema/preflight de comportamiento.

### T18 — Completar conciliación del ciclo físico

**Alcance:** definir y mostrar separadamente recepción TAE, entrega desde estanque, consumo directo TCT/Aramco y carga documentada.

**Aceptación:**

- [ ] `consumed` deja de ser `null` cuando existe consumo proveedor conciliable.
- [ ] La pantalla no suma canales independientes bajo una etiqueta que sugiera igualdad documental.
- [ ] Diferencias recibido–entregado, entregado–consumido y consumido–facturado tienen semántica y tolerancia propias.

**Verificación:**

- [ ] Tests con TAE recibido, PWA entregado, TCT directo y Aramco en combinaciones independientes.
- [ ] Scope por faena/producto y filtros parciales de fecha no sobrestiman agregados mensuales.

**Archivos probables:** `fuel-cycle.ts`, `tae-copec-reconciliation.ts`, páginas de ciclo/conciliación, pruebas.  
**Dependencias:** T15–T17.  
**Tamaño:** M por comparación; evitar una pantalla monolítica.

### Checkpoint F3

- [ ] Cada cifra indica fuente, unidad, período y objeto conciliado.
- [ ] Aramco aparece en conciliación, no sólo en dashboard agregado.
- [ ] Facturas mensuales N:1 tienen modelo explícito.
- [ ] Las excepciones requieren decisión humana auditada.

## Fase 4 — Integridad, salud y UX

### T19 — Agregar constraints e invariantes de base

**Alcance:** proteger identidades lógicas después de preflight y saneamiento.

**Aceptación:**

- [ ] No hay dos lotes/proyecciones vigentes para la misma identidad lógica.
- [ ] No hay dos filas vigentes de la misma patente normalizada en una proyección.
- [ ] Constraints se agregan sólo después de medir y resolver conflictos históricos.

**Verificación:**

- [ ] Preflight `READ ONLY` lista duplicados y diferencias lote↔detalle.
- [ ] Pruebas PostgreSQL de carreras entre cron, botón manual e importador manual.
- [ ] Migración generada, cadena verificada y segunda generación sin drift.

**Archivos probables:** schema, preflight, migración nueva, pruebas de concurrencia.  
**Dependencias:** T10–T13.  
**Tamaño:** M.

### T20 — Persistir salud real de cada corrida

**Alcance:** reemplazar deducciones por `createdAt` y estados parciales en `system_settings`.

**Aceptación:**

- [ ] Se conoce inicio/fin, última corrida exitosa, degradada y fallida por proveedor.
- [ ] Un fallo al guardar cursor/estado hace fallar o degrada la corrida; no se oculta bajo éxito.
- [ ] Métricas incluyen páginas/archivos, transacciones, rechazos, pendientes, reprocesos y duración.

**Verificación:**

- [ ] Tests de éxito sin novedades, degradado, fallo de estado, conflicto de lock y 2FA.
- [ ] Alertas no contienen payloads ni secretos.

**Archivos probables:** modelo de corrida, crons, acciones de estado, pruebas.  
**Dependencias:** T06, T13–T14.  
**Tamaño:** M.

### T21 — Corregir mensajes y acciones de la UI

**Alcance:** alinear la pantalla con el flujo real TCT/TAE/Aramco y separar operación global de carga manual.

**Aceptación:**

- [ ] La UI no afirma que TAE dejó de extraerse mientras el backend lo siga haciendo.
- [ ] El usuario distingue sincronización, recepción TAE, consumo directo, pendientes y conciliación.
- [ ] Cada warning ofrece CTA real hacia mapping/revisión/reproceso.

**Verificación:**

- [ ] Pruebas de componentes y accesibilidad.
- [ ] E2E de estado sano, degradado, 2FA, pendiente y permiso scoped.

**Archivos probables:** página de importación, paneles Copec/Aramco, bandeja de pendientes, E2E.  
**Dependencias:** T04–T05, T13–T14, T20.  
**Tamaño:** M; dividir por panel.

### T22 — Documentar contratos y runbook

**Alcance:** actualizar documentación de proveedor, conciliación, recuperación y seguridad operacional.

**Aceptación:**

- [ ] Contratos Copec y Aramco enumeran campos usados, rechazados y tolerancias.
- [ ] Runbook explica preflight, reproceso, 2FA, portal caído, pendientes y rollback.
- [ ] La restricción de no rotación y sus controles compensatorios siguen visibles sin valores.

**Verificación:**

- [ ] Los comandos del runbook existen y corren en modo seguro por defecto.
- [ ] Revisión cruzada entre docs, variables de `.env.example`, Compose y código.

**Archivos probables:** `docs/combustibles/ARAMCO.md`, documento Copec nuevo, runbook y `.env.example`.  
**Dependencias:** T03, T15–T21.  
**Tamaño:** S/M.

### Checkpoint F4

- [ ] Salud, última corrida y pendientes provienen de estado durable.
- [ ] Los textos describen el comportamiento implementado.
- [ ] Constraints sostienen las invariantes incluso fuera del sincronizador.
- [ ] Runbook permite operar sin exponer ni rotar secretos.

## Fase 5 — Migración, verificación y rollout

### T23 — Construir preflight de sólo lectura

**Aceptación:**

- [ ] Reporta duplicados lógicos, lote↔detalle, fuentes desconocidas, pendientes, transacciones sin identidad y vínculos DTE incompatibles.
- [ ] No selecciona ganadores ni modifica datos.
- [ ] Produce salida revisable antes de autorizar backfill.

**Verificación:**

- [ ] Test confirma `transaction_read_only = on`.
- [ ] Fixtures cubren cada categoría del reporte.

**Dependencias:** T06, T15–T19.  
**Tamaño:** M.

### T24 — Backfill y reconstrucción controlada

**Aceptación:**

- [ ] Corre en dry-run por defecto y exige flag explícito para aplicar.
- [ ] Es idempotente y conserva payload, mapping y auditoría.
- [ ] No inventa identidad externa; lo ambiguo queda pendiente.

**Verificación:**

- [ ] Dos ejecuciones dejan el mismo resultado.
- [ ] PostgreSQL desechable valida rollback ante fallo intermedio.
- [ ] Aplicación real requiere revisión humana del preflight y autorización separada.

**Dependencias:** T23.  
**Tamaño:** M.

### T25 — Gates y prueba de proveedor controlada

**Aceptación:**

- [ ] Suites focales, `test:fast`, PGlite y PostgreSQL secuencial pasan.
- [ ] ESLint, `npx tsc --noEmit`, migraciones, secretos y build pasan.
- [ ] E2E en base desechable cubre permisos, sync, pendientes, reproceso y conciliación.
- [ ] Producción se declara verificada sólo tras deploy limpio, preflight revisado, sync real controlado y consultas post-run.

**Comandos mínimos:**

- [ ] `npx vitest run <suites Copec/Aramco nuevas y existentes>`
- [ ] `npm run test:fast`
- [ ] `npm run test:pglite`
- [ ] PostgreSQL real, secuencial y en base desechable.
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run db:verify-migrations`
- [ ] `npm run check:secrets`
- [ ] `npm run build`

**Dependencias:** T01–T24.  
**Tamaño:** M.

## TODO maestro

### F0 — Contención y permisos

- [ ] T01 Retirar `doc.env` del seguimiento sin alterar secretos.
- [ ] T02 Corregir `check:secrets` y agregar regresiones.
- [ ] T03 Restringir cron por origen/red y auditar rechazos.
- [ ] T04 Crear permisos globales específicos de integración.
- [ ] T05 Acotar estado/resultados por alcance.
- [ ] Checkpoint F0 aprobado.

### F1 — Ledger y validación

- [ ] T06 Crear modelo durable de corridas, transacciones y rechazos.
- [ ] T07 Validar semánticamente Copec TCT.
- [ ] T08 Validar semánticamente Copec TAE.
- [ ] T09 Validar respuestas Aramco en runtime.
- [ ] Checkpoint F1 aprobado.

### F2 — Proyección y pendientes

- [ ] T10 Implementar proyección mensual reconstruible.
- [ ] T11 Separar y auditar mappings manuales.
- [ ] T12 Reprocesar correcciones y meses cerrados.
- [ ] T13 Crear bandeja durable de pendientes/rechazos.
- [ ] T14 Mostrar y exportar calidad/impacto de ingesta.
- [ ] Checkpoint F2 aprobado.

### F3 — Conciliación

- [ ] T15 Canonicalizar proveedor y producto.
- [ ] T16 Conciliar ledger con cargas internas.
- [ ] T17 Modelar conciliación DTE 1:N y excepciones.
- [ ] T18 Completar el ciclo físico y sus diferencias.
- [ ] Checkpoint F3 aprobado.

### F4 — Integridad, salud y UX

- [ ] T19 Agregar constraints después del saneamiento.
- [ ] T20 Persistir salud real por corrida.
- [ ] T21 Corregir UI y CTAs operacionales.
- [ ] T22 Actualizar contratos y runbook.
- [ ] Checkpoint F4 aprobado.

### F5 — Rollout

- [ ] T23 Ejecutar y revisar preflight `READ ONLY`.
- [ ] T24 Autorizar y ejecutar backfill/rebuild controlado.
- [ ] T25 Completar gates locales, E2E y smoke real autorizado.
- [ ] Auditoría final requisito por requisito.
- [ ] Evidencia de producción separada de evidencia local.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---:|---|
| Secretos vigentes conocidos por terceros | Crítico | Controles compensatorios F0, acceso mínimo, red restringida, monitoreo; riesgo residual aceptado porque no habrá rotación. |
| Ledger/proyección duplica cifras durante transición | Alto | Escritura paralela sólo detrás de flag, comparación shadow y cutover atómico. |
| Backfill sin identidad estable Copec | Alto | Fingerprint documentado, no inventar match y enviar ambigüedad a bandeja. |
| Constraint falla por histórico | Alto | Preflight `READ ONLY`, saneamiento explícito y constraint sólo después. |
| Rebuild borra mapping manual | Alto | Mapping durable separado y regresiones antes de sustituir `open-period`. |
| DTE mensual no cabe en vínculo 1:1 | Alto | Modelo de grupo/vínculo 1:N y preflight previo. |
| Rol scoped dispara operación global | Alto | Permisos nuevos, global-role guard y pruebas negativas multi-faena. |
| Portal cambia HTML/API | Medio | Adaptadores validados, corrida degradada, fixtures de contrato y alertas. |
| Trabajo concurrente en checkout | Medio | Cambios pequeños, revisar `git status`, no tocar archivos ajenos y commits por fase sólo si se autorizan. |

## Definition of Done

- [ ] Los nueve hallazgos CA-01–CA-09 tienen prueba de regresión y evidencia de cierre.
- [ ] Toda corrida demuestra recibidas = aceptadas + rechazadas y cuantifica pendientes.
- [ ] Meses abiertos y cerrados reflejan correcciones sin duplicar ni dejar detalle obsoleto.
- [ ] Ninguna acción global es ejecutable con un permiso scoped genérico.
- [ ] Proveedor, producto, transacción, carga, DTE y ciclo físico tienen vínculos explícitos y auditables.
- [ ] No hay secretos rastreados, impresos ni copiados; los valores vigentes no fueron rotados.
- [ ] Pruebas locales, migraciones, build y E2E pasan.
- [ ] Producción sólo se declara validada con evidencia posterior al deploy.

