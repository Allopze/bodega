# Documentación de Plataforma Chome

Documentación generada de la Plataforma Chome: qué hace cada pantalla, qué puede
hacer el usuario en ella y cómo se relaciona con el resto de la operación.

## Qué es

Plataforma interna para gestionar la operación por faena: solicitudes,
aprobaciones, compras, recepción, stock, entregas, prevención y SG-SST, flota,
combustibles, facturación, reportes y trazabilidad.

Casi todo el alcance de datos y permisos se define **por faena**. Lo que cada
persona ve depende de su rol, de sus faenas asignadas y de qué módulos estén
activos.

## Stack

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind, Radix
- **Backend:** Server Actions y Route Handlers de Next.js, NextAuth
- **Base de datos:** PostgreSQL con Drizzle ORM

## Áreas de la plataforma

| Área | Ruta base | Estado |
|------|-----------|--------|
| [Dashboard](./_plataforma/dashboard.md) | `/dashboard` | ✅ Completo |
| [Solicitudes](./requests/solicitudes.md) | `/solicitudes` | ✅ Completo (3/3) |
| [Aprobaciones](./approvals/aprobaciones.md) | `/aprobaciones` | ✅ Completo (1/1) |
| [Compras](./purchasing/compras.md) | `/compras` | ✅ Completo (5/5) |
| [Recepción](./receiving/recepcion.md) | `/recepcion` | ✅ Completo (3/3) |
| [Bodega](./warehouse/bodega.md) | `/bodega` | ✅ Completo (15/15) |
| [Entregas](./deliveries/entregas.md) | `/entregas` | ✅ Completo (2/2) |
| [Prevención y SG-SST](./prevention/prevencion.md) | `/prevencion` | ✅ Completo (76/76 — 60 con captura, 16 desde esquema) |
| [Control operacional](./flota/control-operacional.md) | `/control-operacional` | ✅ Completo |
| [Flota](./flota/flota.md) | `/flota` | ✅ Completo (4/4) |
| [Mantenciones](./mantenciones/mantenciones.md) | `/mantenciones` | ✅ Completo (4/4 — 1 desde esquema) |
| Repuestos | — | ➖ Sin páginas propias (panel embebido en Solicitudes y Compras) |
| [Combustibles](./combustibles/combustibles.md) | `/combustibles` | ✅ Completo (28/28 — 6 desde esquema) |
| Servicios | — | ➖ Sin páginas propias (panel embebido en Solicitudes y Compras) |
| [Facturación](./billing/facturacion.md) | `/facturacion` | ✅ Completo (9/9) |
| Trazabilidad | `/trazabilidad` | 🔜 Pendiente |
| [Analítica](./analytics/analitica.md) | `/analitica` | ✅ Completo (1/1) |
| [Reportes](./reports/reportes.md) | `/reportes` | ✅ Completo (1/1) |
| [Pendientes](./operations/pendientes.md) | `/pendientes` | ✅ Completo (1/1) |
| Notificaciones | `/notificaciones` | 🔜 Pendiente (transversal, fuera de los 19 módulos) |
| [Soporte](./feedback/soporte.md) | `/soporte` | ✅ Completo (3/3) |
| [Perfil](./_plataforma/perfil.md) | `/perfil` | ✅ Completo |
| [TI](./ti/ti.md) | `/ti` | ✅ Completo (13/13 — 3 desde esquema) |
| [Administración](./admin/admin.md) | `/admin` | ✅ Completo (43/43) |

Las páginas se van agregando a medida que se ejecuta `/docs:generate` sobre cada
una. Son 207 páginas bajo `app/(app)/`.

## Documentación manual existente

Esta carpeta contiene solo la documentación generada. La documentación escrita a
mano sigue en `docs/`, por dominio: `manual-prevencion/`, `prevencion/`,
`compras/`, `combustibles/`, `facturacion/`, `deploy/`, `decisions/`, `audits/`.

## Cómo generar

```bash
# Flujo recomendado: descubrir → planificar → ejecutar
/docs:discover        # recorre el código y detecta módulos
/docs:plan            # arma el plan de documentación
/docs:execute         # genera toda la documentación

# Una sola página
/docs:generate https://plataforma.portalchome.cl/dashboard

# Actualizar tras cambios de código
/docs:update --base main
```

Antes de generar contra la app, exporta las credenciales:

```bash
export DOCS_AUTH_USER=...
export DOCS_AUTH_PASS=...
```

Para trabajar contra el entorno local, usa `http://localhost:3001`
(`npm run dev`).

## Datos de esta documentación

- **Configuración:** `docs/aidocs-config.yml`
- **Inicializada:** 2026-09-14
- **Audiencia:** mixta (usuarios de faena y oficina + equipo técnico interno)
- **Tono:** simple y directo
- **Capturas:** al inicio de cada documento, en `images/` (no versionadas)

---

*Índice creado por `/docs:init`. Actualízalo a medida que agregues documentación.*
