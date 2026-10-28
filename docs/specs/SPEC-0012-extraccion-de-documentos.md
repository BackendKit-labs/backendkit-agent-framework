# SPEC-0012: Extracción de documentos a texto (`@backendkit-labs/document-extract`)

**Fecha:** 2026-10-28
**Estado:** Capa 1 implementada en `packages/document-extract` (sin publicar); OCR y visión pendientes
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
| 2 | Confinamiento de rutas | **Hecho así:** contención propia mínima + la misma consulta `ctx.sandbox.authorizePath` que `read_file` (está en los tipos de core). `resolveAndCheck` no se exporta desde `coding`; ideal: exportarla desde `core` y quitar la copia. Un anfitrión con su propio confinamiento pasa `resolvePath` |
| 3 | Motor de OCR on-prem | Evaluar `tesseract.js` con datos de idioma locales |
| 4 | Node mínimo | `unpdf` exige Node ≥ 22; el paquete lo declara |

## 4. Estado y límites conocidos (2026-10-28)
- **Hecho:** PDF con texto, docx, xlsx, csv y texto; 21 pruebas; probado también en Node llano sobre el paquete compilado y sobre xlsx/docx reales de terceros (hojas con cadenas compartidas, unicode, hojas ocultas).
- **Un PDF real sin texto** ("Microsoft Print To PDF" de imágenes) da `NO_TEXT_LAYER`, confirmado también con pdf.js directamente.
- **Tamaños de ZIP: los declarados.** Se revisa el directorio antes de abrir; un archivo que **miente** en su directorio no lo detecta esta comprobación.
- **PDF:** la descompresión de flujos internos no tiene tope propio; solo lo acota `maxBytes` del archivo, el plazo y el límite de páginas. Un PDF hostil puede gastar memoria dentro de ese margen.
- **Hojas ocultas:** se leen igual que las visibles (un anfitrión que no quiera exponerlas debe filtrarlas; hoy no hay opción).
- **Excel con cadenas en CDATA** (`cdata.xlsx` de deepseek) devuelve celdas vacías: límite de `read-excel-file`, sin resolver.
- **Pruebas bajo jest** necesitan `--experimental-vm-modules` (unpdf importa su motor PDF dinámicamente).
- **Sin publicar:** `npm publish` lo hace el propietario; Steward no puede consumirlo hasta entonces.

## 5. Visión y OCR: lo verificado (2026-10-28)
**Requisito del propietario:** Hermes en producción puede usar **otro LLM**. Por tanto nada se decide por proveedor ni por un modelo concreto.

### 5.1 Qué admite el modelo de las pruebas (DeepSeek, prueba en vivo)
- `GET /models` **publica `input_modalities` por modelo**: `deepseek-flash` (V4.1 Flash; `deepseek-v4-flash` resuelve a él) admite `["text","image"]`; **`deepseek-v4-pro` solo `["text"]`**. Dos modelos del mismo proveedor, capacidades distintas: la capacidad es **del modelo**, no del proveedor.
- Una imagen en formato OpenAI (`image_url` con data URL) **se acepta y se entiende** (imagen azul lisa → respondió "Blue"). El bloque `image` estilo Anthropic se rechaza (422; acepta `text`, `image_url` y `file`).
- Una parte `file`: la forma que probé (`file_data` como data URL) dio 400; **sin resolver**, no se asume que el modelo lea PDF.
- Otros proveedores (Anthropic, OpenAI, Ollama con modelos de visión o sin ellos): **no probados**.

### 5.2 OCR sin red (tesseract.js 7, prueba aislada)
- Con `tesseract.js-core` y los datos de idioma (`@tesseract.js-data/spa`, MIT) desde `node_modules`, `langPath`/`corePath` locales y sin caché: **0 intentos de red** (se interceptaron `http`, `https` y `fetch`).
- Factura sintética en español (una imagen limpia): confianza 92, ~1 s por imagen con el motor ya cargado, ~1 s de arranque. Acertó importes, NIF, fecha y tildes; errores: `N°` → `N*`, `IVA 21%` → `IVA21%`. **No es una medida sobre escaneos reales** (ruido, inclinación, baja resolución), que serán peores.
- Peso: núcleo WASM ~30 MB + ~10–14 MB por idioma. Licencias Apache-2.0 y MIT.
- **Riesgo sin comprobar:** OCR de un **PDF escaneado** necesita convertir páginas a imagen. `unpdf` lo hace con `@napi-rs/canvas` (binario nativo, problema ya conocido en la imagen de Steward). Alternativa a verificar: extraer las imágenes incrustadas del PDF (un escaneo suele ser una imagen por página) y pasárselas al OCR sin lienzo.

### 5.3 Propuesta de diseño: la capacidad decide, no el proveedor
1. **Capacidad por modelo:** `inputModalities` declarado en la configuración del modelo (y, cuando el proveedor lo publica como DeepSeek, leído de `/models`). Sin dato, se asume solo texto.
2. **Ruta según capacidad**, la elige el anfitrión (Steward), no el modelo:
   - Texto del documento (PDF/Word/Excel/CSV) → capa 1, siempre, **con cualquier modelo**.
   - Imagen o escaneo: si el modelo admite imagen → enviarla (capa 2); si no → OCR (capa 1b) y enviar el texto; si no hay ninguna → `NO_TEXT_LAYER` y se le dice a la persona.
3. **OCR aunque el modelo vea:** (a) los datos sensibles se enmascaran **como texto** antes de llegar al modelo y una imagen nativa **se salta ese enmascarado**; (b) un entorno aislado sin red o un modelo local de solo texto sigue funcionando; (c) el texto se puede registrar, validar y auditar. Decide el propietario si, con modelo de visión, se prefiere OCR (más control) o imagen (más fidelidad: tablas, sellos, manuscritos).
4. **Capa 2 en el SDK:** ampliar `LLMMessage.content` a partes (`text` | `image`) y que cada proveedor la traduzca a su formato (`image_url` en los compatibles con OpenAI; bloque `image` en Anthropic). Es un cambio de contrato: va en su propio PR.
