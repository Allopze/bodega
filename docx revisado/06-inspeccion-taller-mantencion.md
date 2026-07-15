# Módulo 06: Inspección Taller de Mantención

> **Documento fuente:** `Anexo 12 Inspeccion Taller Mantención.xlsx`
> **Empresa:** Servicios Industriales Chome Ltda. **Tipo:** Checklist de
> inspección de instalaciones de taller

------------------------------------------------------------------------

## 1. Descripción General

Este módulo gestiona la **inspección periódica de talleres de
mantención** en cada centro de trabajo. Evalúa condiciones de seguridad,
señalización, estado de maquinaria, procedimientos de trabajo seguro,
medios de izaje y almacenamiento de materiales peligrosos.

------------------------------------------------------------------------

## 2. Estructura de Datos

### 2.1 Entidad Principal: `InspecciónTaller`

| Campo | Tipo | Descripción |
|----|----|----|
| `id` | UUID | Identificador único |
| `centro_trabajo_id` | FK → CentroTrabajo | Centro de trabajo |
| `nombre_ejecutor` | String(200) | Nombre del inspector |
| `nombre_acompañante` | String(200) | Acompañante de la inspección |
| `fecha` | Date | Fecha de la inspección |
| `firma_ejecutor_url` | String | Firma del inspector |
| `firma_acompañante_url` | String | Firma del acompañante |
| `revisión` | String(10) | Versión del formulario (ej: “Rev. 00”) |
| `resultado_general` | Enum | `conforme`, `conforme_parcial`, `no_conforme` |
| `created_at` | Timestamp | Fecha de creación |

### 2.2 Entidad: `ItemInspecciónTaller`

| Campo             | Tipo                  | Descripción                        |
|-------------------|-----------------------|------------------------------------|
| `id`              | UUID                  | Identificador único                |
| `inspección_id`   | FK → InspecciónTaller | Inspección padre                   |
| `número`          | Integer               | Número del ítem (1-16)             |
| `descripción`     | Text                  | Pregunta de inspección             |
| `resultado`       | Enum                  | `si`, `no`, `parcial`, `no_aplica` |
| `recomendaciones` | Text                  | Recomendaciones / observaciones    |

------------------------------------------------------------------------

## 3. Checklist de Inspección (16 ítems)

| N° | Pregunta de Inspección | Evaluación |
|----|----|----|
| 1 | ¿Están los lugares de trabajo señalizados de acuerdo a los riesgos existentes? | Si/No/Pa/Na |
| 2 | ¿Se mantienen en condiciones seguras y en buen funcionamiento los elementos estructurales, máquinas, instalaciones, herramientas y equipos? | Si/No/Pa/Na |
| 3 | ¿Se mantienen libres de obstáculos el lugar de trabajo, así como los pasillos de circulación? (limpios y ordenados, para evitar tropiezos, golpes y caídas) | Si/No/Pa/Na |
| 4 | ¿Existe señalización de uso obligatorio EPP en las distintas áreas de trabajo? | Si/No/Pa/Na |
| 5 | ¿Se encuentran protegidas las partes móviles, transmisiones y puntos de operaciones de herramientas y equipos? | Si/No/Pa/Na |
| 6 | ¿Se prohíbe a los trabajadores cuya labor se ejecuta cerca de maquinarias en movimiento, el uso de ropa suelta, cabello largo? | Si/No/Pa/Na |
| 7 | ¿Se cumplen los procedimientos de trabajo seguro al interior del taller (labores de soldadura, corte de metales o similares)? | Si/No/Pa/Na |
| 8 | ¿Los trabajadores conocen o han sido capacitados en estos procedimientos de trabajo seguro? | Si/No/Pa/Na |
| 9 | ¿Existen biombos y/o áreas de trabajo seguras para labores que expongan a riesgos a personal aledaño? (soldaduras, cortes, desbastes, etc.) | Si/No/Pa/Na |
| 10 | ¿Se cuenta con los apoyos de apuntalamientos necesarios para los trabajos bajo el chasis de una máquina? (gatas hidráulicas, banquillos metálicos) | Si/No/Pa/Na |
| 11 | ¿Las escaleras se mantienen en condiciones seguras y en buen funcionamiento? | Si/No/Pa/Na |
| 12 | ¿Los accesos a los pozos cuentan con buena iluminación, escalera con goma antideslizante y pasamanos? | Si/No/CP/Na |
| 13 | ¿Se dispone de medios mecánicos para cargar materiales que superan los 25 kg (hombres) y 20 kg (mujeres)? | Si/No/CP/Na |
| 14 | ¿Los pozos se encuentran demarcados con pintura de alto tráfico? | Si/No/CP/Na |
| 15 | ¿Se cuenta con material inerte para absorber líquidos, aceites u otros esparcidos en las superficies de trabajo? | Si/No/CP/Na |
| 16 | ¿Los cilindros utilizados para oxicorte, GLP, Otros se encuentran bien almacenados? | Si/No/CP/Na |

### Escala de Evaluación

| Código | Significado         | Color       |
|--------|---------------------|-------------|
| **Si** | Cumple              | 🟢 Verde    |
| **No** | No Cumple           | 🔴 Rojo     |
| **Pa** | Cumple Parcialmente | 🟡 Amarillo |
| **Na** | No Aplica           | ⚪ Gris     |

------------------------------------------------------------------------

## 4. Funcionalidades del Módulo SaaS

### 4.1 Inspección Digital

- [ ] Checklist con las 16 preguntas predefinidas
- [ ] Evaluación con 4 opciones (Si/No/Pa/Na)
- [ ] Campo de recomendaciones por cada ítem
- [ ] Captura de fotos para ítems No Cumple o Parcial
- [ ] Firma digital de ejecutor y acompañante
- [ ] Cálculo automático de % cumplimiento

### 4.2 Gestión

- [ ] Plantilla personalizable (agregar/quitar ítems)
- [ ] Programación de inspecciones periódicas (semanal/mensual)
- [ ] Asignación de responsable de inspección
- [ ] Historial de inspecciones por taller
- [ ] Comparativo entre inspecciones (tendencia)
- [ ] Generación automática de acciones correctivas

### 4.3 Reportes

- [ ] Reporte individual de inspección
- [ ] Dashboard de cumplimiento por taller
- [ ] Análisis de ítems con mayor incumplimiento
- [ ] Tendencia mensual de cumplimiento
- [ ] Exportación a PDF

------------------------------------------------------------------------

## 5. Reglas de Negocio

1.  **Frecuencia**: Semanal para talleres de alta actividad (ej:
    Residuos Santa Fe = 4 inspecciones/mes), quincenal para otros.
2.  **Responsable**: Prevencionista de faena.
3.  **Comunicación**: Enviar lista de chequeo con observaciones por
    correo a jefe taller y supervisor de faena, con copia a depto.
    prevención.
4.  **Acompañante**: La inspección se realiza con un acompañante (jefe
    de taller o supervisor).
5.  **Items parciales**: Requieren plazo de corrección y seguimiento.

------------------------------------------------------------------------

## 6. Integraciones

| Módulo | Relación |
|----|----|
| Cronograma SG-SST | Alimenta avance de “Inspección Taller de Mantención” |
| Seguimiento y Control | Hallazgos No Cumple/Parcial se integran al seguimiento |
| EPP | Verificación cruzada de señalización EPP |
| Capacitaciones | Ítems 7-8 se vinculan con capacitaciones de procedimientos |
