# Documentación técnica de aval-scheduler-agent

Agente autónomo que lee pagos programados y los ejecuta a través de AVAL — reconciliación,
priorización con contexto, y tres formas de dispararlo.

Esto es la referencia detallada. Para la presentación de la idea y el porqué, ver el
[`README.md`](../README.md) de la raíz.

## Índice

1. [Arquitectura](./01-arquitectura.md) — el recorrido de una corrida, los tres procesos, por qué el store lee/escribe del disco en cada llamada
2. [Herramientas](./02-herramientas.md) — las seis que ve el LLM, con parámetros y por qué el `idempotencyKey` nunca lo inventa
3. [Panel admin](./03-panel-admin.md) — rutas de la API, autenticación, por qué vive en el mismo proceso
4. [Variables de entorno](./04-variables-de-entorno.md)
5. [Limitaciones conocidas](./05-limitaciones.md)

## Cómo ejecutarlo

```bash
npm install
cp .env.example .env   # completar AVAL_URL, AVAL_KEY, DEEPSEEK_API_KEY
npm run build
npm start
```

Necesita una instancia de AVAL corriendo (`npm run dev` en `../internet`) y un agente ya dado de
alta ahí — `checkAval()` falla el arranque si `AVAL_URL` no responde o `AVAL_KEY` no tiene forma
de credencial de agente. Ver [04 · Variables de entorno](./04-variables-de-entorno.md).
