# Auditoría de fixes — simplificación de capacitación

**Fecha:** 2026-09-14

**Alcance:** catálogo predefinido de capacitaciones, ocurrencias por faena, marcado hecha/no hecha, evidencias privadas, historial, exportación, integración PDTP, permisos, navegación, ciclo de vida de faenas y documentación relacionada.

## Resultado ejecutivo

La implementación quedó cubierta por typecheck, lint acotado, pruebas unitarias y pruebas PGlite. El modelo nuevo reemplaza el alta libre por 20 actividades del catálogo 2026 y conserva el historial de evidencias y cambios de estado.

No quedan bugs funcionales confirmados dentro del alcance ejercitado de forma determinista. Esto no es una certificación de release: el servidor de E2E no llegó a iniciar y no hubo recorrido autenticado de navegador ni migración/UAT contra PostgreSQL de staging o producción.

## Correcciones auditadas

| Área | Evidencia revisada | Resultado |
|---|---|---|
| Catálogo | `lib/prevention/training-occurrences-catalog.ts`, `db/schema/prevention/training-occurrences.ts`, migración `0291_training_occurrences_simplification.sql` | 20 actividades versionadas, con periodicidad y mapeos PDTP explícitos; ocurrencias únicas por catálogo/faena/período. |
| Estado e historial | `lib/services/prevention-training-occurrences.ts`, acciones de `app/(app)/prevencion/capacitacion/actions.ts` | La transición a hecha exige evidencia activa; no hecha no queda confundida con pendiente; la corrección de una hecha anula la evidencia activa pero conserva su historial. Hay control de versión y bloqueo de fila. |
| Evidencia | `lib/validation/evidence-contract.ts`, `lib/storage/config.ts`, `app/api/prevencion/capacitacion/evidence/route.ts`, `app/api/prevencion/capacitacion/evidence/[name]/route.ts` | Validación de tamaño, extensión, MIME y firma; almacenamiento privado; descarga con autorización, `no-store` y `nosniff`. Se aceptan PDF, DOCX/XLS/XLSX, JPG y PNG. |
| Faenas | `lib/services/worksite-lifecycle.ts`, `app/(app)/admin/faenas/actions.ts`, `app/api/combustibles/import/route.ts`, `db/seed.ts` | El catálogo se provisiona al crear/reactivar faenas y durante seed/importación, de forma idempotente. Las faenas inactivas quedan consultables como histórico y no reciben mutaciones operativas. |
| PDTP | `lib/services/pdtp/fulfillment.ts`, `lib/services/pdtp/accreditation.ts`, `lib/services/pdtp-adapters/fulfillment-contract-2026.ts` | Las actividades mapeadas generan eventos durables, soportan acreditación automática y revocación/reintento; se preservó el destino legacy de campañas para N88 y actividades históricas. |
| UI y navegación | `app/(app)/prevencion/capacitacion/page.tsx`, `training-occurrence-list.tsx`, `modules/prevention/manifest.ts` | La pantalla usa `PageHeader`/`PageContainer`, búsqueda del `TopBar`, filtros por faena y pestañas de estado; la carga de evidencia parcial informa qué se guardó y evita duplicar archivos; el enlace histórico distingue evidencias reemplazadas/anuladas. |
| Exportación | `lib/services/prevention-training-export.ts`, `app/api/prevencion/capacitacion/export/route.ts` | Exportación Excel con ocurrencias, catálogo y evidencia histórica; se mantienen hojas legacy con prefijo histórico para no perder trazabilidad. |

## Clasificación de hallazgos

### Bugs de producto confirmados

Ninguno confirmado después de los checks deterministas finales y la revisión estática del flujo nuevo.

### Hallazgos funcionales e inconsistencias

- **S2 — Compatibilidad pendiente de decisión:** `/prevencion/campanas` todavía permite CRUD histórico si se accede por bookmark. La navegación visible apunta a `/prevencion/capacitacion` y los registros históricos no se eliminan. Retirarlo totalmente requiere decidir cómo migrar o cerrar esos registros.
- **S3 — Alcance de archivos:** “documentos” está implementado como DOCX/XLS/XLSX; no se incluyeron `.doc`, `.odt` ni formatos de imagen como HEIC. Si el requisito de negocio significa cualquier documento/foto, hay que ampliar el contrato de formatos y sus firmas MIME.
- **S3 — Límite de request:** el servicio limita cada archivo, pero conviene verificar explícitamente el límite del body para requests multipart chunked antes de exponerlo a internet.

### UI/UX

No se detectó una regresión confirmada en el código revisado. La verificación visual e interactiva quedó pendiente porque `test:e2e` no alcanzó a levantar el servidor.

### Oportunidades de mejora

- **S3 — Limpieza de almacenamiento:** el archivo se escribe antes de confirmar la transacción para evitar una fila sin archivo; una caída del proceso entre ambos pasos puede dejar un archivo huérfano. Conviene agregar una tarea de reconciliación/retención para detectar y limpiar huérfanos de forma segura.
- **S3 — Progreso de carga:** la UI sube varios archivos secuencialmente para poder informar cargas parciales sin duplicarlas; una futura cola con progreso por archivo mejoraría la experiencia cuando se adjunten varias fotos.
- **S4 — Estado reservado:** el modelo y la vista distinguen evidencia `replaced`, pero el flujo actual sólo crea `active` y corrige a `annulled`. Conviene eliminar ese estado si no habrá reemplazo explícito o agregar la transición en una iteración posterior.

### Automatización y cobertura

- **S2 — E2E bloqueada antes del navegador:** el build de Next/Turbopack falló resolviendo módulos Node (`fs`, `net`, `perf_hooks`, `tls`) de `postgres`, con trazas existentes hacia `app/(print)/bodega/guias/[id]/print/pdf/route.ts` y el dashboard. No se ejecutaron rutas, pasos autenticados, assertions, consola ni red en navegador.
- **S3 — Lint global bloqueado fuera del alcance:** `npm run lint` falla en los archivos no versionados de tooling documental `scripts/discover-docs-knowledge.mjs` y `scripts/dump-docs-registry.ts` (`no-unused-vars` y `no-explicit-any`). El lint explícito de los archivos de capacitación, servicios, schema, API, tests y navegación pasa sin warnings.
- **S3 — React Doctor global:** `npm run doctor` reporta 49/100 y 857 hallazgos del repositorio completo. El alcance cambiado reportó 92/100 y “No issues found”; los hallazgos globales no se atribuyen a esta feature.
- **S4 — Red/entorno:** los primeros intentos sandbox de `tsx`, Docker y Doctor tuvieron restricciones de IPC, Docker o DNS; los checks aplicables se repitieron con el entorno autorizado. Esto no se interpreta como bug de producto.

### Consola y red

No hay errores de consola ni fallos de red observados en navegador porque no hubo sesión de navegador ejecutable. El fallo E2E fue de build/server startup, no una respuesta HTTP del flujo de capacitación.

## Checks ejecutados

| Check | Resultado |
|---|---|
| `npm run db:generate` | PASS — no hubo cambios de schema pendientes. |
| `npm run db:verify-migrations` | PASS — 292 migraciones; checksums verificados; migración 0291 registrada. |
| `npm run typecheck` | PASS. |
| lint acotado al cambio | PASS con `--max-warnings=0`. |
| `npm run check:secrets` | PASS. |
| `npm run check:security-audit` | PASS con el allowlist vigente. |
| `npm run test:fast` | PASS — 706 archivos, 7.308 tests; 30 archivos y 314 tests omitidos por el propio suite. |
| `npm run test:pglite` | PASS — 164 archivos, 1.890 tests. |
| `npm run test:e2e` | INCOMPLETO — build del servidor falló antes de Playwright. |
| `npm run doctor` | INCOMPLETO para certificación global — deuda preexistente; scope changed PASS 92/100. |
| `git diff --check` y `git diff --cached --check` | PASS. |

## Cobertura de rutas y pasos

El recorrido de navegador cubrió **0 rutas y 0 pasos**, porque el servidor no inició. Las pruebas deterministas sí ejercitaron las acciones, servicios, esquema PGlite, RBAC, navegación, exportación, contrato de evidencia y conciliación PDTP. No se afirma cobertura total de rutas, modales, estados condicionales ni producción.

## Recomendaciones priorizadas

1. **S1:** aplicar `0291_training_occurrences_simplification` en una base PostgreSQL de staging y ejecutar UAT autenticado en `/prevencion/capacitacion`: faena activa/inactiva, hecha con evidencia, no hecha, corrección con historial, descarga por permisos, exportación y reintento PDTP.
2. **S2:** corregir el límite server/client que impide iniciar E2E por la inclusión de `postgres` en el bundle de navegador/dashboard y volver a ejecutar Playwright.
3. **S2:** resolver la decisión de ciclo de vida de `/prevencion/campanas`: mantenerlo explícitamente como legacy de solo lectura o migrar/cerrar su CRUD.
4. **S3:** confirmar con negocio el catálogo de formatos y ampliar validadores si se requieren `.doc`, `.odt`, HEIC u otros.
5. **S3:** separar o corregir el tooling documental no versionado para recuperar el lint global y planificar la deuda del React Doctor.

## Estado de entrega

Los cambios están en el worktree local y no se hizo commit, push ni despliegue. Se conservaron cambios preexistentes/no relacionados del worktree, incluidos los archivos de tooling documental que provocan el fallo global de lint.
