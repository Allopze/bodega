# Auditoría integral CHOME

**Corte:** 2026-09-12  
**Alcance:** repositorio y entorno local/efímero. No se modificó código ni se realizaron pruebas sobre producción.

## Veredicto

🔴 **No apta para pasar a preproducción todavía.**

Existen tres bloqueadores S1: dos dependencias vulnerables en runtime y un Excel de conciliación financiera que omite su hoja principal. Además, la suite E2E no es actualmente una puerta de release reproducible.

## Resumen ejecutivo

| Dimensión | Nota |
|---|---:|
| Funcionalidad | 72 |
| Integridad de datos | 76 |
| Seguridad | 61 |
| UX y accesibilidad | 73 |
| Rendimiento | 68 |
| Arquitectura y mantenibilidad | 66 |
| Calidad de pruebas | 54 |
| Preparación operacional | 55 |
| **Global** | **64/100** |

### Evidencia positiva

- `npm run typecheck`: pasó.
- `npm run lint`: pasó.
- `npm run test:fast`: 658 archivos y 6.812 pruebas pasadas; 30 archivos y 313 pruebas omitidas.
- `npm run test:pglite`: 132 archivos y 1.582 pruebas pasadas.
- `node scripts/verify-migration-chain.mjs`: 268 migraciones verificadas.
- Navegación pública, control de sesión y login local desktop/móvil sin errores de consola ni recursos fallidos observados.

### Límite de pruebas E2E

La ejecución extensa se detuvo de forma controlada tras 45,1 minutos por repetición de timeouts de la misma familia de pruebas. Resultado: **366 passed, 31 failed, 3 skipped, 126 not run y 1 interrupted**. Por tanto, no constituye una certificación de release.

## Hallazgos S1 — Bloquean release

### S1-01 — Excel DTE de conciliación omite los datos de conciliación

- **Impacto:** el archivo puede descargarse sólo con la hoja “Calidad de la referencia”, sin la conciliación OC–Factura–DTE ni las discrepancias.
- **Evidencia:** la definición del reporte agrega una hoja suplementaria, pero el generador reemplaza la hoja principal cuando recibe `sheets`. E2E falló al buscar la hoja y sus filas.
- **Causa raíz:** `lib/reports/export-module/dte-conciliacion.ts` entrega sólo la hoja secundaria en `sheets`; `lib/reports/export-module/excel-builder.ts` usa esas hojas en vez de incluir también la primaria.
- **Remediación:** construir explícitamente `[hojaPrincipal, hojaCalidad]` y agregar una regresión que valide ambas hojas y la columna de discrepancia.
- **Esfuerzo:** bajo. **Prioridad:** inmediata.
- **Validación requerida:** prueba determinista del workbook, descarga Playwright y revisión del contenido.

### S1-02 — `sharp@0.35.3` vulnerable en procesamiento de archivos no confiables

- **Impacto:** riesgo alto al procesar imágenes manipuladas.
- **Evidencia:** `npm audit --omit=dev` reportó el advisory alto GHSA-rgj7-g3m4-5g8c. La versión vulnerable es una dependencia directa. El endpoint TAE tokenizado recibe imágenes y ejecuta `sharp(buffer).metadata()`.
- **Alcance:** carga de evidencia TAE y otros procesos de imagen.
- **Remediación:** actualizar a `sharp@0.35.4` o superior, reconstruir la imagen de producción y repetir pruebas de carga y validación.
- **Esfuerzo:** bajo. **Prioridad:** inmediata.
- **Límite:** no se intentó explotar la vulnerabilidad.

### S1-03 — `maplibre-gl@5.19.0` con advisory crítico de XSS

- **Impacto:** dependencia de cliente afectada por un advisory crítico de bypass de sanitización.
- **Evidencia:** `npm audit --omit=dev` identificó la versión directa instalada; la aplicación carga MapLibre dinámicamente.
- **Remediación:** actualizar a la versión corregida indicada por el advisory —requiere salto mayor— y validar mapas, marcadores y datos externos.
- **Esfuerzo:** medio. **Prioridad:** inmediata.
- **Límite:** no se identificó una ruta concreta de explotación en el código revisado; permanece como bloqueo de cadena de suministro.

## Hallazgos S2 — Corregir antes de estabilizar preproducción

### S2-01 — El match DTE pierde el nombre operativo del ítem de OC

- **Impacto:** una factura con línea exacta puede quedar como “Confianza baja”, degradando el ranking y aumentando revisión manual.
- **Evidencia:** la OC E2E contiene el nombre operativo “Insumo recibido sin factura E2E”; la sugerencia usa primero el nombre de catálogo “Guante E2E”. El conciliador usa correctamente el nombre libre primero. El E2E del candidato mostró `0/1` líneas vinculadas.
- **Causa raíz:** `app/(app)/compras/[id]/page.tsx` prioriza el producto de catálogo, a diferencia de `lib/services/purchasing-module/invoice-reconciliation-service.ts`.
- **Remediación:** definir una única regla de identidad de línea y reutilizarla en sugerencias y conciliación.
- **Esfuerzo:** bajo. **Prioridad:** alta.
- **Validación requerida:** unit test del candidato y E2E “Confianza alta · 1/1”.

### S2-02 — Selector de archivos no operable con teclado

- **Impacto:** una persona que navega con teclado no puede elegir archivos en el dropzone.
- **Evidencia:** `components/ui/file-dropzone.tsx` usa un `div` clickeable; el input queda oculto y fuera del orden de tabulación.
- **Remediación:** usar un `<button>` o `<label>` semántico y conservar foco, Enter y Espacio.
- **Esfuerzo:** bajo. **Prioridad:** alta.
- **Validación requerida:** Playwright con teclado y prueba de accesibilidad.

### S2-03 — Etiquetas de campos SST no asociadas a sus textareas

- **Impacto:** lectores de pantalla no anuncian correctamente “Observación” ni “Acción correctiva requerida”.
- **Evidencia:** `app/(app)/prevencion/[id]/checklist-section-item.tsx` renderiza ambas etiquetas sin relación programática con sus controles.
- **Remediación:** asociar cada `label` con su control usando `htmlFor`/`id`, o envolver correctamente el campo.
- **Esfuerzo:** bajo. **Prioridad:** alta.
- **Validación requerida:** pruebas de nombre accesible y navegación con lector de pantalla.

### S2-04 — La suite E2E no es un gate de release reproducible

- **Impacto:** fallos reales pueden quedar ocultos entre regresiones de tests; una suite roja no entrega señal de liberación.
- **Evidencia:** 31 fallos: `requestSubmit()` saltando pasos de wizard, rutas de trazabilidad antiguas, selectores ambiguos por sidebar y contenido, fixtures Excel/PDF ausentes, labels renombrados y una plantilla E2E de inspecciones no disponible.
- **Remediación:** separar fixtures de negocio de documentos reales, centralizar helpers de wizard/recepción, eliminar expectativas históricas y aislar rate-limit por prueba.
- **Esfuerzo:** medio. **Prioridad:** alta.
- **Validación requerida:** ejecución completa verde y estable en dos corridas consecutivas.

### S2-05 — Contrato de QA y documentación de operación desalineados

- **Impacto:** el proceso declarado para auditar y recuperar una liberación no es ejecutable tal como se documenta.
- **Evidencia:** `package.json` no expone `audit`, `audit:full` ni `audit:report`, aunque el contrato los declara canónicos. `qa/reports/latest.md` corresponde a una auditoría anterior. El README enlaza documentación de despliegue y testing ausente.
- **Remediación:** restaurar scripts o corregir el contrato, versionar un runbook vigente y generar reporte QA por build candidato.
- **Esfuerzo:** medio. **Prioridad:** alta.

## Hallazgos S3

### S3-01 — Rol no global sin exigencia de faena

`supervisor_terreno` es no global, pero no figura entre los roles que exigen asignación de faena. No expone datos —sin faenas el scope queda en `false`—, pero permite crear una cuenta silenciosamente inutilizable. Corregir `lib/auth/role-scope.ts` y alinear el tipo de roles.

### S3-02 — Documentación de arquitectura/RBAC desactualizada

La documentación declara conteos de roles y permisos contradictorios frente al RBAC actual. Puede inducir errores de administración y auditoría.

### S3-03 — Métrica de React Doctor contaminada por proyectos de referencia

React Doctor escanea Odoo y ERPNext además de CHOME; sus 838 hallazgos y nota 47/100 no son una métrica válida de calidad del producto hasta excluir esos árboles.

### S3-04 — Imports dinámicos de filesystem demasiado amplios

El build advierte patrones dinámicos que abarcan muchos archivos en módulos de adjuntos. Es una oportunidad de rendimiento y previsibilidad; no se midió aún impacto de usuario.

### S3-05 — Avance de programación de inspecciones pendiente de reproducción aislada

Un recorrido E2E observó que `nextDueOn` no avanzaba tras “Crear y abrir inspección”, aunque el scheduler revisado implementa ese avance. Es una finding funcional pendiente de reproducir aisladamente, no un defecto confirmado.

## S4 — Oportunidades

- Consolidar reglas de identidad de producto, variante y nombre operativo en un servicio reutilizable.
- Medir bundle y carga real de mapas/gráficos antes de optimizar imports.
- Mantener reportes de cobertura que distingan rutas descubiertas, flujos autenticados y estados condicionales.

## Top 10 priorizado

| # | Acción | Severidad |
|---:|---|---|
| 1 | Corregir workbook DTE para incluir hoja principal | S1 |
| 2 | Actualizar `sharp` y revalidar cargas | S1 |
| 3 | Actualizar MapLibre y validar mapas | S1 |
| 4 | Unificar identidad de línea para sugerencias DTE | S2 |
| 5 | Recuperar E2E como gate determinista | S2 |
| 6 | Hacer FileDropzone accesible por teclado | S2 |
| 7 | Asociar labels y textareas SST | S2 |
| 8 | Corregir scripts, reporte QA y runbooks | S2 |
| 9 | Exigir faena para `supervisor_terreno` | S3 |
| 10 | Corregir alcance de React Doctor y warnings de imports | S3 |

## Hoja de ruta

### 0–2 días

- Resolver los tres S1.
- Corregir el match DTE y agregar regresión.
- Reparar fixtures y helpers E2E repetidos.

### 3–7 días

- Corregir accesibilidad de carga y checklist.
- Alinear roles, tipos y asignación de faena.
- Restaurar contrato QA, scripts y runbook verificable.

### 2–4 semanas

- Reducir imports dinámicos amplios.
- Normalizar documentación de arquitectura y RBAC.
- Repetir auditoría local completa con E2E verde y reporte QA generado para el candidato de release.

## Límites de la auditoría

Se revisó código, pruebas y un entorno local/efímero. No se probó producción, no se expusieron credenciales y el escaneo asistido de seguridad no pudo completarse por falta de capacidad disponible. Los hallazgos de dependencias provienen de `npm audit`; los defectos funcionales marcados como confirmados cuentan con evidencia de código y/o ejecución local.
