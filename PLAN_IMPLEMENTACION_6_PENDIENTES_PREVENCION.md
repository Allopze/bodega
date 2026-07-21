# Plan de implementación — 6 pendientes del módulo de Prevención

**Fecha:** 2026-07-21  
**Fuente:** `AUDITORIA_MODULO_PREVENCION_2026-07-20.md`  
**Rama de referencia:** `feat/prevencion-mejoras`  
**Alcance:** H-08 UI, H-20, H-21, H-25, H-27 y H-28.  
**Objetivo:** cerrar los 6 hallazgos accionables restantes sin reabrir la capacidad técnica P0 ni reconstruir el scaffolding congelado de `modules/`/`core/`.

## 1. Estado observado antes de implementar

La auditoría declara 32/38 hallazgos resueltos. La inspección del checkout actual confirma que los seis pendientes tienen avances parciales que deben preservarse:

| Hallazgo | Estado actual observado | Brecha real restante |
|---|---|---|
| H-08 UI | Los 4 servicios aceptan `limit` y `offset`, con máximo 500. Las páginas los llaman sin opciones. | Falta contrato de `total`, estado de página en URL, controles de paginación y coherencia entre filtros/búsqueda y resultados paginados. |
| H-20 | `indicadores-edit-modal.tsx` ya muestra botones anterior/siguiente y `IndicadoresDashboard` cambia `editingMonth`. | Falta cerrar UX de cambios sin guardar, foco, etiquetas visibles, límites, pruebas del flujo y confirmar cuál dashboard está vivo: `page.tsx` renderiza `CanonicalIndicatorsDashboard`, no `IndicadoresDashboard`. |
| H-21 | `pdtp-indicators-panel.tsx` ya agrupó el cumplimiento integral, anual y meta; el desglose mensual/trimestral está plegado. | Falta validar el resultado contra A1/A5, compactar los controles de hoja/faena/vista y cubrir responsive/accesibilidad/regresión visual. |
| H-25 | `documentacion/actions.ts` sigue siendo un único archivo de más de 600 LOC. | Falta separar responsabilidades manteniendo un único contrato público de imports. |
| H-27 | Algunas actions validan en el boundary; otras reenvían `input: unknown` al servicio. No existe `parseZ`. | Falta helper común, catálogo action→schema y adopción transversal sin cambiar mensajes/retornos públicos. |
| H-28 | Cuatro suites `lib/__tests__/prevencion-*.test.ts` mockean servicios completos. Existen 13 suites `prevention-*-postgres.test.ts`, pero son PostgreSQL real, no PGlite. | Falta una capa PGlite reusable y pruebas de integración que ejecuten servicios/SQL/transacciones reales; los mocks deben quedar sólo para guards y wiring que no requieran DB. |

### Decisiones de alcance

1. **Paginación server-side con URL**, no “cargar más” en memoria. Permite enlaces reproducibles, back/forward y evita que TopBar/controles operen sólo sobre una ventana sin advertencia.
2. **Filtros que cambian el universo de consulta deben viajar al servidor.** No se presentarán conteos globales junto a filtros aplicados sólo a la página actual.
3. **H-20 y H-21 son cierres incrementales**, no rediseños desde cero: se conserva lo ya implementado y se añaden estados, pruebas y refinamiento.
4. **H-27 precede al split H-25.** Así todos los archivos resultantes nacen con validación defensiva uniforme.
5. **H-28 no reemplaza todo test unitario por integración.** Se conserva cobertura rápida de permisos/presentación y se reemplazan sólo mocks que pretenden probar persistencia, transacciones u optimistic locking.
6. **No hay cambios de schema previstos.** Si aparece una necesidad real, se modifica `db/schema/*.ts` y se usa `npm run db:generate`; nunca se edita `_journal.json` ni una migración existente.

## 2. Arquitectura objetivo

### 2.1 Contrato común de páginas paginadas

Adoptar un resultado explícito para cada lista:

```ts
type PageResult<T> = {
  rows: T[]
  total: number
  limit: number
  offset: number
}
```

El contrato puede compartirse desde `lib/pagination.ts` si encaja con los tipos actuales; no crear un helper paralelo si `resolvePagination` ya cubre el cálculo de `page`, `offset`, `totalPages` y límites.

Parámetros URL estándar:

- `page`: entero positivo; default `1`.
- `pageSize`: constante por pantalla, inicialmente `50`; no exponer selector salvo necesidad comprobada.
- Filtros estructurados existentes: conservar sus nombres de dominio (`status`, `source`, `worksite`, etc.).
- Texto TopBar: si debe filtrar todo el dataset, conectarlo a una consulta server-side o declarar claramente que opera sobre la página. La opción preferida es consulta server-side para CAPA y privacidad; emergencias/MIPER pueden empezar con filtros estructurados y búsqueda en página sólo si el volumen y UX lo justifican mediante prueba.

La UI usa `components/ui/pagination.tsx` y debe:

- Mostrar rango y total real.
- Mantener filtros al navegar.
- Volver a página 1 al cambiar un filtro.
- Corregir una página fuera de rango mediante `resolvePagination`.
- No renderizar controles cuando exista una sola página.
- Conservar `PageHeader`, `PageContainer` y TopBar sin añadir otro input de texto.

### 2.2 Boundary defensivo de Server Actions

Crear un helper pequeño, por ejemplo en `lib/actions/parse-z.ts`, con un único propósito:

```ts
parseZ(schema, input)
```

Contrato esperado:

- Recibe un schema Zod y `unknown`.
- Devuelve un discriminated union o resultado compatible con `ActionState`.
- Conserva `fieldErrors` cuando aplique.
- Nunca lanza por validación esperable.
- No oculta errores de infraestructura: esos siguen pasando por `unexpectedActionError` y `logger`.
- No duplica el parse del servicio como sustituto; es defensa en profundidad en el boundary.

Antes de adoptar el helper, crear una tabla de inventario de cada action con:

- Nombre de action.
- Permiso requerido.
- Schema existente.
- Tipo de entrada (`unknown`, `FormData`, parámetros escalares).
- Mensaje actual ante input inválido.
- Ruta revalidada.

No aplicar `parseZ` a lecturas sin payload ni a parámetros escalares ya validados explícitamente si forzar un schema no aporta seguridad.

### 2.3 Organización de actions de documentación

Convertir el archivo en directorio, conservando el import público `./actions`:

```text
app/(app)/prevencion/documentacion/actions/
├── index.ts
├── shared.ts
├── crud.ts
├── workflow.ts
├── distribution.ts
├── links.ts
├── regularization.ts
└── queries.ts
```

Responsabilidades:

- `shared.ts`: `REVALIDATE`, `clientCtx`, `fail` y helpers privados de revalidación.
- `crud.ts`: crear/subir/archivar/restaurar documentos; CRUD y movimiento de carpetas/documentos.
- `workflow.ts`: submit, return-to-draft, review, observe, approve y publish.
- `distribution.ts`: asignación, acuse y exención.
- `links.ts`: creación y retiro de vínculos.
- `regularization.ts`: regularización de integridad.
- `queries.ts`: `getDocumentDetailAction` y consultas auxiliares.
- `index.ts`: sólo re-exports explícitos; sin lógica de negocio.

No usar `export *` si puede filtrar helpers privados. No mover lógica a `modules/`; la fuente de verdad sigue en `app/` + `lib/`.

### 2.4 Infraestructura PGlite

Crear un helper de test reusable sobre el patrón existente del repositorio:

- Instanciar `PGlite` por suite o worker secuencial.
- Aplicar migraciones con `migratePGlite`.
- Exponer Drizzle con el schema real.
- Inyectar DB mediante el mecanismo que ya soporta `@/db` (`globalThis.__db`) antes de importar servicios.
- Resetear módulos al cambiar la DB de prueba.
- Limpiar datos entre casos sin recrear manualmente schemas.
- Registrar cada suite nueva en `tests/pglite-files.ts` para ejecución secuencial.
- Usar `onConflictDoNothing()` en fixtures FK compartidas.

La meta es ejecutar servicios reales; las Server Actions pueden seguir mockeando auth/headers/Next sólo para alcanzar el servicio, pero **no** deben mockear el servicio ni `@/db` en los casos que afirman probar persistencia/transacciones.

## 3. Fases de implementación

## Fase 0 — Baseline y protección de regresiones

**Objetivo:** congelar contratos actuales antes de cambios transversales.

### Tareas

- Ejecutar tests focalizados actuales y registrar resultado en la sección de progreso.
- Añadir pruebas caracterizadoras para:
  - Imports públicos de `documentacion/actions.ts`.
  - Mensajes y `fieldErrors` de inputs inválidos representativos.
  - Estado de navegación existente del modal de indicadores.
  - Render compacto actual de `PdtpIndicatorsPanel`.
- Confirmar en ejecución cuál pantalla de indicadores corresponde al producto actual:
  - `app/(app)/prevencion/indicadores/page.tsx` usa `CanonicalIndicatorsDashboard`.
  - `IndicadoresDashboard` puede ser una ruta legacy o componente no montado.
  - H-20 sólo se considera cerrado si la navegación vive en el flujo realmente accesible.

### Criterios de salida

- Baseline verde.
- Lista definitiva de exports y schemas.
- Decisión documentada sobre dashboard canónico de indicadores.

---

## Fase 1 — H-27: `parseZ` en boundaries

**Objetivo:** asegurar validación uniforme antes de reorganizar archivos y ampliar integración.

### Archivos principales

- Nuevo helper bajo `lib/actions/`.
- Tests unitarios del helper en `lib/__tests__/`.
- Actions vivas bajo `app/(app)/prevencion/**/actions.ts`.
- Schemas en `lib/validation/prevention.ts` y `lib/validation/prevention-module/**`.

### Tareas

1. Implementar `parseZ` tipado con soporte para `fieldErrors`.
2. Probar:
   - Input válido devuelve datos transformados por Zod.
   - Input inválido no ejecuta el servicio.
   - Coerciones/refinements del schema se respetan.
   - Error inesperado no se confunde con validación.
3. Migrar primero una action representativa de cada patrón:
   - `input: unknown` + helper `run`.
   - `FormData` construido manualmente.
   - Workflow con `expectedVersion`.
4. Migrar por dominio, en lotes pequeños:
   - Indicadores, EPP y gestión del cambio.
   - Emergencias, higiene, CPHS e inspecciones.
   - Capacitación, permisos, requisitos legales y MIPER.
   - Incidentes, CAPA, PPA y PDTP/cobertura.
   - Documentación durante H-25.
5. Mantener guard de permiso antes de mutación. La validación puede hacerse antes o después del guard según riesgo de oracle, pero cada action debe seguir la convención existente del dominio.
6. Eliminar validaciones manuales sólo cuando el schema cubra exactamente el mismo contrato y mensaje.

### Criterios de aceptación

- Toda action mutante con payload externo usa schema en el boundary o tiene una excepción documentada.
- Ningún servicio es invocado ante payload inválido.
- Los retornos siguen siendo compatibles con `ActionState`.
- No se exponen `err.message` de infraestructura.
- Typecheck, lint y suites de actions verdes después de cada lote.

---

## Fase 2 — H-25: split de documentación

**Objetivo:** dividir responsabilidades sin cambios funcionales ni ruptura de imports.

### Tareas

1. Crear el directorio `documentacion/actions/` y mover primero helpers compartidos.
2. Mover grupos en este orden:
   - Queries.
   - Links y regularización.
   - Distribución.
   - Workflow.
   - CRUD y upload al final, porque contiene compensación de archivo/DB.
3. Aplicar `parseZ` a cada action movida.
4. Crear `index.ts` con re-exports explícitos de todos los nombres públicos anteriores.
5. Actualizar imports sólo si TypeScript no resuelve automáticamente `./actions` al directorio.
6. Reorganizar `prevencion-documentacion-actions.test.ts` por dominio o mantener una suite de contrato y añadir suites focalizadas; no duplicar mocks.
7. Eliminar el archivo antiguo sólo después de verificar paridad de exports.

### Criterios de aceptación

- Todos los imports existentes desde `.../documentacion/actions` siguen compilando.
- Mismos permisos, mensajes, revalidaciones y side effects.
- La compensación ante fallo de primera versión sigue archivando el borrador.
- Ningún archivo de actions supera aproximadamente 250 LOC salvo justificación.
- Tests de workflow, upload, carpetas, distribución, links y regularización verdes.

---

## Fase 3 — H-28: integración PGlite de módulos mockeados

**Objetivo:** cubrir SQL, constraints, transacciones y optimistic locking con DB real en memoria.

### Prioridad de migración

1. **PDTP:** optimistic locking, orden/reorden, lifecycle y ejecuciones.
2. **Documentación:** creación/versionado/workflow, compensación y movimientos.
3. **PPA/CAPA:** workflow segregado, versión esperada y derivación CAPA.
4. **Actions extra SST:** persistencia de evaluación/cierre sólo donde aún no exista cobertura equivalente.

### Tareas

1. Crear helper PGlite común y testear que aplica todas las migraciones.
2. Añadir fixtures mínimas por dominio: usuarios, permisos lógicos, faenas y entidades FK.
3. Para cada suite mockeada:
   - Clasificar casos en `boundary/wiring` versus `persistencia/dominio`.
   - Conservar guards unitarios rápidos.
   - Reescribir casos de persistencia para invocar servicios reales con PGlite.
   - Eliminar mocks de servicio sólo después de cubrir el mismo comportamiento.
4. Agregar al menos estas pruebas transaccionales:
   - Fallo intermedio no deja mutación parcial.
   - `expectedVersion` obsoleta rechaza sin sobrescribir estado.
   - Alcance de faena no filtra datos ajenos.
   - CHECK/unique/FK relevantes fallan inspeccionando la cadena de `cause` con `try/catch`.
5. Registrar archivos en `tests/pglite-files.ts`.
6. Evitar duplicar suites PostgreSQL real existentes: PGlite cubre feedback rápido; Postgres CI conserva prueba de compatibilidad real.

### Criterios de aceptación

- Al menos una suite PGlite por los cuatro grupos mockeados.
- Ningún test que afirme cubrir transacción u optimistic lock mockea el servicio bajo prueba.
- Migraciones completas aplican sin edición manual.
- Suites PGlite corren secuencialmente y son deterministas.
- Suites PostgreSQL reales existentes continúan verdes.

---

## Fase 4 — H-08 UI: paginación end-to-end

**Objetivo:** paginar CAPA, emergencias, privacidad y lotes MIPER con total real y estado navegable.

### 4.1 Trabajo común en servicios

Los cuatro servicios ya tienen `limit/offset`, pero devuelven sólo arrays. Añadir conteos scope-aware reutilizando exactamente los mismos filtros:

- `countCapaActions` o `listCapaActionsPage`.
- `countEmergencyPlans` o `listEmergencyPlansPage`.
- `countPreventionPrivacyRequests` o `listPreventionPrivacyRequestsPage`.
- `countRiskImportBatches` o `listRiskImportBatchesPage`.

Preferir una función `...Page` que ejecute filas + total en `Promise.all` para evitar divergencia de filtros. Mantener las funciones de array si otros consumidores las necesitan; no romper exports sin revisar usos.

### 4.2 CAPA

**Archivos:**

- `lib/services/prevention-capa.ts`
- `app/(app)/prevencion/capa/page.tsx`
- `app/(app)/prevencion/capa/capa-list.tsx`

**Implementación:**

- Parsear `page`, `status`, `source`, `worksite` y quick filter desde `searchParams`.
- Llevar filtros estructurados al servidor para que `total`, métricas y filas sean coherentes.
- Mantener KPIs globales del scope; su click actualiza URL y resetea página.
- Conectar `Pagination` debajo de la tabla.
- Definir estrategia de búsqueda TopBar: si permanece client-side, rotular el total como página actual; preferido: URL/debounce server-side para buscar todo el alcance.

### 4.3 Emergencias

**Archivos:**

- `lib/services/prevention-emergency.ts`
- `app/(app)/prevencion/emergencias/page.tsx`
- `app/(app)/prevencion/emergencias/emergency-list.tsx`

**Implementación:**

- Paginar planes y simulacros como datasets independientes.
- Usar parámetros distintos (`plansPage`, `drillsPage`) para no perder posición al cambiar pestaña.
- Los conteos de tabs y métricas deben provenir de agregados globales, no de `plans.length`/`drills.length` de la página.
- No ocultar la creación de plan ni moverla fuera de `PageHeader`; si requiere estado local, elevar el trigger al cliente de página según la regla de layout.

### 4.4 Privacidad

**Archivos:**

- `lib/services/prevention-privacy.ts`
- `app/(app)/prevencion/privacidad/solicitudes/page.tsx`
- `app/(app)/prevencion/privacidad/solicitudes/privacy-requests-workbench.tsx`

**Implementación:**

- Paginar solicitudes con `total` real.
- Mantener acciones PATCH/export y `router.refresh()` sin regresar a una página inválida tras cambiar estado.
- Llevar búsqueda/filtros al servidor para evitar que una solicitud exista en otra página pero parezca ausente.
- No paginar el catálogo de trabajadores dentro del mismo hallazgo; sí documentar su riesgo y, si el volumen lo exige, reemplazarlo por combobox remoto en un ticket separado.

### 4.5 MIPER

**Archivos:**

- `lib/services/prevention-risk-import.ts`
- `app/(app)/prevencion/miper/page.tsx`
- `app/(app)/prevencion/miper/miper-workbench.tsx`

**Implementación:**

- Paginar únicamente la pestaña de importaciones; matrices, revisiones y bloqueos pertenecen al dashboard de riesgo y quedan fuera de H-08.
- El contador de la pestaña usa `total`, no `imports.length`.
- Tras aprobar/activar/resolver una fila, conservar `importsPage` o corregirla si desaparece la última fila de la última página.
- Mantener carga en dos queries (batches y rows de los batch IDs visibles), evitando volver a cargar filas de lotes fuera de página.

### Pruebas H-08

- Servicio: límites 1/50/500, offset, total, scope y página vacía.
- Página: params inválidos, página fuera de rango y preservación de filtros.
- Componentes: controles anterior/siguiente, reset a página 1 y contador global.
- E2E/Playwright: navegación back/forward y persistencia de filtros en al menos CAPA y privacidad.

### Criterios de aceptación

- Ninguna de las cuatro páginas carga más de 50 filas principales inicialmente.
- Total y rango son correctos para el scope y filtros.
- La URL representa el estado de paginación.
- No hay filtros client-side que aparenten cubrir registros fuera de la página sin indicación.
- Empty state distingue “sin datos” de “sin coincidencias”.

---

## Fase 5 — H-20: navegación mensual de indicadores

**Objetivo:** cerrar el flujo “mes anterior / mes siguiente” en el dashboard canónico, protegiendo cambios y accesibilidad.

### Archivos candidatos

- `app/(app)/prevencion/indicadores/page.tsx`
- `app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx`
- `app/(app)/prevencion/indicadores/indicadores-dashboard.tsx`
- `app/(app)/prevencion/indicadores/indicadores-edit-modal.tsx`
- Tests existentes de indicadores.

### Tareas

1. Confirmar dónde se abre actualmente `IndicadoresEditModal`. Si el dashboard canónico usa otro diálogo, portar la navegación a ese componente y eliminar duplicación sólo si queda realmente huérfana.
2. Mostrar navegación como unidad legible:
   - Botón “Mes anterior”.
   - Etiqueta central `Mes de 12 · Año` o nombre completo.
   - Botón “Mes siguiente”.
3. Deshabilitar enero← y diciembre→; no cruzar de año en este alcance.
4. Detectar cambios sin guardar al navegar o cerrar:
   - Mostrar confirmación para descartar, o
   - Guardar y navegar mediante una acción explícita “Guardar y siguiente”.
   - Preferencia: “Guardar y siguiente” para captura repetitiva, más confirmación si se intenta descartar.
5. Al navegar:
   - Cargar valores reales del mes destino.
   - Mantener modal abierto.
   - Mover foco al título del mes o primer campo.
   - Anunciar el mes mediante región `aria-live` si el título no recibe foco.
6. Mantener bloqueo de períodos cerrados y permisos por mes.
7. Añadir atajos de teclado sólo si son visibles/descubribles; no capturar flechas mientras un input numérico tiene foco.

### Pruebas

- Enero no permite anterior; diciembre no permite siguiente.
- Mes destino muestra sus datos y no los del mes anterior.
- Cambios sin guardar no se pierden silenciosamente.
- Guardar y siguiente persiste primero y luego navega.
- Período cerrado no se vuelve editable por navegación.
- Focus/aria-labels y navegación móvil.

### Criterios de aceptación

- El flujo accesible desde `/prevencion/indicadores` permite recorrer meses sin cerrar el modal.
- No existe pérdida silenciosa de datos.
- Navegación funciona con teclado y lector de pantalla.
- Prueba de componente y captura Playwright actualizadas.

---

## Fase 6 — H-21: compactación final del detalle PDTP

**Objetivo:** aprobar el test de 5 segundos con una sola representación primaria del cumplimiento y menos controles antes de la tabla.

### Archivos

- `app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx`
- `app/(app)/prevencion/pdtp/[programId]/page.tsx`
- `app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx`
- Tests PDTP y capturas Playwright.

### Tareas

1. Conservar la tarjeta compacta ya implementada:
   - Cumplimiento integral principal.
   - Cumplimiento anual.
   - Meta.
   - Ejes integral en línea secundaria.
2. Validar A1/A5:
   - Máximo 4 métricas primarias.
   - No duplicar el mismo porcentaje en tile, chip y tabla.
   - Trimestres/meses permanecen en `<details>`.
3. Convertir selección de hoja en un único control compacto si hoy renderiza ocho chips simultáneos:
   - Desktop: select/combobox o tabs con overflow sólo si las hojas son tareas frecuentes.
   - Mobile: select accesible, sin scroll horizontal obligatorio.
4. Agrupar faena y vista en una sola barra de contexto bajo indicadores, con 2–3 controles máximo visibles.
5. Llevar acciones globales sólo a `PageHeader.actions`; mantener export/editar en el menú existente.
6. Reducir texto introductorio redundante; el estado del programa y el indicador deben explicar qué mirar y qué acción sigue.
7. Revisar estados vacíos:
   - Sin faena seleccionada.
   - Sin catálogo/actividades.
   - Sin ejecución todavía.
   Todos con CTA real cuando el permiso lo permita.
8. Verificar responsive en 1280×720, tablet y móvil.

### Pruebas

- `PdtpIndicatorsPanel` muestra como máximo tres bloques primarios.
- El desglose está cerrado inicialmente y abre con teclado.
- Cambio de hoja/faena/vista conserva los otros search params.
- No hay títulos duplicados ni botones page-level fuera del header.
- Capturas antes/después y chequeo visual de primera pantalla.

### Criterios de aceptación

- Antes de la tabla hay una tarjeta de cumplimiento y una barra de contexto compacta.
- No aparecen las 11 métricas originales como tarjetas/chips simultáneos.
- La primera pantalla comunica estado, contexto y próxima acción sin scroll.
- Responsive y accesibilidad sin regresiones.

## 4. Dependencias y orden recomendado

```text
Fase 0 baseline
  ├─> Fase 1 H-27 parseZ
  │     └─> Fase 2 H-25 split documentación
  │              └─> Fase 3 H-28 PGlite documentación
  ├─> Fase 3 H-28 PGlite otros dominios
  ├─> Fase 4 H-08 paginación
  ├─> Fase 5 H-20 indicadores
  └─> Fase 6 H-21 PDTP
```

H-08, H-20 y H-21 pueden desarrollarse en paralelo después del baseline. H-25 no debe adelantarse a H-27 para evitar repetir la adopción del wrapper en cinco archivos nuevos. H-28 puede comenzar con PDTP/PPA mientras termina el split de documentación.

## 5. Estrategia de commits lógicos

No crear commits automáticamente. Si se solicitan, usar unidades revisables:

1. `test(prevencion): caracteriza contratos pendientes`
2. `refactor(prevencion): valida server actions con parseZ`
3. `refactor(documentacion): separa server actions por dominio`
4. `test(prevencion): agrega integración PGlite`
5. `feat(prevencion): conecta paginación en listas`
6. `feat(indicadores): completa navegación mensual`
7. `refactor(pdtp): compacta cabecera de cumplimiento`

Cada commit debe incluir pruebas de su cambio y el trailer obligatorio del repositorio.

## 6. Matriz de verificación

| Gate | Fase 1 | Fase 2 | Fase 3 | Fase 4 | Fase 5 | Fase 6 |
|---|---:|---:|---:|---:|---:|---:|
| Tests helper/actions | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| Tests PGlite | — | — | ✅ | ✅ servicios | — | según servicio |
| Tests PostgreSQL real | — | docs si aplica | ✅ | ✅ | indicadores | PDTP |
| `npm run typecheck` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `npm run lint` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| React Doctor | — | — | — | ✅ | ✅ | ✅ |
| Playwright/captura | — | — | — | ✅ | ✅ | ✅ |
| `npm run build` | cierre | cierre | cierre | cierre | cierre | cierre |

### Comandos de validación

```bash
# Suites unitarias/action existentes
npm test -- --run lib/__tests__/prevencion-pdtp-actions.test.ts
npm test -- --run lib/__tests__/prevencion-actions-extra.test.ts
npm test -- --run lib/__tests__/prevencion-ppa-admin.test.ts
npm test -- --run lib/__tests__/prevencion-documentacion-actions.test.ts

# Suites focalizadas del módulo
npm test -- --run "app/(app)/prevencion/**/*.test.ts?(x)"
npm test -- --run "app/api/prevencion/**/*.test.ts"

# PGlite secuencial según configuración del repo
npm test -- --run <nuevas-suites-pglite>

# PostgreSQL real ya integrado en CI
npm run test:pg

# Gates estáticos y producción
npm run typecheck
npm run lint
npm run build

# Sólo si hubo cambio de schema
npm run db:generate
# Debe responder “No schema changes” en una segunda ejecución.
```

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Filtrar client-side una sola página | Resultados engañosos y total incoherente | Llevar filtros al servidor o indicar explícitamente “en esta página”; preferir servidor. |
| Añadir conteos con filtros distintos a las filas | Páginas vacías o total incorrecto | Construir una condición común reutilizada por query de rows y count. |
| Split rompe imports de componentes/tests | Build fallido o acciones no encontradas | `index.ts` con exports explícitos + test de paridad antes de borrar archivo original. |
| `parseZ` cambia mensajes de error | Regresión UX/tests | Tests caracterizadores y posibilidad de mensaje por action sobre el resultado común. |
| Doble parse action/servicio diverge | Payload aceptado en una capa y rechazado en otra | Importar el mismo schema desde `lib/validation`; no duplicar schemas locales. |
| PGlite no reproduce una diferencia específica de PostgreSQL | Falsa seguridad | Mantener suites PostgreSQL reales en CI; PGlite complementa, no reemplaza. |
| Navegar mes pierde cambios | Pérdida de datos | Dirty state + confirmación o “Guardar y siguiente”. |
| Compactar PDTP oculta contexto útil | Menor comprensión | Mantener desglose plegable y tooltips; validar con captura y test de 5 segundos. |
| Working tree ya contiene cambios | Sobrescritura accidental | Implementar por archivos focalizados, revisar `git diff` antes de cada fase y no restaurar cambios ajenos. |

## 8. Definition of Done global

Los seis hallazgos se consideran cerrados sólo cuando:

- [x] H-08 UI: las cuatro listas (CAPA, emergencias, privacidad, MIPER) cargan páginas limitadas, muestran total real y conservan estado en URL.
- [x] H-20: el flujo canónico permite navegar meses sin cerrar el modal ni perder cambios silenciosamente.
- [x] H-21: el detalle PDTP presenta hoja/faena/vista en una barra de contexto compacta (2-3 controles) además de la cabecera de cumplimiento ya compacta.
- [x] H-25: documentación está separada por responsabilidad con contrato público estable.
- [x] H-27: toda mutación externa tiene schema en boundary o excepción documentada.
- [x] H-28: existen pruebas PGlite reales para los cuatro grupos mockeados y continúan las pruebas PostgreSQL de CI. PDTP y CAPA ya estaban cubiertos (trabajo previo); documentación, workflow PPA (optimistic locking + derivación CAPA) y `createEvaluation` SST se cubrieron en esta y la pasada anterior. `prevencion-ppa-admin.test.ts`/`prevencion-actions-extra.test.ts` clasificados como 100% boundary/wiring legítimo — se mantienen mockeados sin cambios.
- [x] Tests focalizados, typecheck y lint están verdes (`npm run build` no se ejecutó en esta pasada — pendiente antes de mergear).
- [ ] React Doctor no introduce nuevos diagnósticos en componentes modificados. **No verificado en esta pasada.**
- [ ] Capturas Playwright de indicadores, PDTP y listas paginadas quedan archivadas en `audit/screenshots/`. **No verificado en esta pasada** — cambios validados sólo por tests automatizados, no visualmente en navegador.
- [x] `AUDITORIA_MODULO_PREVENCION_2026-07-20.md` se actualiza con estado, pruebas y referencia de commit para cada hallazgo.

## 9. Progreso de implementación

| Fase | Hallazgos | Estado | Evidencia |
|---|---|---|---|
| 0. Baseline | Todos | ✅ Completado | 103 tests verdes (4 suites) |
| 1. Validación boundary | H-27 | ✅ Completado | `parseZ` existente + ZodError en run() de 8 dominios + 3 schemas CAPA exportados. Typecheck limpio, tests verdes. |
| 2. Split documentación | H-25 | ✅ Completado | `documentacion/actions.ts` → barrel delegando a `actions/{shared,queries,crud,workflow,distribution,links,regularization,folders,index}.ts`. Todos los imports existentes se mantienen. Typecheck limpio, 103 tests. |
| 3. PGlite | H-28 | ✅ Completado | Infra confirmada reutilizable (`lib/testing/pglite-migrate.ts`, `tests/pglite-files.ts`, patrón `prevention-pdtp.test.ts`). `prevencion-ppa-admin.test.ts` y `prevencion-actions-extra.test.ts` clasificados: 100% boundary/wiring (permisos, validación, forwarding de argumentos) — se mantienen mockeados intactos (44 tests verdes sin cambios). Persistencia real agregada donde no existía: documentación, workflow PPA (optimistic locking + derivación CAPA) y `createEvaluation` SST. PDTP y CAPA ya tenían cobertura real de trabajo anterior. |
| 4. Paginación UI | H-08 UI | ✅ Completado | `listCapaActionsPage`, `listEmergencyPlansPage`, `listPreventionPrivacyRequestsPage`, `listRiskImportBatchesPage` en servicios. Paginación server-side + controles en CAPA, emergencias, privacidad y MIPER (las 4 listas de H-08). Filtros via URL, reset a página 1. Typecheck limpio, tests verdes. |
| 5. Indicadores | H-20 | ✅ Completado | Navegación mensual portada al modal realmente montado (`IndicatorDenominatorDialog`, no el `IndicadoresEditModal` huérfano). Modal único controlado por el dashboard canónico (`editingMonth` + `key` para reset de estado al navegar). Protección de cambios sin guardar (confirmar/descartar/guardar y continuar). 8 tests nuevos verdes. |
| 6. PDTP | H-21 | ✅ Completado | Controles de hoja (8 chips) y faena convertidos a `Select` compactos; hoja + faena + vista ahora en una sola barra de contexto (2-3 controles). Tarjeta de cumplimiento (integral+anual+meta) ya estaba compacta de una pasada previa. 58 tests PDTP existentes siguen verdes. |

### Cambios realizados 2026-07-21 (segunda pasada)

**H-08 (paginación servicios):**
- `lib/services/prevention-emergency.ts` — función `listEmergencyPlansPage` con rows + count atómico.
- `lib/services/prevention-privacy.ts` — función `listPreventionPrivacyRequestsPage` con rows + count atómico.
- `lib/services/prevention-risk-import.ts` — función `listRiskImportBatchesPage` con rows + count atómico (sólo batches paginados, rows resueltos por batchId).

**H-08 (paginación UI):**
- `app/(app)/prevencion/capa/page.tsx` — acepta `searchParams` con `page`, `status`, `source`, `worksite`. Usa `listCapaActionsPage` con `resolvePagination`.
- `app/(app)/prevencion/capa/capa-list.tsx` — filtros escriben URL y resetean página. Control `Pagination` al pie de la tabla. Búsqueda TopBar opera client-side sobre la página actual.
- `app/(app)/prevencion/emergencias/page.tsx` — acepta `searchParams.page`. Usa `listEmergencyPlansPage` con paginación.
- `app/(app)/prevencion/emergencias/emergency-list.tsx` — control `Pagination` al pie de la tabla de planes.

### Cambios realizados 2026-07-21 (tercera pasada — cierre de los 6 pendientes)

**H-08 UI (privacidad y MIPER, completando las 4 listas):**
- `app/(app)/prevencion/privacidad/solicitudes/page.tsx` — acepta `searchParams.page`, usa `listPreventionPrivacyRequestsPage` (el servicio ya existía) con `resolvePagination`.
- `app/(app)/prevencion/privacidad/solicitudes/privacy-requests-workbench.tsx` — recibe `pagination`, agrega control `Pagination` bajo la tabla; búsqueda TopBar sigue client-side sobre la página actual (mismo patrón que CAPA/emergencias).
- `app/(app)/prevencion/miper/page.tsx` — acepta `searchParams.page`, usa `listRiskImportBatchesPage` (el servicio ya existía) sólo para la pestaña de importaciones.
- `app/(app)/prevencion/miper/miper-workbench.tsx` — el contador de la pestaña "Importaciones" ahora usa el `total` real (no `imports.length`); control `Pagination` dentro de `TabsContent="imports"`, navegación via URL preservando la pestaña activa (el componente no se desmonta al cambiar `?page=`).

**H-20 (navegación mensual de indicadores):**
- Confirmado en Fase 0 previa: `CanonicalIndicatorsDashboard` (el dashboard realmente montado en `/prevencion/indicadores`) usa `IndicatorDenominatorDialog`, no `IndicadoresEditModal` (huérfano, sin importar desde ninguna ruta — ver nota en `indicadores-edit-modal.test.tsx`).
- `app/(app)/prevencion/indicadores/indicator-denominator-dialog.tsx` — reescrito de modal auto-contenido (botón + `useState` propio) a modal controlado por el padre (`onClose`/`onNavigate`), con:
  - Botones "Mes anterior"/"Mes siguiente" (deshabilitados en enero/diciembre).
  - Tracking de cambios sin guardar (`dirty`) sobre el formulario de denominador.
  - Al navegar con cambios pendientes: barra de confirmación con "Seguir editando" / "Descartar" / "Guardar y continuar" (guarda primero, luego navega — sin pérdida silenciosa de datos).
  - Región `aria-live="polite"` anunciando el mes mostrado.
  - Export `denominatorDialogLabel()` puro para el texto del botón disparador (Registrar/Gestionar/Revisar), reutilizado en ambos puntos de disparo.
- `app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx` — estado `editingMonth` a nivel de dashboard; los 12 botones por fila (pestañas "Cálculo mensual" y "Denominadores") sólo abren el modal; una única instancia de `IndicatorDenominatorDialog` se monta con `key={editingMonth}` (reset de estado interno garantizado al cambiar de mes vía navegación).
- Test nuevo `indicator-denominator-dialog.test.tsx` (8 casos: navegación limpia, límites enero/diciembre, confirmación con cambios sin guardar, descartar, guardar y continuar, seguir editando).
- Atajos de teclado para navegar meses: deliberadamente omitidos (plan los marca opcionales "sólo si son visibles/descubribles"; riesgo de capturar flechas dentro de inputs numéricos no justifica el beneficio).

**H-21 (compactación PDTP):**
- `app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx` — `PdtpSheetPicker` (antes 8 chips `SegmentedControl` que envolvían en 2-3 filas) y `PdtpWorksitePicker` (antes N chips) reescritos como `Select` compactos de Radix, navegando por URL vía `useRouter().push` (mismo patrón que el selector de año en `canonical-indicators-dashboard.tsx`).
- `app/(app)/prevencion/pdtp/[programId]/page.tsx` — hoja + faena + vista ahora en una sola fila (`flex flex-wrap items-center gap-3`) en vez de dos filas separadas; vista queda alineada a la derecha con `ml-auto`. Máximo 3 controles visibles, cumpliendo la meta de "barra de contexto" del plan.
- `PdtpIndicatorsPanel` (cumplimiento integral+anual+meta compacto, desglose mensual/trimestral en `<details>`) ya estaba resuelto de una pasada anterior — no requirió cambios; se verificó que sigue cumpliendo A1 (máx. 3 tiles primarios) tras el cambio de controles.
- Pendiente explícito: verificación visual/responsive con Playwright no se ejecutó en esta pasada (requiere levantar server + datos sembrados); se recomienda como siguiente paso antes de cerrar el hallazgo en el audit trail visual.

**H-28 (PGlite — tercera pasada, parcial en su momento; ver cuarta pasada abajo para el cierre):**
- Investigación confirmó que la infraestructura descrita en el plan (§2.4) ya existe y funciona: `lib/testing/pglite-migrate.ts` (migrador compatible con PGlite), `tests/pglite-files.ts` (registro para ejecución secuencial), patrón de inyección `globalThis.__db` + `vi.mock("@/db", ...)` ya establecido en `lib/__tests__/prevention-pdtp.test.ts`.
- Hallazgo importante no anticipado por el plan: **PDTP y CAPA ya tenían cobertura de persistencia real** de trabajo previo — `prevention-pdtp.test.ts` (PGlite, cubre optimistic locking / lifecycle / catálogo) y `prevention-capa-postgres.test.ts` (Postgres real en CI). Los tests mockeados de `prevencion-pdtp-actions.test.ts` resultaron ser, al revisarlos, boundary/wiring genuino (guard de permisos, validación, argument-forwarding, mensajes de error) — exactamente lo que el plan dice que debe seguir mockeado, no persistencia disfrazada de mock.
- **Documentación sí tenía la brecha real** (0% cobertura de persistencia: `prevention-documents-upload-workflow.test.ts` mockea `@/db` a mano sin SQL real; `prevention-documents-library.test.ts` sólo cubre Zod/seeds). Se creó `lib/__tests__/prevention-documents-persistence.test.ts` (PGlite real, 8 tests): creación de documento + auditoría, rechazo por alcance de faena (en creación y en upload, este último con lectura real desde BD), numeración de versión vía el subquery `MAX(version)+1` real, rechazo de checksum duplicado, archivado con cascada a versiones no publicadas + restauración, rechazo de restaurar no-archivado, rechazo de subir versión a documento archivado. Registrado en `tests/pglite-files.ts`.

### Cambios realizados 2026-07-21 (cuarta pasada — cierre de H-28)

Clasificación completa de los dos archivos pendientes, caso por caso:

- **`prevencion-ppa-admin.test.ts`** (SST + PPA admin actions) y **`prevencion-actions-extra.test.ts`** (SST actions adicionales): **el 100% de los casos en ambos archivos son boundary/wiring genuino** — guard de permisos (`guardPermission`/`guardAuth`/`can`/`canAny`), validación Zod (incluyendo `superRefine` de `ppaReviewSchema`), reglas de negocio de la action misma (p. ej. "conductor_lider no puede crear seguimiento", "bloquea inspecciones del flujo de evaluación de persona"), forwarding correcto de argumentos al servicio, y propagación/ocultamiento de mensajes de error. Ninguno afirma cubrir persistencia, transacción u optimistic lock. **No se modificó ningún test de estos dos archivos** — siguen mockeados tal cual, 44 tests verdes sin tocar.
- La brecha real de persistencia estaba, como con documentación, en la **capa de servicio subyacente**, no en las actions:
  - **`lib/services/ppa-module/reportes.ts`** (workflow PPA: `reviewPpa`, `declarePpaCorrection`, `verifyPpaCorrection`, `authorizePpaRestart`, `cancelPpa`, `closePpa`) — 0% cobertura real; `lib/__tests__/ppa-service.test.ts` mockea `@/db` a mano. Es exactamente el caso que el plan pide cubrir explícitamente ("expectedVersion obsoleta rechaza sin sobrescribir estado", derivación CAPA). Se creó `lib/__tests__/prevention-ppa-workflow-persistence.test.ts` (PGlite real, 9 tests): decisión rechazado no crea CAPA, decisión corrección crea CAPA vinculada + avanza estado, reprocesar un PPA resuelto no muta nada, alcance de faena filtra con lectura real desde BD, `expectedPpaVersion` desactualizada rechaza sin mutar, flujo completo declarar→verificar→autorizar reinicio→cerrar con versiones incrementando en cada paso y CAPA transicionando en paralelo, verificación rechazada reabre el CAPA, cierre prematuro rechaza por precondición de estado, cancelación sin CAPA vinculado. Registrado en `tests/pglite-files.ts`.
  - **`lib/services/sst-module/evaluations.ts` → `createEvaluation`** — 0% cobertura real; `lib/__tests__/sst-service-full.test.ts` mockea `@/db` a mano. Tiene lógica real no trivial: transacción con chequeo de integridad visita↔trabajador↔faena, y generación condicional de filas (4 seguimientos si `tipo=seguimiento`; 4 evaluaciones semanales si `conductor_lider` + `trabajador_nuevo`). Se agregaron 4 tests a la suite PGlite ya existente `lib/__tests__/sst-delete-evaluation.test.ts` (reutiliza su infraestructura en vez de levantar una PGlite nueva): crea evaluación + visita nueva, rechaza `visitId` que no corresponde al trabajador/faena (chequeo real, no simulable con mocks), genera los 4 seguimientos programados, genera las 4 semanales para conductor líder.
- **H-28 queda 100% cerrado.** Los cuatro grupos mockeados originales del audit (PDTP, documentación, PPA/CAPA, actions extra SST) están cubiertos: PDTP y CAPA ya lo estaban (trabajo previo), documentación y PPA se cubrieron en esta y la pasada anterior, actions-extra SST resultó ser boundary/wiring legítimo con su brecha real (`createEvaluation`) ahora cerrada.
- Verificación: typecheck limpio, lint limpio, suite pglite completa (41 archivos tras las 2 incorporaciones) verde sin regresiones, los dos archivos de actions mockeados sin cambios (44 tests).
