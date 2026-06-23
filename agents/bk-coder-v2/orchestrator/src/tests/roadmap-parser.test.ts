import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { parseRoadmap, loadRoadmapPhases } from '../roadmap-parser.js';

// ── parseRoadmap ──────────────────────────────────────────────────────────────

describe('parseRoadmap', () => {

    test('basic English format: ## Phase 1: Title', () => {
        const md = '## Phase 1: Core Setup\nGoal: set up the project.\n- [ ] Create package.json';
        const phases = parseRoadmap(md);
        assert.equal(phases.length, 1);
        assert.equal(phases[0].number, 1);
        assert.equal(phases[0].title, 'Core Setup');
    });

    test('Spanish format: ## Fase 1: Título', () => {
        const md = '## Fase 1: Configuración inicial\nObjetivo: arrancar el proyecto.';
        const phases = parseRoadmap(md);
        assert.equal(phases.length, 1);
        assert.equal(phases[0].title, 'Configuración inicial');
    });

    test('em dash separator: ## Phase 1 — Title', () => {
        const md = '## Phase 1 — Authentication Module';
        const phases = parseRoadmap(md);
        assert.equal(phases.length, 1);
        assert.equal(phases[0].title, 'Authentication Module');
    });

    test('period separator: ## Phase 1. Title', () => {
        const md = '## Phase 1. Project Bootstrap';
        const phases = parseRoadmap(md);
        assert.equal(phases.length, 1);
        assert.equal(phases[0].title, 'Project Bootstrap');
    });

    test('triple hash: ### Phase 1: Title', () => {
        const md = '### Phase 1: Setup';
        const phases = parseRoadmap(md);
        assert.equal(phases.length, 1);
        assert.equal(phases[0].title, 'Setup');
    });

    test('multiple phases', () => {
        const md = [
            '## Phase 1: Setup',
            'Body of phase 1.',
            '## Phase 2: Implementation',
            'Body of phase 2.',
            '## Phase 3: Testing',
            'Body of phase 3.',
        ].join('\n');
        const phases = parseRoadmap(md);
        assert.equal(phases.length, 3);
        assert.equal(phases[0].number, 1);
        assert.equal(phases[1].number, 2);
        assert.equal(phases[2].number, 3);
    });

    test('out-of-order phases are sorted and renumbered', () => {
        const md = [
            '## Phase 3: Last',
            '## Phase 1: First',
            '## Phase 2: Middle',
        ].join('\n');
        const phases = parseRoadmap(md);
        assert.equal(phases[0].title, 'First');
        assert.equal(phases[1].title, 'Middle');
        assert.equal(phases[2].title, 'Last');
        // Sequential re-numbering
        assert.equal(phases[0].number, 1);
        assert.equal(phases[2].number, 3);
    });

    test('extracts checkbox criteria', () => {
        const md = [
            '## Phase 1: Setup',
            '- [ ] Create package.json',
            '- [ ] Configure TypeScript',
            '- [x] Already done item',
            'Some other text.',
        ].join('\n');
        const phases = parseRoadmap(md);
        assert.equal(phases[0].criteria.length, 3);
        assert.equal(phases[0].criteria[0], 'Create package.json');
        assert.equal(phases[0].criteria[2], 'Already done item');
    });

    test('phase with no criteria returns empty array', () => {
        const md = '## Phase 1: Setup\nJust a description, no checkboxes.';
        const phases = parseRoadmap(md);
        assert.deepEqual(phases[0].criteria, []);
    });

    test('body includes the phase description text', () => {
        const md = '## Phase 1: Setup\nThis is the detailed body.\n- [ ] A criterion';
        const phases = parseRoadmap(md);
        assert.ok(phases[0].body.includes('This is the detailed body.'));
    });

    test('empty string returns no phases', () => {
        assert.deepEqual(parseRoadmap(''), []);
    });

    test('markdown without Phase headers returns no phases', () => {
        const md = '# ROADMAP\n## Overview\nThis is a project.';
        assert.deepEqual(parseRoadmap(md), []);
    });

    test('phase title is trimmed of extra whitespace', () => {
        const md = '## Phase 1:   Lots of spaces   ';
        const phases = parseRoadmap(md);
        assert.equal(phases[0].title, 'Lots of spaces');
    });

    test('phase with no title gets default title', () => {
        const md = '## Phase 1\nContent here.';
        const phases = parseRoadmap(md);
        assert.equal(phases[0].title, 'Phase 1');
    });
});

// ── loadRoadmapPhases ─────────────────────────────────────────────────────────

describe('loadRoadmapPhases', () => {

    test('loads from .specs/ROADMAP.md', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-test-'));
        try {
            const specsDir = path.join(tmpDir, '.specs');
            fs.mkdirSync(specsDir);
            fs.writeFileSync(
                path.join(specsDir, 'ROADMAP.md'),
                '## Phase 1: Setup\n- [ ] Create files\n## Phase 2: Implement\n- [ ] Write code',
            );
            const phases = loadRoadmapPhases(tmpDir);
            assert.equal(phases.length, 2);
            assert.equal(phases[0].title, 'Setup');
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    test('falls back to root ROADMAP.md when .specs/ missing', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-test-'));
        try {
            fs.writeFileSync(
                path.join(tmpDir, 'ROADMAP.md'),
                '## Phase 1: Fallback\n',
            );
            const phases = loadRoadmapPhases(tmpDir);
            assert.equal(phases.length, 1);
            assert.equal(phases[0].title, 'Fallback');
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    test('returns empty array when no ROADMAP exists', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-test-'));
        try {
            const phases = loadRoadmapPhases(tmpDir);
            assert.deepEqual(phases, []);
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });
});
