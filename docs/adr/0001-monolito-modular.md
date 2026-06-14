# ADR 0001 — Monolito modular con registry central

**Estado:** Aceptado, parcialmente supersedido por la poda 2026-06-14
**Fecha:** 2026-06-11  
**Autores:** Alejandro Lopez Zelaya  

---

> Snapshot histórico: el registry/manifests se conserva vivo para navegación y
> permisos, pero las implementaciones congeladas en `modules/*` y los shims
> `core/*` fueron removidos el 2026-06-14. La fuente de verdad actual es
> `lib/` + `app/`.

## Contexto

Chome Solicitudes y Bodega es un sistema procure-to-pay maduro (Next.js 16 App Router,
SQLite/Drizzle, NextAuth v5, RBAC). El objetivo a largo plazo es convertirlo en un
software completo de prevención de riesgos, sumando módulos de Incidentes/Accidentes,
Inspecciones/Checklists, Matriz de riesgos (IPER) y Capacitaciones/EPP compliance.

El sistema original era un *monolito por capas* con puntos centrales acoplados que
había que editar a mano con cada nueva funcionalidad:

- `lib/auth/types.ts`: union type de 23 permisos (hardcodeado)
- `db/seed.ts`: roles y permisos hardcodeados
- `components/layout/nav-items.ts`: lista de nav hardcodeada
- Server actions y componentes dispersos en `app/(app)/<feature>/`

Cada módulo nuevo requería tocar 4–6 archivos centrales. El riesgo de regresión
crecía con cada entrega.

---

## Decisión

Adoptar un **monolito modular** con registro central.

### Estructura
```
core/          ← shared kernel (auth, audit, codes, notifications, utils)
modules/
  registry.ts  ← ÚNICO join-point: 1 línea por módulo
  permissions.ts ← type Permission derivado del registry
  <módulo>/
    manifest.ts   ← { id, permissions, nav, seed?, defaultGrants? }
    schema.ts     ← tablas Drizzle del dominio
    validation.ts ← schemas Zod del dominio
    actions/      ← server actions
    services/     ← lógica de negocio
    components/   ← componentes del dominio
    index.ts      ← barrel PÚBLICO (frontera)
app/(app)/     ← cascarones que importan de @/modules/*
```

### Contrato
Agregar un módulo = **una sola línea** en `modules/registry.ts`. Los permisos,
la navegación y el seed se derivan automáticamente del manifest.

### Frontera
ESLint `no-restricted-imports` en modo `error` prohíbe:
1. `core/` importando de `modules/`
2. `modules/A` importando internals de `modules/B` (solo vía barrel `index.ts`)

---

## Alternativas descartadas

### Microservicios
- Requiere infraestructura distribuida (service discovery, network I/O, deployments separados)
- El equipo es de una persona; el overhead operacional supera los beneficios
- La base de datos es SQLite embebida → no particionable horizontalmente

### Monorepo de packages (`packages/<módulo>`)
- Requiere tooling adicional (Turborepo/Nx) y cambios en tsconfig
- El sistema usa `@/*` paths que apuntan a la raíz; packages romperían esos paths
- Las rutas de Next.js (`app/`) no se beneficiarían de packages locales
- Complejidad alta para un equipo unipersonal

### Co-locación en `app/(app)/<feature>/` (estado original)
- No escala: los nuevos módulos de prevención compartirán datos con procurement
  (trabajadores, faenas, EPP) y necesitan importar entre sí de forma controlada
- No hay frontera: cualquier archivo puede importar cualquier cosa
- Permisos y nav requieren ediciones manuales en cada entrega

---

## Consecuencias

**Positivas:**
- Agregar un módulo de prevención de riesgos costará ~10 archivos nuevos + 1 línea en registry
- Sin editar permisos hardcodeados, sin editar nav, sin editar seed de roles
- Frontera automatizada: ESLint falla si un módulo accede a internals de otro
- `type Permission` derivado automáticamente del registry — nunca desincronizado

**Negativas / compromisos:**
- Migración incremental requirió ~80 forward shims en `core/` y `modules/`
- Los shims son deuda técnica que se elimina en una Fase 3 posterior por módulo
- El seed sigue siendo parcialmente hardcodeado (role-permission mapping detallado
  que supera la granularidad de `defaultGrants`)
- Única DB SQLite → los módulos de prevención comparten la misma transacción; no hay
  aislamiento de fallos a nivel de storage

---

## Estado de implementación

| Fase | Estado | Descripción |
|---|---|---|
| 0 — Scaffolding | ✅ Parcial vigente | `modules/registry.ts` + manifests se conservan; `core/module-kit` fue reemplazado por `modules/manifest-types.ts` |
| 1 — Core kernel | 🧹 Removido | Forward shims en `core/*` eliminados; fuente viva en `lib/` |
| 2a — Módulo admin | 🧹 Reducido | solo manifest vivo; schema/actions/services/validation removidos |
| 2b-2h — Módulos operacionales | 🧹 Reducidos | solo manifests vivos; implementaciones congeladas removidas |
| 3 — Cierre | ✅ Vigente | Nav desde registry y permisos derivados para pruebas/seed |
| 4 — Docs | ✅ Actualizado | CONTEXT.md, ADR, ARCHITECTURE.md reflejan la poda |
| Prevención de riesgos | 🔜 Pendiente | incidentes, inspecciones, IPER, capacitaciones/EPP |
