# Auditoría Integral: Chome Solicitudes y Bodega

## 1. Resumen ejecutivo

Chome Solicitudes y Bodega es un sistema interno funcional y bastante avanzado para reemplazar flujos manuales de abastecimiento, compras, recepción, stock por faena y entrega a trabajadores. La base técnica muestra buenas decisiones: autenticación centralizada con NextAuth, RBAC refrescado desde base de datos, helpers explícitos de scope por faena, servicios transaccionales para stock/recepción/entrega, constraints de base de datos, CSP, redacción de logs, pruebas unitarias/E2E y documentación de seguridad.

La auditoría no encontró un hallazgo crítico confirmado, pero sí encontró bloqueadores altos para producción: dos brechas confirmadas de permisos en el flujo genérico de solicitudes/repuestos/servicios, un riesgo de eliminación de cotizaciones ajenas por falta de revalidación de ownership/scope, una ruta mutante fuera del modelo CSRF documentado, validación débil de archivos subidos, una falla reproducida en pruebas PGlite por migraciones y un pipeline Docker que puede publicar la etapa equivocada.

El área más sensible es RBAC/scope por faena. El sistema tiene helpers correctos (`canAccessWorksite`, `visibleWorksiteIds`, `requirePermission`), y muchas rutas los usan correctamente, pero hay rutas compartidas donde el permiso genérico `requests:*` permite operar tipos de solicitud que tienen permisos propios (`repuestos:*`, `servicios:*`). Ese patrón debe corregirse antes de producción.

Fortalezas principales observadas: `lib/services/stock.ts` concentra el movimiento de stock con transacción y guardas de stock no negativo; `lib/services/receiving.ts` y `lib/services/deliveries.ts` usan transacciones y locks para flujos críticos; `next.config.ts`, `proxy.ts` y `lib/security/csp.ts` aplican headers y CSP; `lib/logger.ts` redacciona PII; los exports revisados usan XLSX y no CSV.

Nivel de confianza de esta auditoría: alto para el código, configuración, tests y documentación revisados en el repositorio; medio para comportamiento real de despliegue, porque no se validó infraestructura productiva, proxy real, backups, volumen persistente, secretos reales ni observabilidad en operación.

## 2. Decisión de producción

🔴 No listo para producción

La decisión se basa en hallazgos confirmados, no en sospechas genéricas del stack. No se confirmó una vulnerabilidad crítica, pero sí existen hallazgos altos en RBAC y flujo de despliegue que afectan directamente permisos, evidencia de compras/cotizaciones y confiabilidad operativa.

El sistema está cerca de ser productivo en términos de arquitectura de dominio: stock por faena, kardex/movimientos, recepción y entrega tienen servicios transaccionales razonables. Sin embargo, producción no debería abrirse mientras un usuario con permisos genéricos de solicitudes pueda crear o enviar tipos de solicitud que pertenecen a módulos con permisos separados, ni mientras una cotización pendiente pueda eliminarse sin revalidar ownership y scope por faena.

También bloquea la confianza de release que una prueba focalizada falle al aplicar migraciones PGlite y que el workflow de Docker pueda publicar la etapa `build/dev` en lugar de la etapa productiva `prod`. Esto afecta directamente la capacidad de demostrar que el commit desplegado fue probado y ejecutado en condiciones equivalentes a producción.

La recomendación es ejecutar una remediación P0/P1 corta antes de producción: cerrar las brechas RBAC, arreglar el pipeline Docker, recuperar la suite de tests y habilitar pruebas de concurrencia críticas en CI con una base Postgres desechable.

## 3. Calificación global

**Calificación global:** 6/10

**Veredicto:** No listo

**Justificación de la nota:**  
El proyecto es funcional y tiene buenas bases de seguridad, dominio y transacciones, pero no puede recibir una nota mayor por la regla de la rúbrica: existen hallazgos altos confirmados en RBAC/scope y en el camino de release. La nota no baja más porque no se confirmó un hallazgo crítico, el stock y las recepciones/entregas tienen transacciones y constraints relevantes, y existe una suite amplia de pruebas/documentación. La distancia a producción parece acotada, pero los bloqueadores son reales.

## 4. Mapa técnico revisado

| Área | Archivos/carpetas revisadas | Observación |
|---|---|---|
| Auth | `app/api/auth/[...nextauth]/route.ts`, `lib/auth/auth.ts`, `lib/auth/can.ts`, `lib/auth/rbac.ts`, `lib/auth/scope.ts`, `proxy.ts` | NextAuth Credentials + JWT, rate limit, refresh de permisos desde DB y middleware de autenticación revisados. |
| RBAC / scope | `lib/auth/*`, `modules/*/manifest.ts`, `app/(app)/**/actions.ts`, rutas API, exports y servicios | Scope por faena existe y se usa ampliamente, pero se confirmaron brechas en solicitudes genéricas y eliminación de cotizaciones. |
| Server Actions | `app/(auth)/**/actions.ts`, `app/(app)/**/actions.ts`, `lib/requests/request-actions.ts` | Se revisaron acciones mutantes principales: solicitudes, aprobaciones, compras, recepción, bodega, entregas, repuestos, servicios, prevención y admin. |
| API routes | `app/api/**/route.ts`, `app/(print)/**/route.ts` | Revisadas rutas de auth, health, notifications, attachments, invoices, reportes/export, trazabilidad/export y PDFs. |
| Servicios de negocio | `lib/services/stock.ts`, `receiving.ts`, `deliveries.ts`, `item-state.ts`, `purchasing.ts`, `requests-draft.ts`, `trazabilidad-export.ts`, `rate-limit.ts` | Stock/recepción/entrega tienen transacciones y guardas fuertes; rate limit tiene carrera menor. |
| Validaciones | `lib/validation/operations.ts`, `masters.ts`, `repuestos.ts`, `servicios.ts`, `sst.ts` | Zod se usa en flujos principales; algunos permisos no se derivan del tipo validado. |
| DB schema | `db/schema/*` | Revisadas tablas de auth, requests, purchasing, stock, receiving, audit, rate limit, attachments y dominios relacionados. Hay checks e índices relevantes. |
| Migraciones | `db/migrations/*` | Se detectó incompatibilidad reproducida entre migración SQL nativa y migrador PGlite en tests. |
| Configuración | `next.config.ts`, `tsconfig.json`, `drizzle.config.ts`, `Dockerfile`, `.dockerignore`, `package.json`, `.env.example` | Headers de seguridad presentes; Docker/workflow de release tienen inconsistencias relevantes. |
| Tests | `lib/__tests__/*`, `components/__tests__/*`, `e2e/*`, `vitest.config.ts`, `playwright.config.ts` | Hay buena cobertura temática, pero una prueba focalizada falló y los tests reales de concurrencia se saltan por defecto. |
| CI/CD | `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` | CI ejecuta lint/typecheck/test/build/e2e; deploy construye imagen sin `target: prod`. |
| Documentación | `README.md`, `docs/**`, `AGENTS.md`, `CLAUDE.md`, `AUDITORIA_COMPLETA.md` | Documentación extensa, con contradicciones puntuales en Docker, CSRF y threat model. |
| Next.js local docs | `node_modules/next/dist/docs/01-app/**` | Se revisaron guías locales de Server Actions, Route Handlers y seguridad de datos antes de evaluar patrones App Router. |

Comandos de validación ejecutados durante la auditoría:

- `npm run check:secrets`: aprobado.
- `npm test -- --run lib/__tests__/auth-can.test.ts lib/__tests__/item-state.test.ts lib/__tests__/storage-config.test.ts lib/__tests__/trazabilidad-export-scope.test.ts`: tres archivos pasaron; `lib/__tests__/trazabilidad-export-scope.test.ts` falló al aplicar migración PGlite con `cannot insert multiple commands into a prepared statement`.

## 5. Hallazgos confirmados

### [RBAC-01] Solicitudes genéricas permiten operar repuestos y servicios sin permisos específicos del módulo

**Severidad:** Alto  
**Categoría:** RBAC  
**Estado:** Confirmado  
**Tipo de acción:** Código  

**Evidencia:**  
- Archivo: `lib/validation/operations.ts`
- Línea o función: `requestSchema`, aprox. líneas 35-43
- Fragmento o patrón observado: `requestType: z.enum(["epp", "otro", "repuestos", "servicios"])`
- Archivo: `app/(app)/solicitudes/actions.ts`
- Línea o función: `saveDraftAction`, aprox. líneas 29-35; `submitRequestAction`, aprox. líneas 172-211
- Fragmento o patrón observado: las acciones exigen `requirePermission("requests:create")` o `requirePermission("requests:submit")`; si `requestType` es `repuestos` o `servicios`, delegan a `persistRepuestoDraft`, `persistServiceDraft`, `submitRepuestoRequest` o `submitServiceRequest` sin exigir `repuestos:*` ni `servicios:*`.
- Archivo: `modules/repuestos/manifest.ts`, `modules/servicios/manifest.ts`
- Línea o función: manifests de permisos, aprox. líneas 5-11
- Fragmento o patrón observado: existen permisos separados `repuestos:create`, `repuestos:submit`, `servicios:create`, `servicios:submit`.

**Descripción:**  
El flujo genérico de `/solicitudes` acepta tipos `repuestos` y `servicios`, pero solo valida permisos genéricos de solicitudes. Los módulos de repuestos y servicios declaran permisos propios, por lo que la ruta compartida crea un bypass parcial del modelo RBAC modular.

**Impacto:**  
Un usuario con permiso para crear/enviar solicitudes generales puede crear o enviar solicitudes de repuestos o servicios aunque no tenga permisos específicos de esos módulos. El scope por faena sigue mitigando parte del impacto, pero el límite funcional entre módulos queda roto.

**Remediación concreta:**  
En `app/(app)/solicitudes/actions.ts`, resolver el permiso requerido según `requestType` antes de persistir o enviar:

- `epp` / `otro`: `requests:create` o `requests:submit`.
- `repuestos`: `repuestos:create` o `repuestos:submit`.
- `servicios`: `servicios:create` o `servicios:submit`.

Además, filtrar `REQUEST_TYPE_OPTS` en la UI según permisos efectivos del usuario, no solo por rol.

**Validación posterior:**  
Agregar tests de Server Actions/servicio que prueben que un usuario con `requests:create` pero sin `repuestos:create` ni `servicios:create` no puede guardar ni enviar esos tipos. Repetir para `submit`. Ejecutar `npm test` y una prueba E2E de visibilidad de opciones por permisos.

### [RBAC-02] La eliminación de cotizaciones no revalida ownership ni scope por faena

**Severidad:** Alto  
**Categoría:** RBAC  
**Estado:** Confirmado  
**Tipo de acción:** Código  

**Evidencia:**  
- Archivo: `lib/requests/request-actions.ts`
- Línea o función: `deleteQuotationAction`, aprox. líneas 259-283
- Fragmento o patrón observado: valida solo `permissions.submit`, recibe `quotationId` y `requestId`, y llama a `services.deleteQuotation(quotationId, requestId)` sin cargar la solicitud padre ni verificar `canAccessWorksite`.
- Archivo: `lib/requests/request-service.ts`
- Línea o función: `deleteQuotation`, aprox. líneas 275-292
- Fragmento o patrón observado: carga la cotización por ID, exige `status === "pending"`, verifica que la solicitud esté en `draft` o `returned`, y elimina por ID; no valida `uploadedBy`, `requesterId`, ni faena.

**Descripción:**  
La acción de eliminar cotizaciones usa un permiso funcional del módulo, pero no revalida que la cotización pertenezca al usuario, a una solicitud que pueda administrar, o a una faena visible para su sesión. El parámetro sensible `quotationId` queda demasiado confiado.

**Impacto:**  
Un usuario autenticado con permiso de envío en repuestos/servicios podría eliminar una cotización pendiente de otra solicitud si conoce o adivina el ID. Esto afecta evidencia de compra/cotización y puede cruzar límites de usuario o faena.

**Remediación concreta:**  
Cargar la solicitud padre junto con la cotización, validar que `requestId` recibido coincide con la cotización, validar `canAccessWorksite(session, request.worksiteId)` y exigir una de estas condiciones: dueño de la solicitud/cotización, permiso elevado de revisión/aprobación, o rol global autorizado. Mover esta validación a una función común para repuestos y servicios.

**Validación posterior:**  
Agregar tests que intenten borrar cotizaciones de otro usuario, otra faena y otro request ID. Deben fallar. Agregar test positivo para dueño/rol autorizado.

### [S-01] `app/api/notifications` es una ruta mutante fuera del modelo CSRF documentado

**Severidad:** Medio  
**Categoría:** Seguridad  
**Estado:** Confirmado  
**Tipo de acción:** Código / Documentación  

**Evidencia:**  
- Archivo: `docs/security/CSRF.md`
- Línea o función: aprox. líneas 7-29
- Fragmento o patrón observado: documenta que las mutaciones usan Server Actions y que `app/api/*` se reserva para handlers de solo lectura como descargas, exports, health y auth.
- Archivo: `app/api/notifications/route.ts`
- Línea o función: `POST`, aprox. líneas 37-56
- Fragmento o patrón observado: `POST` marca una o todas las notificaciones como leídas.

**Descripción:**  
La ruta de notificaciones contradice el contrato de seguridad documentado: es una mutación implementada como Route Handler sin token CSRF explícito ni validación propia de `Origin`/`Sec-Fetch-Site`. Next.js protege Server Actions con checks de origen, pero este handler no es una Server Action.

**Impacto:**  
El impacto funcional inmediato es bajo porque solo marca notificaciones como leídas. Aun así, debilita la disciplina de seguridad: si se replica este patrón en rutas mutantes más sensibles, el modelo CSRF queda inconsistente.

**Remediación concreta:**  
Mover la mutación a una Server Action o agregar una validación explícita compartida para Route Handlers mutantes: `Origin`/`Host`, `Sec-Fetch-Site`, método, content type y token si se decide usarlo. Actualizar `docs/security/CSRF.md`.

**Validación posterior:**  
Agregar test de ruta que rechace `POST` cross-site simulado y test de documentación/grep que enumere handlers mutantes permitidos.

### [S-02] Las subidas de archivos confían en el MIME declarado por el cliente

**Severidad:** Medio  
**Categoría:** Seguridad  
**Estado:** Confirmado  
**Tipo de acción:** Código  

**Evidencia:**  
- Archivo: `app/(app)/entregas/actions.ts`
- Línea o función: validación de comprobante, aprox. líneas 15 y 88-117
- Fragmento o patrón observado: `ALLOWED_PROOF_TYPES` valida `file.type` antes de escribir archivo.
- Archivo: `app/(app)/compras/invoice-actions.ts`
- Línea o función: `uploadInvoiceAction`, aprox. líneas 18-70
- Fragmento o patrón observado: valida PDF/JPG/PNG/XML por `file.type`.
- Archivo: `lib/requests/request-actions.ts`
- Línea o función: upload de cotizaciones, aprox. líneas 184-202
- Fragmento o patrón observado: valida `file.type`.
- Archivo: `app/api/attachments/[id]/route.ts`, `app/api/purchase-orders/invoices/[id]/route.ts`
- Línea o función: descargas, aprox. líneas 50-57 y 44-51
- Fragmento o patrón observado: las respuestas usan `attachment.mimeType` o `invoice.mimeType` persistido.

**Descripción:**  
El servidor acepta o rechaza archivos por el MIME reportado por el navegador. No se observó validación por magic bytes, parseo real de XML/PDF/imagen ni normalización server-side del MIME persistido.

**Impacto:**  
Un usuario autenticado podría subir contenido con bytes distintos al tipo declarado. `X-Content-Type-Options: nosniff` y la lista reducida de tipos mitigan ejecución en navegador, pero persisten riesgos de integridad documental, malware y spoofing de adjuntos.

**Remediación concreta:**  
Validar magic bytes para PDF/JPEG/PNG, parsear XML como XML, normalizar extensión y MIME en servidor, y considerar `Content-Disposition: attachment` para archivos no confiables. Evaluar antivirus/escaneo si el volumen de adjuntos crece.

**Validación posterior:**  
Agregar tests que intenten subir bytes HTML/JS con MIME PDF o PNG y esperen rechazo. Verificar que descargas devuelvan MIME normalizado.

### [S-03] El rate limit usa read-then-write y puede fallar bajo concurrencia

**Severidad:** Medio  
**Categoría:** Seguridad  
**Estado:** Confirmado  
**Tipo de acción:** Código  

**Evidencia:**  
- Archivo: `lib/services/rate-limit.ts`
- Línea o función: `recordFailure`, aprox. líneas 38-57
- Fragmento o patrón observado: primero consulta el registro, luego hace `update` o `insert`.
- Archivo: `db/schema/rate-limits.ts`
- Línea o función: definición de tabla, aprox. líneas 13-17
- Fragmento o patrón observado: `key` es primary key.

**Descripción:**  
Dos fallos simultáneos para la misma clave pueden leer ausencia de fila e intentar insertar a la vez. Esto puede producir error de clave duplicada o pérdida de conteo. No es un bypass total confirmado, pero reduce confiabilidad del control anti-fuerza bruta.

**Impacto:**  
En ráfagas de login/registro/reset, el conteo de intentos puede ser impreciso o generar errores inesperados. En producción, esto afecta seguridad defensiva y experiencia del usuario.

**Remediación concreta:**  
Reemplazar `select` + `insert/update` por un `insert ... on conflict do update` atómico que incremente `count` y calcule `lockUntil` en una sola operación, o usar un backend de rate limit con operación atómica (`INCR`).

**Validación posterior:**  
Agregar test de concurrencia que dispare N fallos simultáneos para la misma clave y confirme conteo final/lock sin errores.

### [TEST-01] Una prueba focalizada falla al aplicar migraciones PGlite

**Severidad:** Alto  
**Categoría:** Testing  
**Estado:** Confirmado  
**Tipo de acción:** Código / Configuración  

**Evidencia:**  
- Archivo: `db/migrations/0014_native_code_sequences.sql`
- Línea o función: aprox. líneas 18-53
- Fragmento o patrón observado: contiene `CREATE OR REPLACE FUNCTION ... $$;` seguido de `DO $$ ... $$;`.
- Archivo: `lib/__tests__/trazabilidad-export-scope.test.ts`
- Línea o función: setup de migración, aprox. línea 22
- Fragmento o patrón observado: ejecuta `migrate(inMemoryDb, { migrationsFolder: ... })` con PGlite.
- Comando ejecutado: `npm test -- --run lib/__tests__/auth-can.test.ts lib/__tests__/item-state.test.ts lib/__tests__/storage-config.test.ts lib/__tests__/trazabilidad-export-scope.test.ts`
- Resultado observado: `lib/__tests__/trazabilidad-export-scope.test.ts` falló con `cannot insert multiple commands into a prepared statement`.

**Descripción:**  
La migración SQL nativa no es compatible con el modo en que el migrador/PGlite ejecuta statements preparados. Esto impide ejecutar al menos una prueba de scope/export que depende de migraciones reales.

**Impacto:**  
El gate de calidad queda debilitado: una prueba de RBAC/scope de trazabilidad no puede correr en el entorno actual. Como `.github/workflows/ci.yml` ejecuta `npm run test:coverage`, esta incompatibilidad puede bloquear CI o forzar a saltarse pruebas relevantes.

**Remediación concreta:**  
Separar la migración en statements compatibles, adaptar el setup PGlite para ejecutar bloques nativos de forma segura, o mover estas pruebas a un job con PostgreSQL real. Documentar qué migraciones son incompatibles con PGlite si se mantiene esa separación.

**Validación posterior:**  
Ejecutar `npm run test:coverage` completo y confirmar que `lib/__tests__/trazabilidad-export-scope.test.ts` pasa sin skips artificiales.

### [TEST-02] Los tests reales de concurrencia de stock/recepción/entrega no corren por defecto en CI

**Severidad:** Medio  
**Categoría:** Testing  
**Estado:** Confirmado  
**Tipo de acción:** Configuración  

**Evidencia:**  
- Archivo: `lib/__tests__/stock-concurrency-postgres.test.ts`
- Línea o función: aprox. líneas 15-17
- Fragmento o patrón observado: usa `describe.skip` salvo que `STOCK_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"`.
- Archivo: `lib/__tests__/receiving-concurrency-postgres.test.ts`
- Línea o función: aprox. líneas 25-27
- Fragmento o patrón observado: usa flag equivalente para habilitar prueba destructiva.
- Archivo: `lib/__tests__/deliveries-concurrency-postgres.test.ts`
- Línea o función: aprox. líneas 25-27
- Fragmento o patrón observado: usa flag equivalente para habilitar prueba destructiva.
- Archivo: `.github/workflows/ci.yml`
- Línea o función: aprox. líneas 30-56
- Fragmento o patrón observado: define `DATABASE_URL`, pero no habilita flags destructivos; ejecuta `npm run test:coverage`.

**Descripción:**  
El repositorio contiene pruebas específicas para condiciones de carrera en stock, recepción y entrega, pero se saltan salvo configuración manual. Es razonable evitar resets destructivos en la DB equivocada, pero CI debería proveer una base desechable y ejecutar estas pruebas.

**Impacto:**  
Regresiones en las rutas más críticas del dominio pueden llegar a main sin ser detectadas automáticamente. Esto afecta stock por faena, kardex y entregas.

**Remediación concreta:**  
Crear un job de integración con PostgreSQL desechable, nombre de DB seguro y flags explícitos para esas pruebas. Mantener guardas destructivas para entornos locales, pero ejecutar en CI contra una DB efímera.

**Validación posterior:**  
Verificar que el job de CI corre los tres archivos y falla si se rompe la concurrencia de stock/recepción/entrega.

### [DEVOPS-01] El workflow Docker puede publicar la etapa equivocada

**Severidad:** Alto  
**Categoría:** DevOps  
**Estado:** Confirmado  
**Tipo de acción:** Configuración  

**Evidencia:**  
- Archivo: `Dockerfile`
- Línea o función: etapas `dev`, `prod` y `build`, aprox. líneas 3-52
- Fragmento o patrón observado: `dev` define `CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]`; `prod` define runtime standalone, usuario no root y healthcheck; la etapa final declarada es `FROM dev AS build` con `RUN npm run build`.
- Archivo: `.github/workflows/deploy.yml`
- Línea o función: `docker/build-push-action`, aprox. líneas 72-80
- Fragmento o patrón observado: no especifica `target: prod`.

**Descripción:**  
Al no indicar `target: prod`, Docker usa la última etapa del Dockerfile como imagen final. La última etapa es `build`, basada en `dev`, no la etapa productiva `prod`. Esto contradice la intención aparente del Dockerfile.

**Impacto:**  
La imagen publicada en GHCR puede ejecutar `npm run dev`, incluir dependencias/código de desarrollo y omitir el runtime endurecido con `standalone`, healthcheck y usuario no root. Es un riesgo directo de despliegue.

**Remediación concreta:**  
Reordenar el Dockerfile para que la última etapa sea `prod`, o configurar el workflow con `target: prod`. Asegurar que la etapa `prod` copie artefactos desde un builder que ejecutó `npm run build`.

**Validación posterior:**  
Construir la imagen CI con el mismo comando del workflow, correrla localmente, verificar que inicia con `node server.js`, que usa `NODE_ENV=production`, que `/api/health` responde y que no ejecuta `next dev`.

### [DEVOPS-02] La documentación de despliegue contradice Docker y GitHub Actions

**Severidad:** Medio  
**Categoría:** DevOps / Documentación  
**Estado:** Confirmado  
**Tipo de acción:** Documentación  

**Evidencia:**  
- Archivo: `Dockerfile`
- Línea o función: archivo completo
- Fragmento o patrón observado: existe un Dockerfile multietapa.
- Archivo: `.github/workflows/deploy.yml`
- Línea o función: aprox. líneas 72-80
- Fragmento o patrón observado: construye y publica una imagen Docker.
- Archivo: `docs/deploy/DEPLOY.md`
- Línea o función: aprox. líneas 75-78
- Fragmento o patrón observado: indica "No hay Dockerfile oficial".

**Descripción:**  
La documentación operacional está desactualizada frente al estado real del repositorio. Esto es especialmente peligroso porque el Dockerfile también tiene una inconsistencia de stage.

**Impacto:**  
Un operador puede seguir instrucciones incorrectas o asumir que el contenedor no es oficial mientras CI sí publica una imagen. Aumenta el riesgo de despliegues manuales divergentes.

**Remediación concreta:**  
Actualizar `docs/deploy/DEPLOY.md` con el flujo real: build target, migraciones, variables, volumen de storage, healthcheck, rollback y smoke test.

**Validación posterior:**  
Ejecutar el runbook actualizado en un entorno staging y registrar el smoke test.

### [DEVOPS-03] El despliegue productivo no está automatizado en el workflow

**Severidad:** Medio  
**Categoría:** DevOps  
**Estado:** Confirmado  
**Tipo de acción:** Infraestructura / Proceso humano  

**Evidencia:**  
- Archivo: `.github/workflows/deploy.yml`
- Línea o función: aprox. líneas 82-96
- Fragmento o patrón observado: el job de despliegue está comentado como ejemplo; el workflow real migra y publica imagen.

**Descripción:**  
El pipeline no contiene un paso activo de rollout productivo ni smoke test post-deploy. La promoción final depende de un proceso externo no verificable desde el repositorio.

**Impacto:**  
Puede haber drift entre imagen publicada, migraciones aplicadas y servicio realmente corriendo. También faltan checks automáticos de salud después de desplegar.

**Remediación concreta:**  
Agregar un job de deploy con environment protection, `needs: [migrate, build-and-push]`, smoke test a `/api/health`, rollback documentado y registro de versión desplegada.

**Validación posterior:**  
Probar un despliegue staging completo desde GitHub Actions y confirmar logs/evidencia de healthcheck post-deploy.

### [DOC-01] El threat model documenta ownership de adjuntos que el código no implementa

**Severidad:** Medio  
**Categoría:** Documentación  
**Estado:** Confirmado  
**Tipo de acción:** Documentación / Código  

**Evidencia:**  
- Archivo: `docs/security/THREAT_MODEL.md`
- Línea o función: aprox. líneas 61 y 85
- Fragmento o patrón observado: documenta validación de ownership por `userId` / `attachment.userId === session.user.id`.
- Archivo: `app/api/attachments/[id]/route.ts`
- Línea o función: descarga de adjuntos, aprox. líneas 31-42
- Fragmento o patrón observado: valida que el adjunto sea de `delivery` y que la sesión pueda acceder a `delivery.worksiteId`; no hay chequeo de owner/uploader.

**Descripción:**  
La implementación usa scope por faena para adjuntos de entregas, mientras la documentación afirma ownership por usuario. El código puede ser aceptable si la política real es visibilidad por faena, pero la documentación no describe la realidad.

**Impacto:**  
Auditores y operadores pueden creer que existe una restricción más fina que la implementada. En documentos con PII o comprobantes, esa diferencia de política importa.

**Remediación concreta:**  
Decidir política: ownership por uploader/solicitante o visibilidad por faena. Actualizar código o threat model según corresponda. Si se mantiene visibilidad por faena, documentar explícitamente que usuarios autorizados de la faena pueden ver esos comprobantes.

**Validación posterior:**  
Agregar test de descarga para usuario de la misma faena y usuario de otra faena, y alinear `docs/security/THREAT_MODEL.md`.

### [ARCH-01] La abstracción compartida de requests usa `any` y debilita contratos de permisos

**Severidad:** Medio  
**Categoría:** Arquitectura  
**Estado:** Confirmado  
**Tipo de acción:** Código  

**Evidencia:**  
- Archivo: `lib/requests/request-actions.ts`
- Línea o función: configuración y casts, aprox. líneas 12, 42-59, 106, 219, 302, 368
- Fragmento o patrón observado: `z.ZodType<any>`, servicios con `(input: any)`, casts `as any`.
- Archivo: `lib/requests/request-service.ts`
- Línea o función: helpers dinámicos, aprox. líneas 12, 95-104, 235-251, 275-292
- Fragmento o patrón observado: acceso dinámico a `(db.query as any)` y tablas/cotizaciones con casts.

**Descripción:**  
La abstracción genérica para repuestos/servicios reduce duplicación, pero borra contratos importantes: qué tipo de solicitud se está operando, qué permiso corresponde, qué faena/request padre debe validarse y qué entidad de cotización se manipula.

**Impacto:**  
Hace más difícil detectar errores como `RBAC-02` en revisión estática. Aumenta el riesgo de introducir nuevos bypasses al sumar tipos de solicitud.

**Remediación concreta:**  
Tipar la abstracción con genéricos por módulo y una interfaz explícita de servicio que reciba contexto de acceso (`session`, `worksiteId`, `requesterId`, permisos requeridos). Eliminar casts `any` en rutas mutantes.

**Validación posterior:**  
Ejecutar `npm run typecheck` y agregar tests de contrato para repuestos/servicios que fallen si falta validación de permisos/scope.

### [PERF-01] Los exports XLSX son síncronos y en memoria

**Severidad:** Mejora  
**Categoría:** Performance  
**Estado:** Confirmado  
**Tipo de acción:** Código / Infraestructura  

**Evidencia:**  
- Archivo: `lib/reports/export.ts`
- Línea o función: generación de workbook, aprox. líneas 30-59
- Fragmento o patrón observado: crea workbook completo y llama `workbook.xlsx.writeBuffer()`.
- Archivo: `app/api/reportes/export/route.ts`
- Línea o función: límite de filas, aprox. línea 20
- Fragmento o patrón observado: `MAX_EXPORT_ROWS = 10_000`.
- Archivo: `app/api/trazabilidad/export/route.ts`
- Línea o función: límite de filas, aprox. línea 13
- Fragmento o patrón observado: `MAX_TRACEABILITY_EXPORT_ROWS = 10_000`.

**Descripción:**  
La implementación cumple la regla de usar XLSX y aplica límites, pero genera el archivo completo en memoria y dentro del request HTTP.

**Impacto:**  
Para 6-50 usuarios y límites de 10.000 filas, el riesgo parece manejable. Si crece el histórico o se agregan adjuntos/detalles pesados, puede aumentar memoria y latencia.

**Remediación concreta:**  
Mantener los límites actuales, agregar métricas de duración/tamaño y evaluar export asíncrono/background job si los datos reales se acercan al límite. No migrar a CSV.

**Validación posterior:**  
Agregar prueba de performance con dataset medio y registrar tiempo/memoria. Confirmar que se devuelve `.xlsx` válido.

### [UX-01] El formulario de solicitudes filtra tipos por rol y no por permisos efectivos

**Severidad:** Medio  
**Categoría:** UX  
**Estado:** Confirmado  
**Tipo de acción:** Código  

**Evidencia:**  
- Archivo: `app/(app)/solicitudes/request-form.tsx`
- Línea o función: cálculo de tipos visibles, aprox. líneas 425-427
- Fragmento o patrón observado: filtra `REQUEST_TYPE_OPTS` por `role !== "jefe_mantencion"` para ocultar EPP, pero no usa permisos efectivos.

**Descripción:**  
La UI muestra opciones de repuestos/servicios según una regla de rol local, no según permisos RBAC reales. Esto acompaña el bypass de `RBAC-01` y generará una mala experiencia cuando el backend se corrija si la UI no se alinea.

**Impacto:**  
Usuarios pueden ver opciones que no deberían operar, o no ver opciones que sí deberían tener por grants específicos. En flujos largos, esto causa errores tardíos y soporte innecesario.

**Remediación concreta:**  
Pasar permisos efectivos del usuario al formulario y construir opciones visibles por permiso: `requests:create`, `repuestos:create`, `servicios:create`.

**Validación posterior:**  
Agregar test de componente o E2E con usuarios de permisos distintos y verificar que las opciones visibles coinciden con el servidor.

## 6. Riesgos no confirmados

### [RISK-01] Confianza en `X-Forwarded-For` depende del proxy productivo

**Categoría:** Seguridad / Infraestructura

**Motivo de sospecha:**  
El rate limit de login/registro/reset usa IP derivada de headers como `x-forwarded-for`. La seguridad real depende de que el proxy productivo sobrescriba esos headers y no acepte valores enviados por el cliente.

**Qué falta revisar:**  
Configuración real de Nginx/Cloudflare/ingress/load balancer.

**Cómo validarlo:**  
En staging, enviar requests con `X-Forwarded-For` falso desde cliente y confirmar que la app recibe solo la IP fijada por el proxy confiable.

### [RISK-02] Persistencia, backup y restauración de adjuntos no fueron verificados contra infraestructura real

**Categoría:** DevOps / Operación

**Motivo de sospecha:**  
El repositorio documenta `STORAGE_PATH` y adjuntos locales, pero la auditoría no pudo confirmar volumen persistente, backups, restauración ni retención en producción.

**Qué falta revisar:**  
Infraestructura real, mounts, política de backup, pruebas de restore y monitoreo de disco.

**Cómo validarlo:**  
Ejecutar simulacro de restore de PostgreSQL + storage de adjuntos en staging y documentar RPO/RTO.

### [RISK-03] Inmutabilidad real del audit log depende de permisos de base de datos no visibles en el repo

**Categoría:** Seguridad / DB

**Motivo de sospecha:**  
El código inserta eventos de auditoría, pero no se verificó que el rol productivo de aplicación no pueda modificar/borrar auditoría histórica, ni que exista política de retención externa.

**Qué falta revisar:**  
Grants del usuario PostgreSQL productivo, roles, backups/WAL y controles operacionales.

**Cómo validarlo:**  
Revisar grants en producción/staging y probar que el rol de app no puede `UPDATE`/`DELETE` audit logs si esa es la política deseada.

### [RISK-04] Variables y secretos reales de producción no son verificables desde el repositorio

**Categoría:** Seguridad / DevOps

**Motivo de sospecha:**  
`.env.example` no prueba valores reales. `npm run check:secrets` pasó, pero no valida fortaleza ni rotación de `AUTH_SECRET`, URLs, credenciales DB o secretos de GitHub.

**Qué falta revisar:**  
Secrets de GitHub Actions, entorno de hosting, política de rotación y permisos.

**Cómo validarlo:**  
Auditoría humana de secretos en el proveedor, rotación documentada y verificación de que no se imprimen en logs.

### [RISK-05] Accesibilidad y responsive real no fueron revalidados visualmente en navegador durante esta auditoría

**Categoría:** UX / QA

**Motivo de sospecha:**  
Existen specs E2E y de accesibilidad, pero esta revisión no ejecutó una pasada browser/screenshot completa sobre todos los flujos.

**Qué falta revisar:**  
Navegación real por teclado, contraste, focus states, responsive y estados de error/empty en flujos largos.

**Cómo validarlo:**  
Ejecutar Playwright contra rutas críticas con capturas desktop/mobile y axe/accessibility donde corresponda.

### [RISK-06] CSRF de Server Actions depende de configuración correcta de host/origin en despliegue

**Categoría:** Seguridad / Infraestructura

**Motivo de sospecha:**  
La documentación local de Next.js indica validación de `Origin` contra `Host` para Server Actions y `next.config.ts` tiene `serverActions.allowedOrigins`. La corrección real depende de dominios, proxies y headers productivos.

**Qué falta revisar:**  
Dominio final, `NEXTAUTH_URL`, headers `Host`/`X-Forwarded-Host` y configuración del proxy.

**Cómo validarlo:**  
En staging, probar Server Actions desde origen no permitido y confirmar rechazo; probar origen permitido detrás del proxy real.

## 7. Puntuación por área

| Área | Nota 1-10 | Justificación breve |
|---|---:|---|
| Seguridad | 7/10 | Auth, CSP, headers y log redaction son sólidos; quedan CSRF documental/API, MIME spoofing y rate limit concurrente. |
| RBAC / scope por faena | 6/10 | Helpers y patrón general existen, pero hay dos brechas altas confirmadas en solicitudes/cotizaciones. |
| Arquitectura | 7/10 | Separación UI/actions/services/DB razonable; la abstracción genérica con `any` debilita contratos críticos. |
| Máquina de estados | 8/10 | Hay servicio centralizado de estados y transiciones con auditoría; no se confirmó bypass mayor en esta revisión. |
| Base de datos | 7/10 | Buen uso de constraints, índices y transacciones; falta recuperar compatibilidad de migraciones con tests y validar grants productivos. |
| Performance | 7/10 | Hay límites y paginación en superficies revisadas; exports XLSX siguen siendo síncronos/en memoria. |
| DevOps | 5/10 | CI es amplio, pero Docker puede publicar stage incorrecto, deploy no está automatizado y docs están desactualizados. |
| Frontend / UX | 7/10 | UI funcional y formularios robustos; opciones de solicitud no se alinean con permisos efectivos y falta pasada visual completa. |
| Testing | 6/10 | Cobertura temática buena; prueba focalizada falla y concurrencia crítica no corre por defecto en CI. |
| Documentación | 7/10 | Documentación extensa; contradicciones en Docker, CSRF y threat model deben corregirse. |

## 8. Deuda técnica priorizada

| Prioridad | Deuda | Impacto | Esfuerzo | Recomendación |
|---|---|---|---|---|
| P0 | Cerrar bypass de permisos en `/solicitudes` para `repuestos` y `servicios` | Evita operaciones fuera del RBAC modular | Medio | Validar permisos por `requestType` en Server Actions y UI. |
| P0 | Revalidar ownership/scope al eliminar cotizaciones | Protege evidencia de compras y límites por faena/usuario | Medio | Cargar request padre, validar faena, dueño o permiso elevado. |
| P0 | Corregir Docker stage publicado por deploy | Evita ejecutar imagen dev/build en producción | Bajo | Usar `target: prod` o hacer `prod` la última etapa. |
| P0 | Recuperar suite de tests con migraciones PGlite/Postgres | Restaura confianza del gate de release | Medio | Ajustar migración o mover esos tests a Postgres real. |
| P1 | Ejecutar tests de concurrencia de stock/recepción/entrega en CI | Evita regresiones en stock y kardex | Medio | Job Postgres desechable con flags seguros. |
| P1 | Alinear CSRF docs/código para `app/api/notifications` | Mantiene invariant de seguridad | Bajo | Server Action o guard explícito en Route Handler. |
| P1 | Validar contenido real de archivos subidos | Reduce spoofing documental/malware | Medio | Magic bytes, parseo XML y MIME normalizado. |
| P1 | Actualizar runbook de despliegue y threat model | Evita operación con documentación falsa | Bajo | Documentar Docker actual, storage, adjuntos y ownership real. |
| P2 | Atomicidad de rate limit | Mejora defensa ante ráfagas concurrentes | Bajo | `onConflictDoUpdate` o backend atómico. |
| P2 | Reducir `any` en abstracciones de requests | Mejora mantenibilidad y revisión de permisos | Medio | Generics/contratos por módulo y contexto de acceso. |
| P3 | Export XLSX asíncrono si crece volumen | Mejora performance futura | Alto | Métricas primero; background jobs solo si datos lo justifican. |

## 9. Roadmap técnico recomendado

### Semana 1

- Corregir `RBAC-01`: permisos por `requestType` en `app/(app)/solicitudes/actions.ts`.
- Corregir `RBAC-02`: ownership/scope al eliminar cotizaciones.
- Agregar tests unitarios/integración para ambos hallazgos RBAC.
- Arreglar Dockerfile/workflow para publicar la etapa `prod`.
- Re-ejecutar `npm run check:secrets`, `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.

### Semanas 2-3

- Resolver incompatibilidad PGlite/migración o mover pruebas afectadas a PostgreSQL real.
- Crear job CI con Postgres desechable para concurrencia de stock, recepción y entregas.
- Mover `POST /api/notifications` a Server Action o agregar guard CSRF explícito.
- Implementar validación de magic bytes/parseo real para adjuntos, facturas y cotizaciones.
- Actualizar `docs/deploy/DEPLOY.md`, `docs/security/CSRF.md` y `docs/security/THREAT_MODEL.md`.

### Mes 1

- Endurecer rate limit con operación atómica.
- Reducir `any` en `lib/requests/request-actions.ts` y `lib/requests/request-service.ts`.
- Ejecutar auditoría browser de accesibilidad/responsive en rutas críticas.
- Validar staging con proxy real: host/origin, `X-Forwarded-For`, HSTS, healthcheck y storage persistente.

### Mes 2+

- Medir exports XLSX con datasets reales y decidir si requieren jobs asíncronos.
- Formalizar runbooks de backup/restore y simulacro periódico.
- Definir SLOs mínimos, alertas y dashboards de errores/mutaciones críticas.
- Revisar grants PostgreSQL para proteger audit logs y datos sensibles según política operacional.

## 10. Checklist de remediación inmediata

- [ ] Exigir `repuestos:create` / `repuestos:submit` cuando `requestType === "repuestos"` en el flujo genérico de solicitudes.
- [ ] Exigir `servicios:create` / `servicios:submit` cuando `requestType === "servicios"` en el flujo genérico de solicitudes.
- [ ] Filtrar tipos visibles en `request-form.tsx` por permisos efectivos, no por rol local.
- [ ] Revalidar `requestId`, faena visible, dueño o permiso elevado antes de eliminar cotizaciones.
- [ ] Agregar tests negativos de RBAC para creación/envío de repuestos/servicios desde `/solicitudes`.
- [ ] Agregar tests negativos de eliminación de cotizaciones ajenas o de otra faena.
- [ ] Corregir Dockerfile o `.github/workflows/deploy.yml` para publicar `target: prod`.
- [ ] Confirmar que la imagen resultante ejecuta `node server.js` y responde `/api/health`.
- [ ] Arreglar la migración o el harness PGlite que rompe `trazabilidad-export-scope.test.ts`.
- [ ] Habilitar tests de concurrencia críticos en un job CI con PostgreSQL desechable.
- [ ] Alinear `POST /api/notifications` con el modelo CSRF.
- [ ] Validar magic bytes/parseo real de archivos subidos.
- [ ] Actualizar documentación de Docker/deploy, CSRF y threat model de adjuntos.

## 11. Conclusión

**Calificación global:** 6/10.  
**Decisión:** 🔴 No listo para producción.

El sistema tiene fundamentos sólidos y no se confirmó un hallazgo crítico, pero los bloqueadores actuales afectan permisos, evidencia operativa, release y confianza de pruebas. Los principales puntos a corregir son el RBAC de tipos de solicitud, la eliminación de cotizaciones sin ownership/scope, el Docker stage publicado y la suite de tests/migraciones.

El siguiente paso recomendado es ejecutar la remediación P0 durante una semana corta, agregar pruebas que bloqueen regresiones y repetir una validación completa de CI/build/staging antes de reconsiderar producción.
