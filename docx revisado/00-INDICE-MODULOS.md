# 🏗️ SaaS de Prevención de Riesgos - Mapa de Módulos

> **Basado en:** Registros SG-SST de Servicios Industriales Chome Ltda.
> **Total documentos analizados:** 16 archivos (xls, xlsx, docx) **Total
> módulos identificados:** 14

------------------------------------------------------------------------

## Arquitectura de Módulos

    graph TB
        subgraph "📋 PLANIFICACIÓN"
            M01["01. Cronograma<br/>Actividades SG-SST"]
            M02["02. Capacitaciones<br/>y Campañas"]
        end

        subgraph "📝 REGISTRO TRANSVERSAL"
            M03["03. Lista de<br/>Asistencia RE-07"]
        end

        subgraph "🔍 INSPECCIONES"
            M04["04. Evidencia Objetiva<br/>Insp. No Planeadas"]
            M05["05. Inspección<br/>Equipos Móviles"]
            M06["06. Inspección<br/>Taller Mantención"]
            M07["07. Inspección<br/>Carros"]
            M08["08. Inspección<br/>Contenedores"]
            M10["10. Inspección<br/>Extintores"]
            M11["11. Inspección<br/>EPP"]
        end

        subgraph "👁️ OBSERVACIONES"
            M12["12. Obs. Seguridad<br/>Camión Ampliroll"]
            M13["13. Obs. Seguridad<br/>Maquinaria Pesada"]
            M14["14. Observaciones<br/>Planeadas"]
        end

        subgraph "📊 CONTROL"
            M09["09. Seguimiento<br/>y Control"]
        end

        M01 --> M05 & M06 & M07 & M08 & M10 & M11 & M12 & M13 & M14
        M02 --> M03
        M05 & M06 & M07 & M08 & M10 & M11 --> M09
        M04 --> M09
        M12 & M13 & M14 --> M09

------------------------------------------------------------------------

## Índice de Módulos

| \# | Módulo | Documento Fuente | Tipo |
|----|----|----|----|
| [01](./01-cronograma-actividades-sgsst.md) | Cronograma de Actividades SG-SST | `ACTIVIDADES PROGRAMA SG-SST AÑO 2025.xls` (×2) | Planificación |
| [02](./02-capacitaciones-campanas.md) | Capacitaciones y Campañas Preventivas | `Anexo 10 CRONOGRAMA CAPACITACIONES Y CAMPAÑAS AÑO 2025.xls` | Planificación |
| [03](./03-lista-asistencia.md) | Lista de Asistencia (RE-07) | `RE-07 Lista Asistencia.docx` | Registro |
| [04](./04-evidencia-objetiva-inspecciones.md) | Evidencia Objetiva Inspecciones No Planeadas | `Anexo 08 Evidencia Objetiva Inspecciones de Seguridad.docx` | Inspección |
| [05](./05-inspeccion-equipos-moviles.md) | Inspección de Equipos Móviles | `Anexo 1 Inspeccion de Equipos Moviles.xls` | Inspección |
| [06](./06-inspeccion-taller-mantencion.md) | Inspección Taller de Mantención | `Anexo 12 Inspeccion Taller Mantención.xlsx` | Inspección |
| [07](./07-inspeccion-carros.md) | Inspección de Carros | `Anexo 13 Inspeccion Carro.xlsx` | Inspección |
| [08](./08-inspeccion-contenedores.md) | Inspección de Contenedores | `Anexo 14 Inspeccion Contenedores.xlsx` | Inspección |
| [09](./09-seguimiento-control.md) | Seguimiento y Control | `Anexo 15 Seguimiento y Control Observaciones e Inspecciones.xlsx` | Control |
| [10](./10-inspeccion-extintores.md) | Inspección Estado de Extintores | `Anexo 2 Inspeccion Estado extintores.xls` | Inspección |
| [11](./11-inspeccion-epp.md) | Inspección de Uso y Estado de EPP | `Anexo 3 Inspeccion de Uso y Estado de EPP.xls` | Inspección |
| [12](./12-observacion-camion-ampliroll.md) | Observación de Seguridad Camión Ampliroll | `Anexo 4 Observacion de Seguridad Camion Ampliroll PR-SGC-24.xls` | Observación |
| [13](./13-observacion-maquinaria-pesada.md) | Observación de Seguridad Maquinaria Pesada | `Anexo 5 Observacion de Seguridad Maquinaria Pesada PR-SGC-25.xls` | Observación |
| [14](./14-observaciones-planeadas.md) | Observaciones Planeadas | `Anexo 7 Observaciones Planeadas.XLS` | Observación |

------------------------------------------------------------------------

## Contenido de Cada Módulo

Cada archivo markdown contiene:

1.  **📋 Descripción General** — Qué gestiona el módulo
2.  **🗄️ Estructura de Datos** — Entidades, campos, tipos y relaciones
    (modelo de datos)
3.  **📑 Catálogo/Checklist** — Todos los ítems del formulario original
    transcritos
4.  **⚙️ Funcionalidades SaaS** — Features propuestas organizadas por
    categoría
5.  **📏 Reglas de Negocio** — Lógica y restricciones del proceso
6.  **🔗 Integraciones** — Relaciones con otros módulos
7.  **🖥️ Wireframe Conceptual** — Boceto ASCII de la interfaz (en los
    módulos principales)

------------------------------------------------------------------------

## Recomendaciones de Implementación

### Módulos Unificables

| Módulos | Recomendación |
|----|----|
| 12 + 13 | **Observaciones de Seguridad Equipos**: Un solo módulo con plantillas por tipo de equipo (95% estructura compartida) |
| 05 + 07 + 08 | **Inspecciones de Activos**: Motor genérico de checklists con plantillas por tipo de activo |

### Entidades Maestras Transversales

| Entidad                 | Usada por              |
|-------------------------|------------------------|
| `Empresa`               | Todos                  |
| `CentroTrabajo` (Faena) | Todos                  |
| `Trabajador`            | 03, 11, 12, 13, 14     |
| `Equipo` (Flota)        | 05, 07, 08, 10, 12, 13 |
| `Usuario` (Roles)       | Todos                  |

### Prioridad de Desarrollo Sugerida

| Fase | Módulos | Justificación |
|----|----|----|
| **MVP** | 01, 03, 09 | Core del sistema: planificación, registro y seguimiento |
| **Fase 2** | 05, 10, 11 | Inspecciones más frecuentes y críticas |
| **Fase 3** | 12+13, 14, 04 | Observaciones y evidencias |
| **Fase 4** | 02, 06, 07, 08 | Capacitaciones e inspecciones complementarias |

------------------------------------------------------------------------

## Normativa Legal de Referencia (Chile)

| Normativa | Descripción |
|----|----|
| **Ley 16.744** | Seguro social contra accidentes del trabajo y enfermedades profesionales |
| **DS 40** | Reglamento sobre prevención de riesgos profesionales |
| **DS 44** | Reglamento de seguridad y salud en el trabajo |
| **DS 54** | Reglamento de comités paritarios de higiene y seguridad |
| **DS 148** | Reglamento sanitario sobre manejo de sustancias peligrosas |
| **DS 594** | Condiciones sanitarias y ambientales básicas en los lugares de trabajo |
| **Protocolos MINSAL** | PREXOR, TMERT, MMC, Psicosocial, UV Solar |
