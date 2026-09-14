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
| Dashboard | `/dashboard` | 🔜 Pendiente |
| Solicitudes | `/solicitudes` | 🔜 Pendiente |
| Aprobaciones | `/aprobaciones` | 🔜 Pendiente |
| Compras | `/compras` | 🔜 Pendiente |
| Recepción | `/recepcion` | 🔜 Pendiente |
| Bodega | `/bodega` | 🔜 Pendiente |
| Entregas | `/entregas` | 🔜 Pendiente |
| Prevención y SG-SST | `/prevencion` | 🔜 Pendiente |
| Control operacional | `/control-operacional` | 🔜 Pendiente |
| Flota | `/flota` | 🔜 Pendiente |
| Mantenciones | `/mantenciones` | 🔜 Pendiente |
| Repuestos | `/repuestos` | 🔜 Pendiente |
| Combustibles | `/combustibles` | 🔜 Pendiente |
| Servicios | `/servicios` | 🔜 Pendiente |
| Facturación | `/facturacion` | 🔜 Pendiente |
| Trazabilidad | `/trazabilidad` | 🔜 Pendiente |
| Analítica | `/analitica` | 🔜 Pendiente |
| Reportes | `/reportes` | 🔜 Pendiente |
| Pendientes | `/pendientes` | 🔜 Pendiente |
| Notificaciones | `/notificaciones` | 🔜 Pendiente |
| Soporte | `/soporte` | 🔜 Pendiente |
| Perfil | `/perfil` | 🔜 Pendiente |
| TI | `/ti` | 🔜 Pendiente |
| Administración | `/admin` | 🔜 Pendiente |

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
