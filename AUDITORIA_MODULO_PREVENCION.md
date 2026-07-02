# Auditoria profunda del modulo Prevencion

Fecha de auditoria: 2026-07-01  
Repositorio: `/home/allopze/dev/chome/bodega`  
Alcance: `app/(app)/prevencion/**`, `app/api/prevencion/**`, `lib/services/prevention-*`, `lib/services/sst.ts`, `lib/services/ppa.ts`, `lib/validation/{prevention,sst,ppa}.ts`, `db/schema/{prevention,sst,ppa}.ts`, manifests vivos de Prevencion/SST/PPA.

## Resumen ejecutivo

El modulo de Prevencion esta funcionalmente amplio y ya contiene buenas defensas en varias zonas: SST valida trabajador-faena en creacion de evaluaciones, la mayoria de exports usa XLSX, PPA e IPER tienen scoping por faena, y Biblioteca SST queda definida como la unica superficie documental viva del modulo.

La auditoria, sin embargo, encontro problemas importantes:

- Se encontraron bypasses de scope por faena en submodulos con entidades hijas: Comites, Permisos y Documentacion legal legacy. Los P1 accionables ya fueron corregidos o retirados segun la bitacora.
- Hay una familia de errores de integridad trabajador-faena: varias acciones validan que el usuario tenga acceso a la faena declarada, pero no que el trabajador enviado pertenezca a esa faena.
- `alcotest` tiene un bug asincrono confirmado: la action no espera la escritura en BD.
- Biblioteca SST esta mejor encaminada, pero permite reubicar metadata a una faena fuera del scope y vincular documentos a entidades no verificadas.
- Hay funciones implementadas en servicios pero sin action/UI, por lo que el usuario no puede completar flujos esperables: firma de reportes de equipo, sanitizacion, politicas de vida util EPP, asistencia CPHS y vencimientos MINSAL por trabajador.
- La UI esta en transicion: algunos submodulos siguen usando breadcrumbs fuera de `PageHeader`, pantallas de tabla crudas o formularios sin filtros dependientes por faena.

Veredicto: no recomendaria considerar Prevencion listo para produccion operativa multi-faena sin corregir primero los hallazgos P1.

## Evidencia y verificacion ejecutada

Ultima verificacion acumulada ejecutada:

```bash
npm test -- --run lib/__tests__/prevention-training.test.ts lib/__tests__/prevention-incidents.test.ts lib/__tests__/prevention-ola2.test.ts lib/__tests__/prevention-ola34.test.ts lib/__tests__/prevention-permits.test.ts lib/__tests__/prevention-alcotest-actions.test.ts lib/__tests__/prevention-documents-library-service.test.ts lib/__tests__/prevention-equipment-actions.test.ts lib/__tests__/prevention-epp-actions.test.ts lib/__tests__/prevention-documentation-canonical.test.ts
```

Resultado:

- 10 archivos de test pasaron.
- 47 tests pasaron.
- Duracion aproximada: 28.96s.

```bash
npm run typecheck
```

Resultado: `tsc --noEmit` paso sin errores.

Importante: estos tests no cubren varios de los bugs encontrados; por eso el resultado verde no invalida los hallazgos.

## Bitacora de remediacion ejecutada

Fecha de fixes: 2026-07-01

### Lote 1 - P1 accionables cerrados

Estado: aplicado y verificado.

Cambios realizados:

- P1-01: `registerAlcoholTestAction()` ahora espera `await registerAlcoholTest(...)`; el `try/catch` vuelve a capturar errores reales del servicio y el mensaje especial de resultado `positivo` se muestra correctamente.
- P1-03: Comites CPHS ahora propaga scope desde las Server Actions a `addCommitteeMember()`, `scheduleMeeting()` y `addAgreement()`. El servicio carga el comite padre, o la reunion y su comite, antes de permitir mutaciones hijas.
- P1-04: `signPermit()` ahora recibe scope, carga el permiso y valida `permit.worksiteId` antes del upsert de firmas. `signPermitAction()` propaga el scope de la sesion.
- P1-05: se agrego validacion trabajador-faena antes de escribir registros en capacitaciones, incidentes, reportes diarios de equipos, alcotest y observaciones conductuales.
- P1-06: `updateDocumentMetadata()` valida tambien la nueva `worksiteId` antes de permitir mover metadata de Biblioteca SST.
- P1-07: `updateDocumentMetadata()` exige permiso especializado sobre la confidencialidad actual del documento y tambien sobre la confidencialidad destino cuando se cambia.

Tests agregados:

- `lib/__tests__/prevention-alcotest-actions.test.ts`
- `lib/__tests__/prevention-documents-library-service.test.ts`
- Regresiones nuevas en `prevention-training`, `prevention-incidents`, `prevention-ola2`, `prevention-ola34` y `prevention-permits`.

Evidencia TDD:

- Rojo inicial esperado: 6 archivos fallaron, 8 tests fallaron, 29 pasaron. Fallas confirmadas en alcotest action, trabajador-faena, CPHS y firma de permisos.
- Rojo Biblioteca SST esperado: 1 archivo fallo, 2 tests fallaron. Fallas confirmadas en movimiento de `worksiteId` y edicion de documento sensible sin permiso.
- Verde final focalizado:

```bash
npm test -- --run lib/__tests__/prevention-training.test.ts lib/__tests__/prevention-incidents.test.ts lib/__tests__/prevention-ola2.test.ts lib/__tests__/prevention-ola34.test.ts lib/__tests__/prevention-permits.test.ts lib/__tests__/prevention-alcotest-actions.test.ts lib/__tests__/prevention-documents-library-service.test.ts
```

Resultado:

- 7 archivos de test pasaron.
- 39 tests pasaron.
- Duracion aproximada: 27.01s.

Verificacion adicional:

```bash
npm run typecheck
```

Resultado: `tsc --noEmit` paso sin errores.

### Lote 2 - Documentacion legacy y links de Biblioteca SST

Estado: aplicado y verificado focalmente en su momento; la parte `documentacion` legacy fue reemplazada por el retiro total del Lote 4.

Cambios realizados:

- P1-02, reemplazado por Lote 4: inicialmente se scopearon entregas, firmas y trabajadores visibles en `documentacion` legacy; luego se retiro completo el submodulo sin compatibilidad temporal.
- P2-01: `linkDocumentToEntity()` ahora valida que la entidad vinculada exista antes de insertar el link.
- P2-01: `linkDocumentToEntity()` valida scope cuando la entidad permite derivar faena: trabajador, faena, vehiculo de flota, reporte/equipo, incidente, comite, entrega EPP, accion correctiva y plan de emergencia. `training` se valida como catalogo global existente.

Tests agregados o ampliados:

- `lib/__tests__/prevention-ola34.test.ts`: regresion multi-faena para entrega/firma de documentacion legal legacy.
- `lib/__tests__/prevention-documents-library-service.test.ts`: regresiones para link a entidad inexistente y link a entidad fuera de scope.

Evidencia TDD:

- Rojo `documentacion` legacy esperado: `prevention-ola34.test.ts` fallo 1 test porque `deliverDocument()` aceptaba trabajador fuera de scope.
- Rojo Biblioteca links esperado: `prevention-documents-library-service.test.ts` fallo 2 tests porque `linkDocumentToEntity()` insertaba links a entidad inexistente/fuera de scope.
- Verde focalizado:

```bash
npm test -- --run lib/__tests__/prevention-ola34.test.ts lib/__tests__/prevention-documents-library-service.test.ts
```

Resultado:

- 2 archivos de test pasaron.
- 13 tests pasaron.
- Duracion aproximada: 7.99s.

Verificacion adicional:

```bash
npm run typecheck
```

Resultado: `tsc --noEmit` paso sin errores.

### Lote 3 - Funciones faltantes F-01 y F-03

Estado: aplicado y verificado focalmente.

Cambios realizados:

- F-01: `signEquipmentReport()` ahora firma el reporte con su `operatorWorkerId`, no con un `workerId` arbitrario enviado por el caller.
- F-01: se agrego `signEquipmentReportAction()` con permiso `prevention:equipment_reports:manage`, scope de faena y revalidacion de `/prevencion/equipos/reportes`.
- F-01: `reporte-list.tsx` muestra accion `Firmar` cuando el reporte aun no tiene `signedByWorkerId`.
- F-03: se agrego `setEppLifecyclePolicyAction()` con validacion `eppLifecyclePolicySchema`, permiso `prevention:epp_matrix:manage` y revalidacion de `/prevencion/epp/matriz`.

Tests agregados o ampliados:

- `lib/__tests__/prevention-equipment-actions.test.ts`
- `lib/__tests__/prevention-epp-actions.test.ts`
- `lib/__tests__/prevention-ola2.test.ts`: regresion de firma del reporte con el operador.

Evidencia TDD:

- Rojo F-01 esperado: `prevention-equipment-actions.test.ts` fallo porque `signEquipmentReportAction` no existia y `prevention-ola2.test.ts` fallo porque el servicio aun esperaba `workerId` manual.
- Rojo F-03 esperado: `prevention-epp-actions.test.ts` fallo porque `setEppLifecyclePolicyAction` no existia.
- Verde focalizado:

```bash
npm test -- --run lib/__tests__/prevention-ola2.test.ts lib/__tests__/prevention-equipment-actions.test.ts lib/__tests__/prevention-epp-actions.test.ts
```

Resultado:

- 3 archivos de test pasaron.
- 19 tests pasaron.
- Duracion aproximada: 7.89s.

Verificacion acumulada tras lote 3:

```bash
npm test -- --run lib/__tests__/prevention-training.test.ts lib/__tests__/prevention-incidents.test.ts lib/__tests__/prevention-ola2.test.ts lib/__tests__/prevention-ola34.test.ts lib/__tests__/prevention-permits.test.ts lib/__tests__/prevention-alcotest-actions.test.ts lib/__tests__/prevention-documents-library-service.test.ts lib/__tests__/prevention-equipment-actions.test.ts lib/__tests__/prevention-epp-actions.test.ts
```

Resultado:

- 9 archivos de test pasaron.
- 47 tests pasaron.
- Duracion aproximada: 29.22s.

```bash
npm run typecheck
```

Resultado: `tsc --noEmit` paso sin errores.

### Lote 4 - Retiro sin compatibilidad temporal de `documentacion` legacy

Estado: aplicado y verificado focalmente.

Decision aplicada:

- Biblioteca SST queda como unica superficie documental de Prevencion.
- No se mantiene compatibilidad temporal con `/prevencion/documentacion`.
- No se conserva permiso legacy `prevention:legal_docs:*` en el manifesto vivo.

Cambios realizados:

- P1-02: se eliminaron las rutas de app legacy bajo `app/(app)/prevencion/documentacion`.
- P1-02: se elimino el export legacy `app/api/prevencion/documentacion/export/route.ts`.
- P1-02: se eliminaron permisos, metadata, grants por defecto y entrada de navegacion `Documentacion` del manifesto de Prevencion.
- P1-02: se elimino `lib/services/prevention-legal-docs.ts`.
- P1-02: se eliminaron schemas legacy `legalDocumentCreateSchema`, `legalDocumentVersionAddSchema` y `documentDeliveryCreateSchema`.
- P1-02: se retiro la cobertura que ejercitaba el servicio legacy y se agrego `lib/__tests__/prevention-documentation-canonical.test.ts` como guardarrail para impedir que reaparezca la superficie legacy.

Pendiente estructural opcional:

- Si se quiere limpiar tambien las tablas fisicas legacy (`legalDocuments`, `legalDocumentVersions`, `documentDeliveries`, `documentSignatures`), hacerlo con cambio en `db/schema/*` y migracion nueva generada con `npm run db:generate`. No se debe editar migraciones existentes ni el journal a mano.

Verificacion:

```bash
npm test -- --run lib/__tests__/prevention-training.test.ts lib/__tests__/prevention-incidents.test.ts lib/__tests__/prevention-ola2.test.ts lib/__tests__/prevention-ola34.test.ts lib/__tests__/prevention-permits.test.ts lib/__tests__/prevention-alcotest-actions.test.ts lib/__tests__/prevention-documents-library-service.test.ts lib/__tests__/prevention-equipment-actions.test.ts lib/__tests__/prevention-epp-actions.test.ts lib/__tests__/prevention-documentation-canonical.test.ts
```

Resultado:

- 10 archivos de test pasaron.
- 47 tests pasaron.
- Duracion aproximada: 28.96s.

```bash
npm run typecheck
```

Resultado: `tsc --noEmit` paso sin errores tras limpiar tipos generados stale en `.next`.

## Inventario auditado por submodulo

- Evaluaciones SST: listado, creacion, detalle, respuestas, cierre, seguimientos, planes de accion, evaluaciones semanales.
- PPA Digital: listado, revision, cierre, revocacion de token publico, export.
- PDTP SG-SST: catalogo, programa, ejecuciones, aprobaciones, export.
- IPER/Matriz de riesgos: matriz, items de riesgo, cierre, export.
- Incidentes: registro, acciones, cierre, procedimiento, export.
- Capacitaciones: cursos, asignaciones, matriz por cargo, vencimientos, export.
- Inspecciones: runs, items, observaciones conductuales, cierre, detalle, export.
- Equipos: reportes diarios, revision, checklists, sanitizacion parcial en servicio, export.
- Alcotest: registro, envio, seleccion aleatoria, estadisticas/export.
- EPP: matriz por cargo, entregas, stock critico, lifecycle parcial en servicio, export.
- Salud ocupacional: examenes, aptitudes, restricciones, protocolos MINSAL.
- Emergencias: planes, simulacros, equipos, inspecciones, export.
- Documentacion legal legacy: retirada como superficie app/API/permiso/servicio. Biblioteca SST absorbe la decision documental.
- Biblioteca SST: documentos, versiones, estados, acuses, links, descargas, audit log.
- Contratistas: padron, trabajadores, documentos.
- Comites CPHS: comites, miembros, reuniones, acuerdos, export.
- KPIs: horas hombre, indicadores, export.

## Hallazgos P1

### P1-01 - `alcotest` devuelve exito antes de escribir en BD y pierde la advertencia de positivo

Estado 2026-07-01: corregido en esta pasada.

Archivos modificados:

- `app/(app)/prevencion/alcotest/actions.ts`
- `lib/__tests__/prevention-alcotest-actions.test.ts`

Donde:

- `app/(app)/prevencion/alcotest/actions.ts:28`
- `lib/services/prevention-alcohol-tests.ts:20-39`

Problema:

`registerAlcoholTestAction()` llama `registerAlcoholTest(input, session.user.id, scope)` sin `await`. Como `registerAlcoholTest` es async, la action:

- revalida la ruta antes de que termine la insercion;
- no captura errores de validacion o BD del servicio dentro del `try/catch`;
- evalua `"result" in result` sobre una Promise, por lo que nunca entra al mensaje especial de test positivo;
- puede mostrar "Test registrado" aunque la escritura falle despues.

Impacto:

El usuario recibe feedback falso y se pierde el aviso operativo mas importante del flujo: "Test positivo registrado. Escalar al prevencionista...".

Solucion sugerida:

Cambiar a `const result = await registerAlcoholTest(...)`, mantener el `try/catch`, y agregar un test de action que verifique que resultado `positivo` devuelve el mensaje especial y que un scope invalido retorna error.

### P1-02 - `documentacion` legacy no aplica scope por faena y expone trabajadores globales

Estado 2026-07-01: cerrado por retiro del legacy sin compatibilidad temporal.

Archivos modificados:

- `app/(app)/prevencion/documentacion/page.tsx`
- `app/(app)/prevencion/documentacion/actions.ts`
- `lib/services/prevention-legal-docs.ts`
- `lib/__tests__/prevention-ola34.test.ts`
- `app/(app)/prevencion/documentacion/document-form.tsx`
- `app/(app)/prevencion/documentacion/documentacion-panel.tsx`
- `app/(app)/prevencion/documentacion/documentacion-list.tsx`
- `app/api/prevencion/documentacion/export/route.ts`
- `modules/prevention/manifest.ts`
- `lib/validation/prevention.ts`
- `lib/__tests__/prevention-documentation-canonical.test.ts`
- `lib/__tests__/prevention-legal-docs.test.ts`

Detalle de cierre:

- Retirado: ya no existe ruta app `/prevencion/documentacion`.
- Retirado: ya no existe API export legacy `/api/prevencion/documentacion/export`.
- Retirado: ya no existe servicio `prevention-legal-docs`.
- Retirado: ya no existen permisos `prevention:legal_docs:*` en el manifesto vivo.
- Retirado: ya no existen schemas de validacion legacy para documentacion legal.
- Cerrado como decision de producto: Biblioteca SST es la unica via documental viva.

Donde:

- Superficie retirada: `app/(app)/prevencion/documentacion/**`
- Superficie retirada: `app/api/prevencion/documentacion/export/route.ts`
- Superficie retirada: `lib/services/prevention-legal-docs.ts`
- Guardarrail: `lib/__tests__/prevention-documentation-canonical.test.ts`

Problema:

La pagina lista todos los documentos legales, versiones y entregas sin `resolveWorksiteScope`. Si el usuario puede gestionar, tambien carga todos los trabajadores activos del sistema. Las acciones de entrega y firma tampoco reciben ni validan scope; el servicio registra entregas por `versionId` + `workerId` y firma por `deliveryId`.

Impacto:

Un usuario con permiso de documentacion podria ver, entregar o firmar documentos vinculados a trabajadores fuera de su faena. Esto es especialmente delicado porque el propio repo ya tiene un modulo nuevo, Biblioteca SST, que si modela `worksiteId`, scope y bitacora.

Solucion aplicada:

Retirar el legacy sin compatibilidad temporal y consolidar documentacion en Biblioteca SST. La limpieza de tablas fisicas queda como migracion destructiva opcional, no como compatibilidad runtime.

### P1-03 - Comites CPHS valida scope al crear comite, pero no al mutar miembros, reuniones o acuerdos

Estado 2026-07-01: corregido en esta pasada.

Archivos modificados:

- `app/(app)/prevencion/comites/actions.ts`
- `lib/services/prevention-committees.ts`
- `lib/__tests__/prevention-ola34.test.ts`

Donde:

- `app/(app)/prevencion/comites/actions.ts:44-84`
- `lib/services/prevention-committees.ts:42-93`

Problema:

`createCommitteeAction()` pasa scope al servicio, pero `addCommitteeMemberAction()`, `scheduleMeetingAction()` y `addAgreementAction()` no lo hacen. En el servicio, `addCommitteeMember()`, `scheduleMeeting()` y `addAgreement()` insertan usando `committeeId` o `meetingId` sin cargar el comite padre ni verificar `committee.worksiteId`.

Impacto:

Un usuario con `prevention:cphs:manage` en una faena podria mutar comites de otra faena si conoce o obtiene el ID.

Solucion sugerida:

Pasar scope a todas las funciones hijas. En servicio, cargar el comite padre para miembros/reuniones y el meeting->committee para acuerdos, luego ejecutar `assertWorksiteAccess(parent.worksiteId, scope)`. Agregar tests negativos: usuario con scope `ws-a` no puede modificar comite/reunion de `ws-b`.

### P1-04 - Firma de permisos de trabajo no revalida scope del permiso

Estado 2026-07-01: corregido en esta pasada.

Archivos modificados:

- `app/(app)/prevencion/permisos/actions.ts`
- `lib/services/prevention-permits.ts`
- `lib/__tests__/prevention-permits.test.ts`

Donde:

- `app/(app)/prevencion/permisos/actions.ts:99-110`
- `lib/services/prevention-permits.ts:111-129`

Problema:

`approvePermitRequest()` si valida scope del permiso, pero `signPermitAction()` llama `signPermit(parsed.data, session.user.id)` sin scope. El servicio carga el permiso por ID, pero no llama `assertWorksiteAccess(permit.worksiteId, scope)`.

Impacto:

Un usuario con `prevention:permits:manage` podria firmar permisos fuera de su faena si conoce el `permitId`.

Solucion sugerida:

Cambiar firma a `signPermit(input, userId, scope)`, validar `permit.worksiteId` antes del insert/upsert de `permitSignoffs`, y agregar test negativo multi-faena.

### P1-05 - Integridad trabajador-faena inconsistente fuera de SST

Estado 2026-07-01: corregido para las superficies listadas en este hallazgo.

Archivos modificados:

- `lib/services/prevention-training.ts`
- `lib/services/prevention-incidents.ts`
- `lib/services/prevention-equipment.ts`
- `lib/services/prevention-alcohol-tests.ts`
- `lib/services/prevention-inspections.ts`
- `lib/__tests__/prevention-training.test.ts`
- `lib/__tests__/prevention-incidents.test.ts`
- `lib/__tests__/prevention-ola2.test.ts`

Donde:

- Capacitaciones: `lib/services/prevention-training.ts:49-80`
- Incidentes: `lib/services/prevention-incidents.ts:35-59`
- Reportes de equipos: `lib/services/prevention-equipment.ts:31-49`
- Alcotest: `lib/services/prevention-alcohol-tests.ts:20-38`
- Observaciones conductuales: `lib/services/prevention-inspections.ts:195-212`
- Referencia positiva en SST: `app/(app)/prevencion/actions.ts:104-110`

Problema:

Estos servicios validan la faena declarada contra el scope del usuario, pero no validan que el `workerId`, `operatorWorkerId` o `testedWorkerId` pertenezca a esa misma faena. SST si lo hace al crear evaluacion, lo que deja claro el patron esperado.

Impacto:

Se pueden crear registros cruzados: trabajador de faena B asociado a capacitacion/incidente/reporte/alcotest/observacion de faena A. Eso contamina reportes, vencimientos, alertas medicas y trazabilidad operacional.

Solucion sugerida:

Crear helper compartido, por ejemplo `assertWorkerBelongsToWorksite(workerId, worksiteId)`, y usarlo en todos los servicios con `workerId + worksiteId`. Para campos opcionales, validar solo cuando viene ID. Agregar tests negativos por submodulo.

### P1-06 - Biblioteca SST permite mover un documento a una faena fuera del scope durante update

Estado 2026-07-01: corregido en esta pasada.

Archivos modificados:

- `lib/services/prevention-documents-library.ts`
- `lib/__tests__/prevention-documents-library-service.test.ts`

Donde:

- `lib/services/prevention-documents-library.ts:390-414`

Problema:

`updateDocumentMetadata()` valida acceso sobre la faena actual del documento (`doc.worksiteId`) en la linea 393. Luego, si el input trae `worksiteId`, lo copia directamente al patch en la linea 413. No valida que la nueva faena tambien pertenezca al scope.

Impacto:

Un usuario de faena A podria actualizar un documento que ve en A y reasignarlo a una faena B fuera de su alcance.

Solucion sugerida:

Si `data.worksiteId !== undefined`, ejecutar `assertScopeAccess(data.worksiteId || null, args.scope)` antes de construir el patch. Agregar test persistente de update que intente mover un documento fuera del scope.

### P1-07 - Biblioteca SST no exige permiso de confidencialidad al editar documentos ya sensibles/restringidos

Estado 2026-07-01: corregido en esta pasada.

Archivos modificados:

- `lib/services/prevention-documents-library.ts`
- `lib/__tests__/prevention-documents-library-service.test.ts`

Donde:

- `lib/services/prevention-documents-library.ts:393-407`

Problema:

El servicio valida permiso de confidencialidad al crear (`createDocument`) y al subir version, pero en update solo ejecuta `assertConfidentialityAllowed()` cuando el nuevo valor sube de rango. Si un documento ya es `sensible` o `restringido`, un usuario con `prevention:docs:manage` pero sin `prevention:docs:manage_sensitive` o `prevention:docs:manage_restricted` puede editar metadata mientras no aumente la confidencialidad.

Impacto:

El permiso especializado "Gestionar documentos sensibles/restringidos" queda incompleto para edicion de metadata.

Solucion sugerida:

Antes de editar, validar `assertConfidentialityAllowed(doc.confidentiality, args.permissions)`. Si se cambia confidencialidad, validar tambien el destino. Agregar tests para editar doc sensible sin permiso especializado.

## Hallazgos P2

### P2-01 - Biblioteca SST permite links a entidades no verificadas o fuera del scope

Estado 2026-07-01: corregido en esta pasada para los tipos con entidad verificable en el modelo actual.

Archivos modificados:

- `lib/services/prevention-documents-library.ts`
- `lib/__tests__/prevention-documents-library-service.test.ts`

Detalle de cierre:

- Corregido: el link rechaza entidades inexistentes.
- Corregido: el link valida scope para `worker`, `worksite`, `vehicle`, `equipment`, `incident`, `committee`, `epp_delivery`, `corrective_action` y `emergency_plan`.
- Corregido: `training` valida existencia del curso como catalogo global.

Donde:

- `app/(app)/prevencion/biblioteca/actions.ts:201-214`
- `lib/services/prevention-documents-library.ts:829-848`

Problema:

`linkDocumentToEntity()` valida scope del documento, pero no verifica que la entidad linkeada exista ni que pertenezca al mismo scope. La pagina de detalle luego hidrata algunos links (`incident`, `committee`, `emergency_plan`, `corrective_action`, `training`) por ID.

Impacto:

Se pueden crear asociaciones rotas o cruzadas entre faenas. En el mejor caso ensucia la trazabilidad; en el peor, muestra metadata de una entidad ajena al abrir el documento.

Solucion sugerida:

Resolver cada `entityType` a su tabla y validar existencia + faena cuando aplique. Para tipos sin faena directa, validar por la entidad padre. Si una entidad es global, declararlo explicitamente.

### P2-02 - Salud ocupacional registra restricciones, pero los modulos consumidores solo avisan, no bloquean

Donde:

- `lib/services/prevention-health.ts:140-146`
- `app/(app)/prevencion/capacitaciones/actions.ts:85-89`
- `app/(app)/prevencion/equipos/actions.ts:44-49`
- `app/(app)/prevencion/incidentes/actions.ts:52-57`

Problema:

`describeActiveRestrictions()` devuelve un warning; capacitaciones, equipos e incidentes lo muestran como mensaje opcional y lo ignoran si falla. El comentario del servicio dice que no hay mapping curso/tarea -> restriccion, por lo que no se bloquea automaticamente.

Impacto:

Una restriccion medica activa no impide asignar capacitaciones, registrar operacion de equipo o crear incidente asociado. Puede ser correcto como MVP, pero no cumple una expectativa fuerte de prevencion de riesgos si la restriccion debe condicionar trabajo critico.

Solucion sugerida:

Crear una matriz de restricciones vs cargos/tareas/equipos. Definir reglas bloqueantes y reglas solo informativas. Convertir el warning en bloqueo cuando corresponda y registrar override auditado si se permite continuar.

### P2-03 - Export de stock/matriz EPP exige `faena`, pero la UX no maneja claramente el caso sin faenas

Donde:

- `app/(app)/prevencion/epp/matriz/page.tsx:28-36`
- `app/(app)/prevencion/epp/stock/page.tsx:25-40`
- `app/api/prevencion/epp/matriz/export/route.ts:20`
- `app/api/prevencion/epp/stock/export/route.ts:20`

Problema:

Las paginas eligen `selectedWorksiteId` desde la primera faena visible. Si el usuario tiene permiso pero scope vacio, el export href puede quedar con `faena=` y la API devuelve "Faena requerida". La UI deberia mostrar un estado vacio operativo y ocultar/deshabilitar export/crear cuando no hay faenas.

Impacto:

Errores evitables para usuarios con permisos mal asignados o sin faena activa.

Solucion sugerida:

Normalizar un componente "Sin faenas asignadas" en Prevencion y ocultar acciones dependientes de faena cuando `selectedWorksiteId` es undefined.

### P2-04 - Falta cobertura de actions para los bypasses encontrados

Donde:

- Tests existentes pasaron, pero faltaba cobertura negativa para `comites`, `signPermit`, worker-faena en varios servicios y Biblioteca SST persistente. `documentacion` legacy ahora tiene guardarrail de ausencia.
- `lib/__tests__/prevention-documents-library.test.ts` cubre schemas, no persistencia real de update/link/confidencialidad.

Problema:

La suite actual valida flujos felices y algunos scopes, pero no los casos que una app multi-faena necesita proteger.

Solucion sugerida:

Agregar tests PGlite por familia:

- mutaciones hijas no cruzan faenas;
- trabajador no pertenece a faena seleccionada;
- documentos sensibles requieren permiso especializado en update;
- update de Biblioteca no puede mover documento fuera del scope;
- `registerAlcoholTestAction` espera el servicio y propaga errores.
- la superficie legacy `/prevencion/documentacion` y `prevention:legal_docs:*` no reaparecen.

## Funciones faltantes o incompletas

### F-01 - Firma del operador en reportes diarios de equipo existe en servicio, no en UI/action

Estado 2026-07-01: corregido en esta pasada.

Archivos modificados:

- `lib/services/prevention-equipment.ts`
- `app/(app)/prevencion/equipos/actions.ts`
- `app/(app)/prevencion/equipos/reportes/reporte-list.tsx`
- `lib/__tests__/prevention-ola2.test.ts`
- `lib/__tests__/prevention-equipment-actions.test.ts`

Donde:

- `lib/services/prevention-equipment.ts:67-78`
- `app/(app)/prevencion/equipos/actions.ts:1-110`
- `app/(app)/prevencion/equipos/reportes/reporte-list.tsx:133-144`

Problema:

Existe `signEquipmentReport(reportId, workerId, scope)`, pero no hay action ni control UI para que el operador firme. La lista solo permite aprobar como gestion.

Solucion sugerida:

Agregar `signEquipmentReportAction()`, control visible segun regla de negocio y prueba de scope. Si la firma es publica/QR, separarla de permisos internos y validar token.

### F-02 - Sanitizacion de equipos/instalaciones existe en servicio, no tiene action/UI/export propio

Donde:

- `lib/services/prevention-equipment.ts:164-190`
- `app/(app)/prevencion/equipos/actions.ts:1-110`

Problema:

`createSanitizationControl()` y `listSanitizationControls()` existen, pero no hay ruta visible ni action. El usuario no puede registrar o revisar esos controles desde Prevencion.

Solucion sugerida:

Crear subvista bajo `/prevencion/equipos/sanitizacion` o integrar una pestaña en Equipos, con acciones de crear/listar/vencer y export XLSX.

### F-03 - Politicas de ciclo de vida EPP existen, pero no son gestionables desde el modulo

Estado 2026-07-01: corregido parcialmente en esta pasada.

Archivos modificados:

- `app/(app)/prevencion/epp/matriz/actions.ts`
- `lib/__tests__/prevention-epp-actions.test.ts`

Detalle de cierre:

- Corregido: existe action server-side para gestionar la politica de vida util EPP con permiso y validacion.
- Pendiente UI: falta formulario visible para editar `lifespanDays`, `maxReuses` y `inspectionChecklist` desde el panel.

Donde:

- `lib/services/prevention-epp-matrix.ts:85-110`
- `app/(app)/prevencion/epp/matriz/epp-matriz-panel.tsx:71-84`

Problema:

`setEppLifecyclePolicy()` determina vencimientos de entregas EPP, pero no hay UI/action para configurarlo. El panel permite matriz y entregas; no politicas de vida util, reusos o checklist de inspeccion.

Solucion sugerida:

Agregar administracion de politicas por producto EPP y mostrar impacto en entregas vencidas. Sin esto, los vencimientos dependen de seed/tests o carga externa.

### F-04 - Comites CPHS tiene asistencia en servicio, pero no hay action/UI

Donde:

- `lib/services/prevention-committees.ts:71-77`
- `app/(app)/prevencion/comites/actions.ts:1-90`

Problema:

`recordMeetingAttendance()` existe, pero no esta expuesto. Las reuniones pueden agendarse y tener acuerdos, pero no cerrar asistencia desde la interfaz.

Solucion sugerida:

Agregar action con scope y UI en detalle de comite/reunion. Validar que la reunion pertenece a un comite en scope.

### F-05 - Protocolos MINSAL muestra catalogo, no cumplimiento por trabajador

Donde:

- `app/(app)/prevencion/salud/protocolos/page.tsx:18-53`
- `lib/services/prevention-health.ts:175-181`

Problema:

La pagina de protocolos lista el catalogo MINSAL. El servicio tiene `getDueProtocols(workerId, scope)`, pero no hay vista por trabajador/faena ni alertas de vencimiento agregadas.

Solucion sugerida:

Crear vista de cumplimiento por trabajador/faena, con vencidos/proximos y filtros. Enlazar con restricciones/aptitudes.

## UI/UX e inconsistencias

### UX-01 - Breadcrumbs fuera de `PageHeader`

Donde:

- `app/(app)/prevencion/capacitaciones/matriz/page.tsx:31-32`
- `app/(app)/prevencion/biblioteca/page.tsx:98-110`
- `app/(app)/prevencion/biblioteca/[id]/page.tsx:112-120`
- tambien aparece en `emergencias`, `inspecciones`, `salud/protocolos`, `biblioteca/revisiones`, `biblioteca/vencimientos` y otros.

Problema:

El repo ya usa el patron `PageHeader breadcrumb={...}` en muchas pantallas, pero varias paginas de Prevencion renderizan `<Breadcrumbs />` como contenido separado antes del header.

Impacto:

Inconsistencia visual y mas espacio muerto, especialmente en pantallas operativas densas.

Solucion sugerida:

Migrar breadcrumbs al prop `breadcrumb` del `PageHeader` en todas las paginas del modulo.

### UX-02 - Formularios con selector trabajador + faena no filtran siempre por dependencia

Donde:

- Capacitaciones, incidentes, equipos, alcotest y observaciones comparten el bug de integridad trabajador-faena descrito en P1-05.

Problema:

Aunque varias paginas cargan trabajadores por scope, los formularios pueden enviar combinaciones trabajador/faena incoherentes. La UI deberia filtrar trabajadores al cambiar faena y el backend debe rechazar combinaciones invalidas.

Solucion sugerida:

Usar un selector dependiente: al elegir faena, mostrar solo trabajadores de esa faena. En backend, validar siempre.

### UX-03 - Pantallas de catalogo muestran datos crudos

Donde:

- `app/(app)/prevencion/salud/protocolos/page.tsx:42-49`

Problema:

`appliesToPositions` se renderiza con `JSON.stringify`, no como lista legible de cargos. Esto degrada lectura y parece una vista tecnica.

Solucion sugerida:

Mapear cargos a etiquetas humanas, mostrar chips compactos y agregar resumen de cumplimiento/vencimientos.

### UX-04 - Acciones primarias no siempre tienen el mismo nivel jerarquico

Donde:

- Muchas pantallas modernas ya usan `PageHeader actions`.
- Algunos flujos mantienen acciones contextuales dentro de listas o secciones, como "Registrar entrega" en matriz EPP (`app/(app)/prevencion/epp/matriz/epp-matriz-panel.tsx:71-84`).

Problema:

No todo debe ir al header, pero las acciones primarias de pagina deberian ser predecibles. En algunos submodulos la accion principal esta en header, en otros escondida en una seccion secundaria.

Solucion sugerida:

Definir por pantalla una accion primaria de pagina y dejar acciones de subseccion solo cuando dependan de contexto local. En desktop, usar `PageHeader actions` para crear/exportar principales.

## Observaciones positivas

- Exports de Prevencion revisados usan XLSX, no CSV.
- SST tiene validacion explicita de trabajador contra faena al crear evaluaciones.
- PPA aplica scope en listados, detalle, review, cierre y revocacion.
- IPER valida scope tanto en matriz como en items.
- Biblioteca SST ya tiene versionado, audit log, validacion de magic bytes y rutas de descarga con registro de vista/descarga.
- Las pruebas focalizadas de la auditoria inicial pasaron: 47/47.
- Tras el lote de remediacion, las nuevas regresiones focalizadas pasan: 39/39.
- Tras el lote 2, las regresiones de documentacion legacy y links pasaron: 13/13.
- Tras el lote 3, las regresiones de firma de equipo y lifecycle EPP pasan: 19/19.
- Tras el lote 4, `documentacion` legacy queda retirada como app/API/servicio/permiso/validacion y cubierta por test canónico; la suite focalizada acumulada queda en 47/47 y `typecheck` pasa.

## Plan sugerido de remediacion

1. Corregido: P1-01 (`await` en alcotest) y test de action.
2. Corregido: P1-03 y P1-04 con scope en entidades hijas de Comites y Permisos.
3. Corregido: validacion trabajador-faena en capacitaciones, incidentes, equipos, alcotest e inspecciones.
4. Cerrado: `documentacion` legacy retirada sin compatibilidad temporal; Biblioteca SST queda como unica superficie documental.
5. Corregido: Biblioteca SST ya valida update de `worksiteId`, permisos de confidencialidad y links a entidades verificables.
6. Agregar tests PGlite negativos multi-faena.
7. Parcialmente corregido: firma de reportes y action lifecycle EPP expuestas. Siguen pendientes sanitizacion, UI lifecycle EPP, asistencia CPHS y cumplimiento MINSAL.
8. Hacer una pasada de UI compacta: breadcrumbs en header, estados sin faena, selectors dependientes y cargos legibles.

## Estado final de esta auditoria

Se modifico codigo fuente para cerrar los P1 accionables P1-01, P1-03, P1-04, P1-05, P1-06 y P1-07, avanzar sobre P2-01, y cerrar P1-02 retirando `documentacion` legacy sin compatibilidad temporal. El worktree ya estaba sucio antes de esta remediacion, incluyendo cambios en migraciones/schema/biblioteca; esta pasada no intento revertir ni normalizar esos cambios.

Queda pendiente sanitizacion, UI lifecycle EPP, asistencia CPHS, cumplimiento MINSAL, reglas bloqueantes de restricciones medicas, estados sin faena, pasada UI/UX P4 y, si se desea limpieza fisica completa, migracion generada para eliminar tablas legacy de documentacion.
