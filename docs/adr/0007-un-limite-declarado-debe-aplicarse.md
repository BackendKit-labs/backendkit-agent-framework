# ADR-0007: Un límite declarado debe aplicarse

**Fecha:** 2026-10-24
**Estado:** Propuesto
**Spec:** [SPEC-0009 §C3](../specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md)

## Contexto
Hermes (`@backendkit-labs/hermes`) acepta límites en `fleet.yaml` y en los blueprints. Lo verificado en el código (2026-10-24):

| Límite | Dónde | Estado |
|---|---|---|
| `limits.ttlMinutes` | blueprint | **Aplicado:** fija `expiresAt` y retira la instancia (`Provisioning.ts:222-233`). |
| `maxLive` | política de aprovisionamiento | **Aplicado:** se comprueba antes de crear. |
| `limits.maxConcurrent` | entrada del fleet (`schema.ts:67`) | **No aplicado.** El propio schema lo dice: "concurrency and budget are not enforced yet". |
| `limits.budgetUsdPerDay` | entrada del fleet (`schema.ts:68`) | **No aplicado.** |
| `limits.budgetUsdPerDay` | blueprint (`provisioning.ts:23`) | **Obligatorio y no aplicado:** si el creador tiene techo, el blueprint debe declararlo y no superarlo (`provisioning.ts:88-91`), pero nada lo vigila como gasto. |

El último caso es el más dañino. Obliga al operador a escribir una cifra que no controla nada, y esa cifra parece una garantía en el `fleet.yaml` y en el registro de auditoría. Es peor que dejar el campo opcional.

El core ya tiene la mitad de la solución para el presupuesto: `CostTracker` calcula el costo por ejecución y por día, y `abortOnBudget` detiene el motor ([ADR-0002](0002-aborto-automatico-por-presupuesto.md)). Lo que falta es conectar el límite declarado por un agente de la flota con ese mecanismo, y hoy el presupuesto es por engine, no por agente de la flota.

## Decisión
**Un campo de límite no entra en un schema público si no tiene enforcement o un aviso explícito de que no lo tiene.** Se aplica a Hermes y al core.

1. **Regla de revisión:** un PR que añade un campo de límite a un schema declara en su descripción quién lo aplica y con qué test. Si no lo aplica, el campo se rechaza, o se acepta con un aviso visible y un criterio de retirada.
2. **`maxConcurrent`:** se aplica con un semáforo por agente en el registro o en el conector de la flota. Es pequeño y no depende de nada más.
3. **Presupuesto del blueprint:** deja de ser obligatorio mientras no se aplique. El techo del creador (`creator.budgetUsdPerDay`) se sigue usando para **acotar** lo declarado, pero no se exige declarar una cifra.
4. **Mientras un límite siga sin aplicarse:** `bk-hermes validate` emite un aviso por cada uno (`budgetUsdPerDay` y `maxConcurrent` declarados sin enforcement), y el registro de auditoría de una creación indica que el límite es solo declarativo. **No se rechazan** los `fleet.yaml` existentes que ya los traen: sería un cambio incompatible sin ganancia.
5. **Presupuesto aplicado:** para los agentes en proceso (`InProcessConnector`), Hermes construye el engine con `observability.budget` y `abortOnBudget` a partir del límite declarado. Cuando eso esté, el campo pasa de "aviso" a "aplicado" y el aviso se retira. Para agentes remotos (`protocol`), la aplicación es del servidor remoto y el campo sigue siendo declarativo, y así se documenta.

## Consecuencias
### Positivas
- Lo que dice el `fleet.yaml` coincide con lo que ocurre, o dice con claridad que no ocurre.
- Se retira la falsa garantía del presupuesto obligatorio.
- La regla evita que el problema reaparezca con los campos que se añadan después, por ejemplo el tipo `Capability` de [SPEC-0009 §C5](../specs/SPEC-0009-confianza-del-workspace-y-limites-aplicados.md).

### Negativas / trade-offs
- Trabajo extra al añadir cualquier límite: hay que cablearlo y probarlo antes de exponerlo.
- El presupuesto aplicado solo cubre agentes en proceso; un agente remoto sigue dependiendo de su propio servidor.
- Los avisos son ruido hasta que el enforcement llegue.

## Alternativas consideradas
- **Quitar los campos del schema.** Rechazada: rompe `fleet.yaml` existentes por un límite que sí se quiere aplicar pronto.
- **Dejarlos como están.** Rechazada: es la falsa garantía que motiva esta decisión.
- **Rechazar los `fleet.yaml` que declaran límites no aplicados.** Rechazada por ahora: incompatible sin ganancia. Puede volver como endurecimiento en una versión posterior si el enforcement sigue sin llegar.
- **Aplicar el presupuesto solo en el core, sin tocar Hermes.** Insuficiente: el core no sabe qué agente de la flota es quién; la atribución por agente es parte del trabajo.
