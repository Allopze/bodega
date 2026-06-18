# Documentación — Chome Solicitudes y Bodega

Índice general de la documentación del proyecto.

---

## Estructura

```
docs/
├── README.md                           ← Este índice
├── diseno/
│   └── DESIGN.md                       ← Sistema de diseño, tokens, accesibilidad
├── planificacion/
│   ├── PLAN.md                         ← Plan MVP y fases de implementación
│   ├── PRODUCT.md                      ← Requisitos y especificaciones del producto
│   └── chome_feature_list.md           ← Catálogo detallado de funcionalidades
├── arquitectura/
│   └── ARCHITECTURE.md                 ← Arquitectura técnica completa
├── auditoria/
│   └── EPP_PROVEEDORES_ESTRUCTURADO.md ← Datos maestros de proveedores y catálogo
│   (el reporte de auditoría vive en la raíz: ../AUDITORIA_COMPLETA.md)
├── security/
│   └── CSRF.md                         ← Modelo de protección CSRF (Server Actions)
└── pruebas/
    └── TESTING.md                      ← Guía de testing (unitario, E2E, manual)
```

---

## Diseño

**[DESIGN.md](diseno/DESIGN.md)** — Sistema de tokens de diseño, paleta de colores, tipografía, espaciado, sombras, movimiento, layout, componentes base, accesibilidad y patrones de uso. Define las reglas visuales que todo componente debe seguir.

---

## Planificación

**[PLAN.md](planificacion/PLAN.md)** — Plan de desarrollo del MVP con fases de implementación, decisiones de arquitectura inicial, modelo de datos proyectado y test plan.

**[PRODUCT.md](planificacion/PRODUCT.md)** — Especificación del producto: propósito, roles, flujo principal, estados de las entidades, principios de diseño y decisiones de no-objetivo. Define qué es y qué no es el sistema.

**[chome_feature_list.md](planificacion/chome_feature_list.md)** — Prompt original con el catálogo exhaustivo de funcionalidades, roles, permisos, módulos, estados, reglas de negocio y criterios de éxito. Es la fuente de verdad de los requerimientos funcionales.

---

## Arquitectura

**[ARCHITECTURE.md](arquitectura/ARCHITECTURE.md)** — Documento técnico completo con:
- Stack tecnológico y versiones
- Estructura de directorios del proyecto
- Esquema de base de datos (tablas, relaciones, propósitos)
- Ciclo de vida del ítem (máquina de estados)
- Flujos principales (solicitud → aprobación → OC → recepción → entrega)
- Patrones de código y convenciones
- Sistema de autenticación y autorización (RBAC)
- Decisiones arquitectónicas clave

---

## Auditoría

**[AUDITORIA_COMPLETA.md](../AUDITORIA_COMPLETA.md)** — Análisis de seguridad, hallazgos, riesgos identificados, estado de remediación y recomendaciones de mejora.

**[EPP_PROVEEDORES_ESTRUCTURADO.md](auditoria/EPP_PROVEEDORES_ESTRUCTURADO.md)** — Datos estructurados de proveedores (TRECK y APRO) con catálogo de productos, referencias y precios extraídos de documentos reales de Chome.

---

## Pruebas

**[TESTING.md](pruebas/TESTING.md)** — Guía completa de testing:
- Pruebas unitarias con Vitest (transiciones de estado, permisos, totales, validaciones)
- Pruebas E2E con Playwright (flujo completo en navegador)
- Prueba manual paso a paso
- Cobertura y resolución de problemas

---

## Referencias rápidas

| ¿Qué necesitas? | Documento |
|---|---|
| Entender el sistema de diseño | [DESIGN.md](diseno/DESIGN.md) |
| Ver el stack técnico | [ARCHITECTURE.md](arquitectura/ARCHITECTURE.md) |
| Entender la base de datos | [ARCHITECTURE.md](arquitectura/ARCHITECTURE.md) |
| Conocer los roles y permisos | [PRODUCT.md](planificacion/PRODUCT.md) |
| Ver todas las funcionalidades | [chome_feature_list.md](planificacion/chome_feature_list.md) |
| Ejecutar pruebas | [TESTING.md](pruebas/TESTING.md) |
| Revisar seguridad | [AUDITORIA_COMPLETA.md](../AUDITORIA_COMPLETA.md) · [security/CSRF.md](security/CSRF.md) |
| Ver catálogo de proveedores | [EPP_PROVEEDORES_ESTRUCTURADO.md](auditoria/EPP_PROVEEDORES_ESTRUCTURADO.md) |

---

## Convenciones

- Toda la documentación está en español.
- Los nombres de archivo en `components/`, `lib/`, `app/` se referencian tal cual (en inglés).
- Para contribuir, agregar nueva documentación en la subcarpeta correspondiente y actualizar este índice.
