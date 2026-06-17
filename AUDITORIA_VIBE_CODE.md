# Auditoría Vibe Code — Bodega

**Input:** Proyecto completo Bodega (Next.js 16 + TypeScript + Drizzle ORM)  
**Assumptions:** Sistema operacional interno tipo ERP para bodega, compras, solicitudes. Destino producción, escala moderada (~100-1000 usuarios).  
**Quick Stats:** 306 archivos, ~42,976 líneas, TypeScript/React/Next.js 16 + Drizzle ORM + PostgreSQL  
**Scope:** Full audit multi-file (~42K líneas, 7 dimensiones)

---

## Executive Summary (Read This First)

```text
- [CRITICAL] Duplicación masiva entre módulos repuestos ↔ servicios: 6 pares de archivos casi idénticos (~3,800 líneas duplicadas). Cualquier bug o cambio debe aplicarse en ambos lados.
- [CRITICAL] request-form.tsx (1,011 líneas) y dashboard/page.tsx (694 líneas) violan severamente el principio de responsabilidad única. Mantenibilidad muy afectada.
- [HIGH] `canAll`, `hasRole`, `hasAnyRole`, `stringToHue` y ~9 schemas Zod exportados pero nunca importados en producción — código muerto que confunde y aumenta superficie de testing.
- [HIGH] `next.config.ts` tiene `experimental.nonce` como clave inválida — Next.js lo rechaza, la funcionalidad nonce no está activa.
- [MEDIUM] IVA hardcodeado como `0.19` en `order-totals.ts` sin configuración centralizada. Si la tasa cambia, hay que buscarlo manualmente.
- Overall: Deployable con fixes específicos, pero con deuda técnica significativa por duplicación y archivos monolito.
```

---

## Líneas de código por archivo (resumen por categoría)

| Categoría | Archivos | Líneas | Observación |
| --- | --- | --- | --- |
| `app/(app)/` páginas + actions | 78 | ~17,479 | Núcleo de la app |
| `app/(auth)/` | 5 | ~614 | Login/registro |
| `app/api/` | 9 | ~418 | API routes |
| `app/(print)/` | 3 | ~777 | Vista impresión OC |
| `lib/` servicios + utilidades | 36 | ~5,935 | Lógica de negocio |
| `lib/__tests__/` | 25 | ~2,879 | Tests unitarios |
| `components/` | 31 | ~3,508 | UI components |
| `modules/` | 14 | ~550 | Manifiestos (frozen) |
| `db/` schema + seed | 15 | ~1,358 | DB schema |
| `scripts/` + `e2e/` | 7 | ~2,449 | Scripts auxiliares |
| **Total** | **306** | **~42,976** | |

---

## Archivos más grandes (complejidad alta)

| Líneas | Archivo | Problema |
|---|---|---|
| 1,011 | `app/(app)/solicitudes/request-form.tsx` | Monolito extremo — formulario + lógica + validación + modos (nuevo/editar/ver) todo en uno |
| 694 | `app/(app)/dashboard/page.tsx` | Dashboard con demasiada lógica inline (work queue snapshot, gráficos, actividad reciente) |
| 684 | `app/(print)/compras/[id]/print/page.tsx` | Página de impresión grande pero justificada (es una sola vista) |
| 661 | `lib/services/item-state.ts` | Máquina de estados + todas las transiciones en un solo archivo |
| 571 | `app/(app)/admin/usuarios/user-form.tsx` | Formulario de usuarios demasiado grande |
| 566 | `lib/services/repuestos.ts` | Servicio de repuestos |
| 566 | `lib/services/servicios.ts` | Servicio de servicios (casi idéntico a repuestos) |
| 524 | `app/(app)/compras/oc-form.tsx` | Formulario de orden de compra |
| 522 | `app/(app)/compras/actions.ts` | Server actions de compras |
| 481 | `app/(app)/admin/usuarios/actions.ts` | Server actions de usuarios |
| 470 | `lib/email/smtp.ts` | Configuración SMTP |

---

## Archivos DUPLICADOS (repuestos ↔ servicios)

Estos pares son casi idénticos. La duplicación es intencional (dominios separados) pero el costo de mantenimiento es muy alto:

| repuestos | servicios | Líneas c/u |
| --- | --- | --- |
| `actions.ts` | `actions.ts` | 365 |
| `request-form.tsx` | `request-form.tsx` | ~345 |
| `request-list.tsx` | `request-list.tsx` | 195 |
| `[id]/page.tsx` | `[id]/page.tsx` | 247 |
| `[id]/quotation-panel.tsx` | `[id]/quotation-panel.tsx` | 332 |
| `nueva/page.tsx` | `nueva/page.tsx` | 77 |
| `page.tsx` | `page.tsx` | 125 |
| **Total duplicado** | | **~1,900 × 2 = 3,800 líneas** |

> **Impacto:** Cualquier bug encontrado en el flujo de repuestos debe corregirse manualmente también en servicios. Cualquier mejora debe aplicarse dos veces.

---

## Código Muerto / Exportaciones sin uso

| Archivo | Export | ¿Usado? |
| --- | --- | --- |
| `lib/auth/can.ts` | `canAll()` | ❌ Solo definido, nunca importado |
| `lib/auth/can.ts` | `hasRole()` | ❌ Solo definido, nunca importado |
| `lib/auth/can.ts` | `hasAnyRole()` | ❌ Solo definido, nunca importado |
| `lib/utils.ts` | `stringToHue()` | ❌ Nunca usado (era para colores de avatar) |
| `lib/validation/operations.ts` | `requestItemAttributeSchema` | ❌ Nunca importado |
| `lib/validation/operations.ts` | `requestItemSchema` | ❌ Nunca importado |
| `lib/validation/operations.ts` | `createOrderItemSchema` | ❌ Nunca importado |
| `lib/validation/operations.ts` | `receiptItemSchema` | ❌ Nunca importado |
| `lib/validation/masters.ts` | `rutSchema` | ❌ Nunca importado |
| `lib/validation/masters.ts` | `productAttributeSchema` | ❌ Nunca importado |
| `lib/validation/masters.ts` | `productSupplierSchema` | ❌ Nunca importado |
| `lib/validation/repuestos.ts` | `repuestoItemSchema` | ❌ Nunca importado |
| `lib/validation/servicios.ts` | `serviceItemSchema` | ❌ Nunca importado |

> **Nota:** Los schemas Zod están definidos pero nunca se usan en producción. La validación real se hace inline en los Server Actions. Esto sugiere que se planificó una capa de validación centralizada que nunca se implementó completamente.

---

## Critical Issues (Must Fix Before Production)

```text
[CRITICAL] Duplicación masiva repuestos ↔ servicios (3,800 líneas)
Location: Múltiples archivos en app/(app)/repuestos/ y app/(app)/servicios/
Dimension: Architecture & Design
Problem: 6 pares de archivos casi idénticos. Cualquier cambio de bugfix o feature debe aplicarse en ambos lados — el riesgo de desincronización es alto y ya se ha materializado (diferencias menores observadas).
Fix: Extraer la lógica compartida a un módulo común (ej. lib/services/requests-common.ts o un directorio compartido) y que repuestos/servicios solo tengan la diferenciación específica de dominio.

[CRITICAL] request-form.tsx: 1,011 líneas monolíticas
Location: app/(app)/solicitudes/request-form.tsx
Dimension: Maintainability / Architecture
Problem: Un solo archivo maneja creación, edición, visualización, selección de productos, atributos, carga de archivos, y múltiples modos de render. Supera 3× el umbral recomendado de 300 líneas. Imposible de testear unitariamente.
Fix: Dividir en componentes más pequeños: RequestFormProvider (contexto/estado), ProductPickerSection, RequestDetailsSection, AttributesSection, etc.
```

---

## High-Risk Issues

```text
[HIGH] Zod schemas definidos pero no usados en producción
Location: lib/validation/*.ts (múltiples schemas)
Dimension: Dead Code / Maintainability
Problem: 9 schemas de validación exportados pero nunca importados por ningún archivo de producción. La validación real ocurre inline en los Server Actions con lógica ad-hoc. Esto crea una falsa impresión de tener validación centralizada.
Fix: Decidir: o se eliminan los schemas no usados (simplifica), o se migran las validaciones inline a usar los schemas (mejor práctica).

[HIGH] canAll(), hasRole(), hasAnyRole() — código muerto en lib/auth/can.ts
Location: lib/auth/can.ts:32-56
Dimension: Dead Code
Problem: 3 funciones exportadas pero nunca importadas por ningún archivo fuera de su definición. Generan ruido y falsa sensación de tener un sistema de permisos completo.
Fix: Eliminar las 3 funciones si no están en el roadmap. Si se necesitan, agregar los callers que las usen.

[HIGH] next.config.ts: experimental.nonce es inválido
Location: next.config.ts
Dimension: Production Risks
Problem: Next.js 16 rechaza la clave `nonce` en `experimental` — muestra warning "Unrecognized key(s) in object: 'nonce'". La funcionalidad nonce para CSP no está operativa.
Fix: Eliminar `experimental.nonce` o actualizar a la API correcta de Next.js 16 si se necesita CSP nonce.

[HIGH] stringToHue() — código muerto
Location: lib/utils.ts:82
Dimension: Dead Code
Problem: Función exportada pero nunca utilizada en ningún archivo del proyecto.
Fix: Eliminar.
```

---

## Maintainability Problems

```text
[MEDIUM] Tasa de IVA (0.19) hardcodeada en computeOrderTotals()
Location: lib/order-totals.ts:7
Dimension: Robustness
Problem: const TAX_RATE = 0.19 está hardcodeado. Si la tasa impositiva cambia, hay que modificar el código fuente. Este valor debería ser configurable.
Fix: Mover a una constante global/env var: const TAX_RATE = Number(process.env.TAX_RATE ?? 0.19).

[MEDIUM] Page size constants locales y no centralizadas
Location: app/(app)/compras/page.tsx, entregas/page.tsx, bodega/page.tsx, etc.
Dimension: Consistency
Problem: Cada página define su propio PAGE_SIZE (25, 50, 20) como constante local. No hay un default global ni está en una config central.
Fix: Crear lib/constants.ts con DEFAULT_PAGE_SIZE = 25 y sobreescribir por módulo donde se necesite.

[MEDIUM] Sin directiva 'use client' en componentes que usan hooks
Location: Múltiples archivos .tsx en components/ y app/
Dimension: Production Risks
Problem: No se encontró 'use client' en componentes que claramente usan hooks de React o interactividad del navegador. Next.js 16 puede quejarse — o estos componentes son Server Components que accidentalmente intentan usar APIs del browser.
Fix: Verificar que todos los componentes con hooks tengan 'use client'.

[MEDIUM] lib/storage/helpers.ts: export { path as storagePath } — re-export peligroso
Location: lib/storage/helpers.ts:13
Dimension: Security
Problem: Exportar `path` directamente como `storagePath` expone el módulo path de Node en toda la aplicación, facilitando construir paths sin usar las funciones seguras de config.ts.
Fix: Eliminar el re-export y usar solo las funciones con validación (resolveDeliveryAttachmentFile, etc.)

[MEDIUM] Métricas de page size sin tipado fuerte
Location: app/(app)/trazabilidad/page.tsx — filtered.slice() manual para paginación
Dimension: Robustness
Problem: La paginación en trazabilidad usa filtered.slice() en memoria en vez de hacer paginación en la BD. Con ALERT_SCAN_LIMIT = 1,000, para datasets grandes esto degradará performance.
Fix: Mover la paginación a la query de BD con LIMIT/OFFSET.
```

---

## Production Readiness Score

```text
Score: 62 / 100
```

El proyecto tiene una base sólida: testing extensivo (~2,879 líneas de tests), arquitectura modular con separación clara entre capas (Server Actions → servicios → DB), logger estructurado, rate-limiting, manejo de estado con máquina de estados validada, y auditoría.

Sin embargo, los problemas de duplicación masiva (3,800 líneas duplicadas entre repuestos/servicios), archivos monolito (>1,000 líneas), y código muerto (13 exports no utilizados) reducen significativamente el puntaje. No hay fallas de seguridad críticas (no hay SQL injection, hardcoded secrets, ni eval()), pero la mantenibilidad a largo plazo es la mayor preocupación. El código es **deployable para uso interno con monitoreo**, pero necesita refactores específicos antes de considerar un estado "production-grade" completo.

---

## Refactoring Priorities

```text
1. [P1 - Blocker] Desduplicar repuestos/servicios — addresses [CRITICAL #1] — effort: L — impact: elimina 3,800 líneas duplicadas, bugfixes se aplican una sola vez.
2. [P2 - Blocker] Dividir request-form.tsx (1,011 líneas) — addresses [CRITICAL #2] — effort: M — impact: testabilidad, mantenibilidad.
3. [P3 - High] Limpiar código muerto (canAll, hasRole, hasAnyRole, stringToHue, 9 schemas no usados) — addresses [HIGH #1, #3] — effort: S — impact: reduce ruido y falsas expectativas.
4. [P4 - High] Eliminar experimental.nonce de next.config.ts — addresses [HIGH #4] — effort: S — impact: elimina warning de configuración inválida.
5. [P5 - Medium] Centralizar TAX_RATE en variable de entorno — addresses [MEDIUM #1] — effort: S — impact: prepara para cambios de tasa impositiva.
6. [P6 - Medium] Mover paginación de trazabilidad a BD — addresses [MEDIUM #5] — effort: M — impact: performance con datasets grandes.
```

**Quick Wins (fix en <1 hora):**

- Eliminar `canAll`, `hasRole`, `hasAnyRole` de `lib/auth/can.ts` (3 funciones no usadas)
- Eliminar `stringToHue` de `lib/utils.ts`
- Eliminar `experimental.nonce` de `next.config.ts`
- Eliminar schemas Zod no usados en `lib/validation/*.ts` (9 schemas)
- Mover `TAX_RATE = 0.19` a `process.env.TAX_RATE ?? 0.19`

---

## Evaluación por archivo (muestra representativa)

| Archivo | Líneas | Estado | Por qué |
| --- | --- | --- | --- |
| `lib/services/item-state.ts` | 661 | ⚠️ Regular | Bien estructurado (máquina de estados clara + transacciones), pero muy grande. Merece extraer funciones por fase. |
| `lib/email/smtp.ts` | 470 | ⚠️ Regular | Bien encapsulado pero grande para un solo servicio de email. |
| `lib/storage/config.ts` | 123 | ✅ Bien | Buen patrón: todas las rutas pasan por `isSafeStorageName()`. Validación path traversal incluida. |
| `lib/auth/can.ts` | 119 | ⚠️ Regular | 3 funciones exportadas no usadas. Buena separación de concerns. |
| `lib/auth/scope.ts` | 57 | ✅ Bien | Enfocado, claro, testeable. |
| `lib/work-queue.ts` | 425 | ⚠️ Regular | Lógica compleja pero bien modularizada con tipos claros. Podría dividirse en 2-3 archivos. |
| `lib/logger.ts` | 41 | ✅ Bien | Simple, efectivo, con niveles. |
| `lib/audit.ts` | 63 | ✅ Bien | Patrón correcto: servicio puro, inyección de DB vía parámetro default. |
| `lib/toast.ts` | 15 | ✅ Bien | Wrapper pequeño y útil sobre sonner. |
| `lib/validation/*.ts` | ~400 | ❌ Mal | Schemas definidos pero no usados en producción. Falsa validación. |
| `components/ui/select.tsx` | 326 | ⚠️ Regular | Muy grande para un wrapper de Radix. Contiene lógica de presentación y estado. |
| `app/(app)/solicitudes/request-form.tsx` | 1,011 | ❌ Mal | Monolito extremo. Violación SRP. |
| `app/(app)/dashboard/page.tsx` | 694 | ❌ Mal | Demasiada lógica en página. Work queue snapshot debería estar en lib. |
| `app/(app)/repuestos/actions.ts` | 365 | ⚠️ Regular | Casi idéntico a servicios/actions.ts. Duplicación. |
| `app/(app)/compras/actions.ts` | 522 | ⚠️ Regular | Funcional pero muy grande. Podría dividirse por entidad (OC, facturas, etc). |
| `modules/registry.ts` | 50 | ✅ Bien | Sigue el contrato AGENTS.md: minimal. |
| `modules/README.md` | - | ✅ Bien | Documenta claramente el estado frozen y el plan de reconciliación. |
| `db/schema/*.ts` | ~800 | ✅ Bien | Schemas bien definidos con relaciones explícitas. |
| `proxy.ts` | 67 | ⚠️ Regular | Archivo en la raíz no documentado. Asumo que es para desarrollo local. |
| `next.config.ts` | 27 | ❌ Mal | `experimental.nonce` inválido. |
| `AUDITORIA_UI_DESKTOP.md` | - | ✅ Bien | Documentación de auditoría UI valiosa. |

---

## Buenas prácticas detectadas ✅

- **Máquina de estados robusta** en `item-state.ts` — validación `canTransition()`, transacciones DB, registro de auditoría.
- **Rate-limiting persistente** en PostgreSQL (no in-memory).
- **Path traversal prevention** en `storage/config.ts` con `isSafeStorageName()`.
- **Tests extensivos** — 25 archivos de test, ~2,879 líneas, incluyendo tests de concurrencia, integración y RBAC.
- **Logger estructurado** con niveles y formato consistente.
- **`cn()` utility** con `clsx` + `tailwind-merge` para Tailwind.
- **Safe redirect** en `navigation.ts` — `safeInternalPath()` previene open redirects.
- **Separación Server Actions ↔ Services** — las actions autentican/autorizan y delegan a servicios.
- **Módulo frozen documentado** — `modules/README.md` deja claro el estado y plan.

---

## Malas prácticas detectadas ❌

- **Duplicación masiva** entre repuestos/servicios (no se extrajo lógica compartida).
- **Archivos monolito** (>500 líneas) con múltiples responsabilidades.
- **Código muerto** — 13 exports definidos pero no usados en producción.
- **Config inválida** — `experimental.nonce` en `next.config.ts`.
- **Magic numbers** — `0.19` hardcodeado en `order-totals.ts`.
- **Validación centralizada no usada** — schemas Zod definidos pero ignorados.
- **Paginación en memoria** en trazabilidad (`filtered.slice()` en vez de SQL LIMIT/OFFSET).

---

*Auditoría generada el 2026-06-16 con Vibe Code Auditor skill.*

---

## Estado de remediación (2026-06-16)

| Hallazgo | Severidad | Estado | Fase |
| --- | --- | --- | --- |
| Duplicación services repuestos/servicios | CRITICAL | ✅ Corregido — Factory `lib/requests/request-service.ts` | Anterior |
| Duplicación actions repuestos/servicios | CRITICAL | ✅ Corregido — Factory `lib/requests/request-actions.ts` + thin wrappers | Fase 2 |
| `experimental.nonce` en `next.config.ts` | HIGH | ✅ Corregido | Fase 1 |
| `canAll()`, `hasRole()`, `hasAnyRole()` código muerto | HIGH | ✅ Corregido — Eliminadas | Fase 1 |
| `stringToHue()` código muerto | HIGH | ✅ Corregido — Eliminada | Fase 1 |
| `storagePath` re-export peligroso | MEDIUM | ✅ Corregido — Eliminado | Fase 1 |
| IVA hardcodeado (0.19) | MEDIUM | ✅ Corregido — `process.env.TAX_RATE ?? 0.19` | Fase 1 |
| `lib/constants.ts` creado | MEDIUM | ✅ Corregido | Fase 1 |
| `admin/usuarios/actions.ts` dividido | MEDIUM | ✅ Corregido — helpers extraídos a `actions.helpers.ts` | Fase 2 |
| `compras/actions.ts` dividido | MEDIUM | ✅ Corregido — facturas → `invoice-actions.ts`, helpers → `actions.helpers.ts` | Fase 2 |
| Zod schemas "no usados" | HIGH | ⚠️ Falso positivo — sí se usan | — |
| Page sizes centralizados | MEDIUM | ✅ Corregido — `lib/constants.ts` con todas las constantes | Final |
| Paginación en trazabilidad | MEDIUM | ✅ Documentado — alert filter in-memory con `ALERT_SCAN_LIMIT=1000`; resto con LIMIT/OFFSET | Final |
