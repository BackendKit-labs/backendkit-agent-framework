import type { GraphStore } from './graph-store';

/**
 * Enriched stack detection using the indexed import graph.
 * Detects specific frameworks and libraries beyond just the language.
 *
 * Returns a flat list of detected technologies, e.g.:
 *   ['typescript', 'node', 'nestjs', 'typeorm', 'graphql']
 *   ['python', 'fastapi', 'sqlalchemy', 'pydantic']
 */

interface FrameworkSignature {
    tech: string;
    /** Import path fragments that indicate this tech is in use */
    importPatterns: string[];
}

const SIGNATURES: FrameworkSignature[] = [
    // Node / TypeScript
    { tech: 'nestjs',      importPatterns: ['@nestjs/'] },
    { tech: 'express',     importPatterns: ['express'] },
    { tech: 'fastify',     importPatterns: ['fastify'] },
    { tech: 'typeorm',     importPatterns: ['typeorm'] },
    { tech: 'prisma',      importPatterns: ['@prisma/client', 'prisma'] },
    { tech: 'graphql',     importPatterns: ['graphql', '@apollo/', 'apollo-server', 'type-graphql'] },
    { tech: 'mongoose',    importPatterns: ['mongoose'] },
    { tech: 'sequelize',   importPatterns: ['sequelize'] },
    { tech: 'react',       importPatterns: ['react', 'react-dom', 'next'] },
    { tech: 'nextjs',      importPatterns: ['next/', 'next/app', 'next/router'] },
    { tech: 'vue',         importPatterns: ['vue', '@vue/'] },
    { tech: 'angular',     importPatterns: ['@angular/'] },
    { tech: 'jest',        importPatterns: ['jest', '@jest/'] },
    { tech: 'vitest',      importPatterns: ['vitest'] },
    { tech: 'zod',         importPatterns: ['zod'] },
    { tech: 'trpc',        importPatterns: ['@trpc/'] },
    { tech: 'rxjs',        importPatterns: ['rxjs'] },
    // Python
    { tech: 'fastapi',     importPatterns: ['fastapi'] },
    { tech: 'django',      importPatterns: ['django'] },
    { tech: 'flask',       importPatterns: ['flask'] },
    { tech: 'sqlalchemy',  importPatterns: ['sqlalchemy'] },
    { tech: 'pydantic',    importPatterns: ['pydantic'] },
    { tech: 'celery',      importPatterns: ['celery'] },
    { tech: 'pytest',      importPatterns: ['pytest'] },
    // Go
    { tech: 'gin',         importPatterns: ['gin-gonic/gin', 'github.com/gin-gonic'] },
    { tech: 'echo',        importPatterns: ['labstack/echo'] },
    { tech: 'fiber',       importPatterns: ['gofiber/fiber'] },
    { tech: 'gorm',        importPatterns: ['gorm.io/gorm'] },
    // Rust
    { tech: 'actix',       importPatterns: ['actix-web', 'actix_web'] },
    { tech: 'axum',        importPatterns: ['axum'] },
    { tech: 'tokio',       importPatterns: ['tokio'] },
    { tech: 'diesel',      importPatterns: ['diesel'] },
    { tech: 'serde',       importPatterns: ['serde'] },
    // Java
    { tech: 'spring',      importPatterns: ['org.springframework'] },
    { tech: 'quarkus',     importPatterns: ['io.quarkus'] },
    { tech: 'micronaut',   importPatterns: ['io.micronaut'] },
    { tech: 'hibernate',   importPatterns: ['org.hibernate'] },
    { tech: 'junit',       importPatterns: ['org.junit'] },
];

export function detectStackFromGraph(store: GraphStore): string[] {
    const stats = store.stats();
    if (stats.nodes === 0) return [];

    // Gather all unique import sources from the index
    const importSources = store.getAllImportSources();

    const detected = new Set<string>();

    for (const sig of SIGNATURES) {
        const found = sig.importPatterns.some(pattern =>
            importSources.some(src => src.includes(pattern)),
        );
        if (found) detected.add(sig.tech);
    }

    return [...detected];
}
