import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { canImprove, canAccessVault } from '@/lib/permissions';
import type { UserRole } from '@/db/schema';
import { searchVault } from '@/lib/curator-codex-client';

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session?.user || !canImprove(session.user.role as UserRole)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { message, history, vaultId } = await req.json() as {
        message: string;
        history: { role: string; content: string }[];
        vaultId?: string;
    };

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return NextResponse.json({ reply: 'DEEPSEEK_API_KEY no configurado en el servidor.', suggestions: [] });

    // RAG: fetch relevant context from vault if one is selected
    let ragContext  = '';
    let ragSources: string[] = [];

    if (vaultId) {
        try {
            const [vault] = await db
                .select()
                .from(schema.vaultDefinitions)
                .where(eq(schema.vaultDefinitions.id, vaultId))
                .limit(1);

            if (vault && canAccessVault(session.user.role as UserRole, vault.ownerRole as 'admin' | 'technical' | 'business')) {
                const ragResult = await searchVault(vault.path, message, 5);
                if (ragResult.results.length > 0) {
                    ragSources = ragResult.results.map(r => r.title);
                    ragContext = ragResult.results
                        .map(r => `### ${r.title}\n${r.content.slice(0, 800)}`)
                        .join('\n\n---\n\n');
                }
            }
        } catch (err) {
            // RAG failure is non-fatal — continue without context
            console.warn('[improve] RAG search failed:', err);
        }
    }

    const systemPrompt = [
        'Sos un experto en gestión de conocimiento y mejora de contenido técnico.',
        'Tu rol es ayudar a mejorar notas del vault de la empresa.',
        'Cuando sugerís cambios concretos, estructurálos al final como JSON en este formato:',
        '<suggestions>',
        '[{ "type": "replace|append|retag", "preview": "texto del cambio sugerido" }]',
        '</suggestions>',
        'Sé directo y específico.',
        ...(ragContext ? [
            '',
            '## Contexto relevante del vault',
            'Usá el siguiente contenido como base para tus respuestas y sugerencias:',
            '',
            ragContext,
        ] : []),
    ].join('\n');

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
    ];

    const res = await fetch('https://api.deepseek.com/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ model: process.env.LLM_MODEL ?? 'deepseek-chat', messages, temperature: 0, stream: false }),
    });

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const raw  = data.choices[0]?.message?.content ?? '';

    const suggestionsMatch = raw.match(/<suggestions>([\s\S]*?)<\/suggestions>/);
    let suggestions: { type: string; preview: string; applied: boolean }[] = [];
    let reply = raw.replace(/<suggestions>[\s\S]*?<\/suggestions>/g, '').trim();

    if (suggestionsMatch) {
        try {
            const parsed = JSON.parse(suggestionsMatch[1]) as { type: string; preview: string }[];
            suggestions  = parsed.map(s => ({ ...s, applied: false }));
        } catch {
            // ignore parse errors
        }
    }

    return NextResponse.json({ reply, suggestions, ragSources });
}
