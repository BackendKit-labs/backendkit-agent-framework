const {marked} = require('marked');
const {markedTerminal} = require('marked-terminal');
marked.use(markedTerminal());

const md = `# Transaction Module

**Servicio** completo con 6 métodos.

## Gaps detectados

| Aspecto | Estado |
|---|---|
| Controlador | Vacío |
| Auth guards | Pendiente |
| Inmutabilidad | Bug (400 vs 410) |

\`\`\`typescript
private assertNotImmutable(tx: Transaction): void {
  const limit = new Date();
  limit.setDate(limit.getDate() - 30);
  if (new Date(tx.date) < limit) throw new GoneException('...');
}
\`\`\`

> **Veredicto**: NO-GO condicional. Servicio sólido pero controlador vacío.
`;

process.stdout.write(marked.parse(md));
