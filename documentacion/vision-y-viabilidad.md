# Visión y Viabilidad: Agentes con LLMs Locales Orquestados

> Evaluación honesta de la tesis central del sistema: agentes con LLMs locales,
> alimentados con el conocimiento de negocio de la empresa, orquestados de forma
> autónoma con supervisión humana.

---

## La tesis es sólida — y el timing es correcto

La idea central tiene tres patas que se refuerzan entre sí:

### 1. El conocimiento de negocio vale más que el modelo

Los LLMs se vuelven commodity; lo que diferencia a un agente útil de uno genérico
es el contexto institucional. El vault como memoria acumulativa es la apuesta
correcta — **es el activo que nadie puede copiar**. Una empresa que lleva dos años
alimentando su vault tiene agentes que ningún competidor puede replicar comprando
el mismo software.

### 2. Privacidad por diseño es un argumento de venta real

Para RRHH, nómina, legal, datos de clientes — hay empresas (sobre todo en sectores
regulados o en LATAM con leyes de protección de datos) que directamente *no pueden*
mandar esos datos a un API cloud. **"Tus datos nunca salen de tu servidor" no es
marketing, es un requisito de compra.**

### 3. La gobernanza como feature, no como freno

Niveles de autonomía, gates de aprobación, audit trail — la mayoría de los
frameworks de agentes tratan esto como un agregado. Acá es el centro del diseño,
y para venderle a una empresa real eso es lo que importa.

---

## Riesgo #1: los LLMs locales son débiles exactamente donde el diseño los necesita fuertes

Esta es la tensión que hay que mirar de frente:

| Tarea | ¿Qué tan bien la hace un modelo local (7B-70B)? |
|---|---|
| Resumir, redactar, extraer datos de un texto | Bien — suficiente para producción |
| Responder con contexto RAG bien recuperado | Bien — si el retrieval es bueno, el modelo no necesita ser brillante |
| **Generar un plan DAG válido en JSON** | Regular — los modelos chicos fallan formato y lógica de dependencias con frecuencia |
| **Decidir cuándo escalar vs. ejecutar** | Mal — requiere juicio calibrado, lo más difícil para modelos chicos |
| **Tool use confiable en loops largos** | Mal-regular — se pierden, alucinan argumentos, repiten llamadas |

El TaskPlanner y la lógica de escalación — las piezas más críticas del sistema —
son precisamente las que más sufren con un modelo local. Las defensas en capas
existen *porque* esto es así. Pero hay que ser realista: con un modelo de 7B el
retry de 3 intentos va a agotarse seguido.

### Mitigación: routing híbrido

La privacidad se necesita en la **ejecución sobre datos**, no necesariamente en
la **planificación abstracta**. Planificar "analizar impacto de migración" no
expone datos sensibles.

```
Planner / Router      → mejor modelo disponible (cloud si la tarea
                         no contiene datos sensibles)
Especialistas que     → LLM local (Ollama)
tocan datos sensibles
Especialistas de      → cloud (DeepSeek, Anthropic) por calidad
razonamiento general
```

Esa distinción es la que hace viable el sistema hoy.

### La curva juega a favor

Los modelos locales actuales (Qwen, Llama, DeepSeek destilados) ya hacen cosas
que hace un año requerían cloud. El diseño que es "apenas viable" con modelos
locales de 2026 va a ser cómodo en dos años. **Construir la arquitectura ahora
es apostar a esa curva — apuesta razonable.**

---

## Riesgo #2: el flywheel arranca frío

"La calidad de los agentes es proporcional a la calidad del vault" corta para
los dos lados. El día uno, el vault está vacío y los agentes son genéricos —
y ahí es cuando la empresa evalúa si el sistema sirve. **Si la primera impresión
es mala, no hay segunda.**

Es un problema de adopción, no de arquitectura — pero mata productos buenos.

### Respuesta práctica

- El onboarding del sistema incluye una **fase de ingesta intensiva**:
  documentación existente, wikis, manuales, decisiones históricas — el vault
  nace con masa crítica, no vacío
- Arrancar con un **caso de uso acotado** donde poco conocimiento bien curado
  alcanza (el pilot de onboarding de empleados es el approach correcto)

---

## Riesgo #3: el costo operativo escondido

Una empresa que adopta esto necesita:

- Servidor con GPU para Ollama
- Redis en operación
- Alguien que cure el vault
- Alguien que atienda la cola de aprobaciones

Para una pyme eso puede ser más caro que el problema que resuelve.

### El sweet spot del producto

| Segmento | ¿Encaja? | Por qué |
|---|---|---|
| Empresa chica | No | No justifica la infraestructura |
| **Empresa mediana en sector regulado** | **Sí** | Volumen de procesos repetitivos para amortizar + sensibilidad de datos que hace "local" un requisito + sin equipo propio de IA |
| Corporación grande | Difícil | Ya tiene equipos de ML que construyen in-house |

---

## Veredicto

La idea es **correcta y defendible**, con una condición: aceptar que hoy es un
sistema **híbrido con núcleo local**, no un sistema puramente local.

### Fortalezas reales

1. **El vault como memoria institucional acumulativa** — es el moat
2. **Gobernanza nativa** (niveles, gates, audit) — es lo que las alternativas no tienen
3. **Privacy by routing** — argumento de venta concreto

### Debilidad real

La calidad de los modelos locales en planning y juicio. Se mitiga con el routing
híbrido y se resuelve sola con el tiempo.

### Dónde demuestra su valor primero

**Workflows estáticos de nivel 2-3 en procesos administrativos repetitivos**:
onboarding, reportes, reconciliaciones. Ahí:

- el plan no depende del LLM (flow estático pre-definido)
- el conocimiento del vault hace la diferencia
- el gate humano cubre el margen de error

```
El modo dinámico con TaskPlanner  → la visión a futuro
Los flows estáticos               → el producto de hoy
```

---

## Conectores MCP: el siguiente paso natural

Sin conectores a sistemas de empresa (ERP, mensajería, correo), los agentes saben
pero no actúan — todo termina en una nota que un humano ejecuta. Los conectores
refuerzan las tres fortalezas del veredicto:

- **El moat se alimenta solo**: conectores de lectura traen datos vivos del negocio
  al vault — resuelven también el flywheel frío
- **La gobernanza se vuelve tangible**: el gate era abstracto con notas Markdown;
  con un `erp_create_order` es vendible
- **El privacy routing protege algo real**: con el ERP conectado hay datos
  sensibles de verdad en juego

La secuencia para etapa temprana: **2-3 conectores de solo-lectura** (el ERP del
cliente piloto + mensajería), demostrar valor sin riesgo, y recién después
habilitar escritura gated. Para el demo de venta, "preguntale al agente cuántas
facturas vencen esta semana" (consulta real al ERP) convence infinitamente más
que "el agente busca en notas Markdown".

Detalle completo en [arquitectura-sistema-multiagente.md](arquitectura-sistema-multiagente.md),
sección "Conectores MCP a sistemas de empresa".

---

## Evolución: fine-tuning y modelos de razonamiento locales

Los LLMs locales evolucionan rápido. La estrategia para aprovecharlos sigue una
regla de división estricta:

> **RAG para hechos, fine-tuning para habilidades, razonamiento para juicio.**

### La trampa a evitar: entrenar el modelo con la documentación

La intuición natural — "entrenemos el modelo con el vault para que sepa del
negocio" — es la jugada equivocada:

| Conocimiento en los pesos (fine-tuning) | Conocimiento en el vault (RAG) |
|---|---|
| No se puede actualizar sin re-entrenar | Se actualiza editando un Markdown |
| No se puede auditar ("¿por qué dijiste eso?") | Cada respuesta cita sus fuentes |
| No se puede borrar (derecho al olvido — problema legal real) | Se borra la nota y listo |
| Mezcla hechos y alucina híbridos plausibles | El hecho está o no está |
| La política de 2025 queda fosilizada | La política vigente es la del archivo |

Para un sistema cuyo argumento de venta es **auditabilidad y gobernanza**, meter
el conocimiento del negocio en pesos inauditables contradice la tesis. Las
políticas especialmente: *jamás* en los pesos — siguen siendo carga determinística
en runtime.

### Donde el fine-tuning sí brilla: enseñar la tarea, no el contenido

Entrenar modelos chicos (LoRA sobre un 7B) en las **habilidades estrechas** donde
hoy fallan:

```
1. Generar planes DAG válidos       ← el TaskPlanner, la debilidad #1
   input: tarea + lista de agentes → output: JSON válido con depends_on

2. Clasificar workflows (el router)
   input: tarea → output: workflow-id + confianza

3. Decidir escalación
   input: subtarea + políticas → output: ejecutar | gate | escalar

4. Formatear notas para el vault
   input: resultado crudo → output: nota con frontmatter correcto
```

Son tareas con formato cerrado, evaluables automáticamente (¿el JSON parsea?,
¿el DAG es válido?), y exactamente donde los modelos locales chicos pierden
contra cloud. Un 7B fine-tuneado en *una* de estas tareas le gana a un modelo
genérico 10 veces más grande.

### La joya escondida: la gobernanza genera los datos de entrenamiento

El diseño de gates y auditoría produce datasets etiquetados **como subproducto**:

```
Cada gate aprobado/rechazado      → ejemplo etiquetado de decisión correcta/incorrecta
Cada plan que pasó validación     → ejemplo positivo de plan válido
Cada plan rechazado + el error    → ejemplo negativo con explicación
Cada corrección humana a una nota → par (borrador, versión corregida)
Cada escalación resuelta como
  "podías hacerlo solo"           → ejemplo de sobre-escalación
```

A los 6 meses de operación con un cliente hay miles de ejemplos reales de "así
se planifica en esta empresa", "esto se escala, esto no". **El moat se duplica**:
vault (conocimiento) + datasets de supervisión humana (habilidades). El segundo
emerge gratis de la gobernanza ya diseñada — ningún competidor lo tiene.

### El ciclo de mejora

```
1. Sistema opera con modelo genérico + defensas en capas (hoy)
        │  los gates y validaciones generan datos etiquetados
        ▼
2. Distilación: un modelo de razonamiento grande (DeepSeek-R1, etc.)
   genera/limpia ejemplos adicionales para la tarea puntual
        │
        ▼
3. LoRA sobre un 7B local con esos datos → "bk-planner-7b"
        │
        ▼
4. El modelo fine-tuneado reemplaza al genérico EN ESA TAREA
   (las defensas en capas siguen — ahora fallan mucho menos)
        │
        └──► vuelve a 1, con mejor modelo
```

### Modelos de razonamiento: solo donde el juicio paga el costo

Los modelos de razonamiento locales (destilados de R1, QwQ) son lentos y caros
en tokens — pensar 2000 tokens antes de responder no es para todo:

| Tarea | Modelo | Por qué |
|---|---|---|
| Planificar (TaskPlanner) | **Razonamiento** local | La decisión que más paga el costo de pensar |
| Pre-evaluar un gate | **Razonamiento** | Resumir riesgos para el humano requiere juicio |
| Verificación cruzada de resultados | **Razonamiento** | Detectar inconsistencias es razonamiento puro |
| Ejecutar subtarea con RAG | 7B rápido (fine-tuneado) | El contexto hace el trabajo, no el modelo |
| Clasificar, formatear, extraer | 7B rápido (fine-tuneado) | Tarea cerrada, velocidad importa |

El razonamiento se asigna a las tres piezas identificadas como las más débiles
con modelos locales. Y la arquitectura ya lo soporta sin cambios: el
`ProviderRegistry` asigna modelo por agente — un modelo de razonamiento o un
fine-tuneado son solo providers nuevos en el YAML.

### Los costos honestos

1. **Evaluación antes que entrenamiento** — sin un harness de evals (¿qué % de
   planes válidos genera el modelo X sobre 200 tareas de prueba?) no se sabe si
   el fine-tuning mejoró o empeoró. Es el prerequisito, y no existe hoy.
2. **Mantenimiento** — cada modelo fine-tuneado envejece: nuevos agentes en el
   catálogo → re-entrenar el planner. Presupuestar el ciclo, no solo el primer
   entrenamiento.
3. **No antes de tiempo** — fine-tunear con 50 ejemplos sobreajusta. La secuencia:
   operar con genérico + defensas → acumular datos reales → entrenar con masa
   crítica (miles de ejemplos). **El fine-tuning es la fase 2 del producto, no la 1.**

---

*Documento relacionado: [arquitectura-sistema-multiagente.md](arquitectura-sistema-multiagente.md)*
