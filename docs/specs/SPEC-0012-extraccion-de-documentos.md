# SPEC-0012: Extracción de documentos a texto (`@backendkit-labs/document-extract`)

**Fecha:** 2026-10-28
**Estado:** Borrador (capa 1 en implementación)
**Origen:** Steward SPEC-0006 §7 (consola de Hermes: soltar documentos para analizarlos o procesarlos)

> **Decidido (propietario, 2026-10-28):**
> 1. El SDK no tiene hoy herramienta para leer imágenes, PDF ni ofimática; **es una mejora del SDK** y se empieza por la **capa 1: extracción a texto**.
> 2. **No atarse a un tipo de documento.** La pieza extrae el contenido; qué es y qué hacer con él lo decide el agente.
>
> **Todo lo demás es propuesta del asistente.**

## 1. Qué hay hoy (verificado 2026-10-28)
`LLMMessage.content` es `string | null`; los proveedores solo envían texto; `read_file` lee solo UTF-8 y `search_files` salta binarios; ningún paquete depende de librerías de PDF, Word, Excel ni OCR; `web`, `web-ui` y `enterprise` no tienen subida de archivos.

### Referencia: deepseek-harness
Tampoco extraen texto: su `read` es solo UTF-8 y el PDF figura como trabajo diferido (`tool-fs`, `web-fetch-http`); `pdfjs` solo se usa en la vista previa del cliente. Resuelven los documentos con **visión** (`read_image`, solo si el modelo declara entrada de imagen) y **LibreOffice** (Office → PDF o imagen, para vista previa y revisión visual). Es la capa 2 de esta propuesta, no la 1.
**Se toma de ellos el envoltorio, no el método:** formato detectado por la **firma** de los bytes (no por la extensión), límites fijos por archivo, errores con código estable y una instrucción de recuperación para el modelo, resultado acotado, y rechazo en ejecución cuando no se puede procesar.

## 2. Propuesta

### 2.1 Dos piezas separadas
1. **`extractDocument(bytes, options)`**: función pura, sin rutas ni sistema de archivos. La usan quienes ya tienen los bytes (Steward guarda lo subido por departamento, no por ruta).
2. **`createReadDocumentTool(options)`**: herramienta fina (`defineTool`) que lee un archivo bajo la raíz permitida y llama a la función.

### 2.2 Resultado
Texto con marcadores de **página** (PDF) u **hoja** (Excel) y metadatos: `format`, `pages`/`sheets`, `hasTextLayer`, `truncated`, `bytes`. **Nunca campos interpretados** ("importe", "proveedor"): interpretar es del modelo. El texto extraído va en la herramienta marcado como **dato no confiable** (un documento puede traer instrucciones).

### 2.3 Primer corte
| Formato | Cómo | Notas |
|---|---|---|
| PDF con capa de texto | `unpdf` (MIT, sin binarios nativos) | Sin capa de texto devuelve `NO_TEXT_LAYER` ("necesita OCR"): **no inventa** |
| Word `.docx` | `mammoth` (BSD-2), texto plano | `.doc` antiguo: no soportado |
| Excel `.xlsx` | `read-excel-file` (MIT) | **No `xlsx`/SheetJS de npm**: 0.18.5 sin mantener y con vulnerabilidades conocidas |
| CSV / texto | integrado | |

**Segundo corte:** OCR (imágenes y PDF escaneados), como dependencia opcional y **sin descargar datos en ejecución** (instalación sin red). **Tercero:** capa 2 (imagen nativa al modelo).

### 2.4 Límites y errores (todos configurables, con valores por defecto)
Tamaño del archivo; páginas y hojas; tamaño **descomprimido** y número de entradas (docx/xlsx son ZIP: bomba de descompresión); archivos cifrados; plazo (`AbortSignal`); tope de caracteres de salida (corta y marca `truncated`).
Errores con código estable y recuperación: `UNSUPPORTED_FORMAT`, `TOO_LARGE`, `TOO_MANY_PAGES`, `ARCHIVE_TOO_LARGE`, `ENCRYPTED`, `CORRUPT`, `NO_TEXT_LAYER`, `TIMEOUT`.

### 2.5 Seguridad
Detección por firma (`%PDF`; ZIP con `[Content_Types].xml` y `word/` o `xl/`). Se revisa el directorio central del ZIP **antes** de descomprimir. La herramienta confina las rutas a la raíz de trabajo.

## 3. Preguntas abiertas
| # | Pregunta | Propuesta |
|---|---|---|
| 1 | Paquete nuevo o dentro de `coding` | Paquete nuevo: las librerías pesadas no deben entrar a quien no las usa |
| 2 | Confinamiento de rutas | `resolveAndCheck` no se exporta desde `coding`; hoy la herramienta lleva una comprobación mínima propia. Ideal: exportarla desde `core` |
| 3 | Motor de OCR on-prem | Evaluar `tesseract.js` con datos de idioma locales |
| 4 | Node mínimo | `unpdf` exige Node ≥ 22; el paquete lo declara |
