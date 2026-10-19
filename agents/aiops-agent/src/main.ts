import { OllamaProvider } from '@backendkit-labs/agent-coding';
import { OllamaEmbedder } from '@backendkit-labs/agent-enterprise';
import { ClassifierAgent, DeciderAgent, ProviderLLM } from './agents';
import { loadConfig } from './config';
import { openDb } from './db';
import { Orchestrator, type RunResult } from './orchestrator';
import { SCENARIOS, buildAlert, customAlert } from './scenarios';
import { SimilarIncidents } from './similar';
import { createTools } from './tools';

interface CliArgs { scenario?: string; alert?: string; list: boolean; help: boolean }

function parseArgs(argv: string[]): CliArgs {
    const out: CliArgs = { list: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--scenario') out.scenario = argv[++i];
        else if (a === '--alert') out.alert = argv[++i];
        else if (a === '--list') out.list = true;
        else if (a === '--help' || a === '-h') out.help = true;
    }
    return out;
}

const USAGE = `Uso: npm start -- --scenario <nombre> | --alert "<texto>" | --list
Escenarios: ${Object.keys(SCENARIOS).join(', ')}
Env: OLLAMA_BASE_URL, MODEL_NAME, EMBED_MODEL, DB_PATH, LOG_PATH`;

export function renderSummary(r: RunResult, logPath: string): string {
    const lines: string[] = [];
    lines.push('='.repeat(64));
    lines.push(`Alerta ${r.alertId} → ${r.finalAction.toUpperCase()}`);
    lines.push(`Riesgo: ${r.riskLevel} | Confianza: ${r.confidence} | Requiere aprobación: ${r.requiresApproval ? 'SÍ' : 'NO'}`);
    if (r.classification) lines.push(`Clasificación: ${r.classification.severity}/${r.classification.category} — ${r.classification.summary}`);
    if (r.server) lines.push(`Servidor: ${r.server.found ? `${r.server.name} (${r.server.env}, criticidad ${r.server.criticality}, cpu ${r.server.cpu_pct}%, ${r.server.status})` : `${r.server.name} NO encontrado`}`);
    lines.push(`Políticas: ${r.policyIds.join(', ') || 'ninguna'}`);
    if (r.similar) lines.push(`Similares (${r.similar.method}): ${r.similar.matches.map(m => `${m.id}@${m.score}`).join(', ') || 'ninguno'} | embed ${r.similar.embed_ms} ms, búsqueda ${r.similar.search_ms} ms`);
    lines.push(`Evidencia: ${r.evidence.join(', ') || 'n/a'}`);
    if (r.justification.length) {
        lines.push('Justificación:');
        for (const j of r.justification) lines.push(`  • ${j}`);
    }
    lines.push(`Herramienta (simulada): ${r.toolName ?? 'ninguna'} → ${JSON.stringify(r.toolResult)}`);
    lines.push(`Log: ${logPath} (${r.events.length} eventos)`);
    lines.push('='.repeat(64));
    return lines.join('\n');
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || (!args.scenario && !args.alert && !args.list)) {
        console.log(USAGE);
        return args.help ? 0 : 1;
    }
    if (args.list) {
        for (const [k, v] of Object.entries(SCENARIOS)) console.log(`${k}: ${v.text}`);
        return 0;
    }

    const cfg = loadConfig();
    const alert = args.scenario ? buildAlert(args.scenario) : customAlert(args.alert as string);

    const provider = new OllamaProvider({ host: cfg.ollamaBaseUrl, model: cfg.modelName, temperature: 0, maxTokens: 500 });
    try {
        await provider.checkConnection();
    } catch (e) {
        console.error(`Ollama no disponible: ${(e as Error).message}`);
        return 2;
    }

    const db = openDb(cfg.dbPath);
    const embedder = new OllamaEmbedder({ host: cfg.ollamaBaseUrl, model: cfg.embedModel });
    const similar = new SimilarIncidents(db, embedder);
    const llm = new ProviderLLM(provider, cfg.llmTimeoutMs);
    const orch = new Orchestrator({
        db, tools: createTools({ db, similar }),
        classifier: new ClassifierAgent(llm), decider: new DeciderAgent(llm),
        logPath: cfg.logPath, maxAlertChars: cfg.maxAlertChars,
    });

    const result = await orch.run(alert);
    console.log(renderSummary(result, cfg.logPath));
    db.close();
    return 0;
}

if (require.main === module) {
    main().then(code => process.exit(code)).catch(err => {
        console.error(`Error fatal: ${(err as Error).message}`);
        process.exit(1);
    });
}
