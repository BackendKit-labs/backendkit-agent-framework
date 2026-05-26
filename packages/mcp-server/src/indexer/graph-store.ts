import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import type { SymbolKind } from './languages/index';

export interface NodeRow {
    id: string;
    name: string;
    qualified_name: string;
    kind: string;
    language: string;
    file_path: string;
    start_line: number;
    end_line: number;
    signature: string;
    exported: number;
    updated_at: number;
}

export interface EdgeRow {
    source_id: string;
    target_id: string;
    kind: string;
    file_path: string;
    line: number;
}

export interface SearchResult extends NodeRow {
    rank: number;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS files (
    path         TEXT PRIMARY KEY,
    language     TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    node_count   INTEGER DEFAULT 0,
    indexed_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    kind           TEXT NOT NULL,
    language       TEXT NOT NULL,
    file_path      TEXT NOT NULL,
    start_line     INTEGER NOT NULL,
    end_line       INTEGER NOT NULL,
    signature      TEXT DEFAULT '',
    exported       INTEGER DEFAULT 0,
    updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    name,
    qualified_name,
    signature,
    content=nodes,
    content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, name, qualified_name, signature)
    VALUES (new.rowid, new.name, new.qualified_name, new.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, name, qualified_name, signature)
    VALUES ('delete', old.rowid, old.name, old.qualified_name, old.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, name, qualified_name, signature)
    VALUES ('delete', old.rowid, old.name, old.qualified_name, old.signature);
    INSERT INTO nodes_fts(rowid, name, qualified_name, signature)
    VALUES (new.rowid, new.name, new.qualified_name, new.signature);
END;

CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    kind      TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line      INTEGER NOT NULL,
    PRIMARY KEY (source_id, target_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
`;

export function nodeId(filePath: string, name: string, startLine: number): string {
    return createHash('sha1')
        .update(`${filePath}:${name}:${startLine}`)
        .digest('hex')
        .slice(0, 16);
}

export class GraphStore {
    private readonly db: Database.Database;

    constructor(dbPath: string) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        this.db.exec(SCHEMA);
    }

    // --- File tracking ---

    getFileHash(filePath: string): string | undefined {
        const row = this.db
            .prepare('SELECT content_hash FROM files WHERE path = ?')
            .get(filePath) as { content_hash: string } | undefined;
        return row?.content_hash;
    }

    upsertFile(filePath: string, language: string, contentHash: string, nodeCount: number): void {
        this.db.prepare(`
            INSERT INTO files (path, language, content_hash, node_count, indexed_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                language = excluded.language,
                content_hash = excluded.content_hash,
                node_count = excluded.node_count,
                indexed_at = excluded.indexed_at
        `).run(filePath, language, contentHash, nodeCount, Date.now());
    }

    removeFile(filePath: string): void {
        const tx = this.db.transaction(() => {
            this.db.prepare('DELETE FROM edges WHERE file_path = ?').run(filePath);
            this.db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
            this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
        });
        tx();
    }

    // --- Nodes ---

    upsertNodes(nodes: Omit<NodeRow, 'updated_at'>[]): void {
        const now = Date.now();
        const stmt = this.db.prepare(`
            INSERT INTO nodes (id, name, qualified_name, kind, language, file_path, start_line, end_line, signature, exported, updated_at)
            VALUES (@id, @name, @qualified_name, @kind, @language, @file_path, @start_line, @end_line, @signature, @exported, @updated_at)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                qualified_name = excluded.qualified_name,
                kind = excluded.kind,
                signature = excluded.signature,
                exported = excluded.exported,
                start_line = excluded.start_line,
                end_line = excluded.end_line,
                updated_at = excluded.updated_at
        `);
        const tx = this.db.transaction((rows: Omit<NodeRow, 'updated_at'>[]) => {
            for (const row of rows) {
                stmt.run({ ...row, updated_at: now });
            }
        });
        tx(nodes);
    }

    removeNodesForFile(filePath: string): void {
        this.db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
    }

    // --- Edges ---

    upsertEdges(edges: EdgeRow[]): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO edges (source_id, target_id, kind, file_path, line)
            VALUES (@source_id, @target_id, @kind, @file_path, @line)
        `);
        const tx = this.db.transaction((rows: EdgeRow[]) => {
            for (const row of rows) stmt.run(row);
        });
        tx(edges);
    }

    removeEdgesForFile(filePath: string): void {
        this.db.prepare('DELETE FROM edges WHERE file_path = ?').run(filePath);
    }

    // --- Search ---

    search(query: string, limit = 20): SearchResult[] {
        return this.db.prepare(`
            SELECT n.*, fts.rank
            FROM nodes_fts fts
            JOIN nodes n ON fts.rowid = n.rowid
            WHERE nodes_fts MATCH ?
            ORDER BY fts.rank
            LIMIT ?
        `).all(query, limit) as SearchResult[];
    }

    getNode(id: string): NodeRow | undefined {
        return this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
    }

    getNodesByFile(filePath: string): NodeRow[] {
        return this.db.prepare('SELECT * FROM nodes WHERE file_path = ?').all(filePath) as NodeRow[];
    }

    getOutgoingEdges(nodeId: string): EdgeRow[] {
        return this.db.prepare('SELECT * FROM edges WHERE source_id = ?').all(nodeId) as EdgeRow[];
    }

    getIncomingEdges(nodeId: string): EdgeRow[] {
        return this.db.prepare('SELECT * FROM edges WHERE target_id = ?').all(nodeId) as EdgeRow[];
    }

    stats(): { files: number; nodes: number; edges: number } {
        const files = (this.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n;
        const nodes = (this.db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number }).n;
        const edges = (this.db.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number }).n;
        return { files, nodes, edges };
    }

    close(): void {
        this.db.close();
    }
}
