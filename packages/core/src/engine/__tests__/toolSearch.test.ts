import type { ToolDefinition } from '../../types';
import { describeFound, isDeferred, matchesDeferPattern, rankTools, scoreTool } from '../toolSearch';

const t = (name: string, description = '', extra: Partial<ToolDefinition> = {}): ToolDefinition =>
    ({ name, description, parameters: { type: 'object' }, execute: async () => '', ...extra });

describe('matchesDeferPattern', () => {
    it('matches an exact name, a prefix with *, and everything with a lone *', () => {
        expect(matchesDeferPattern('crm_find', ['crm_find'])).toBe(true);
        expect(matchesDeferPattern('crm_find', ['crm_*'])).toBe(true);
        expect(matchesDeferPattern('crm_find', ['crm'])).toBe(false);
        expect(matchesDeferPattern('anything', ['*'])).toBe(true);
        expect(matchesDeferPattern('x', [])).toBe(false);
    });
});

describe('isDeferred', () => {
    it('is true for a tool marked defer, or matched by the profile, and false otherwise', () => {
        expect(isDeferred(t('a', '', { defer: true }), {})).toBe(true);
        expect(isDeferred(t('a'), { deferTools: ['a'] })).toBe(true);
        expect(isDeferred(t('a'), { deferTools: ['b*'] })).toBe(false);
        expect(isDeferred(t('a'), {})).toBe(false);
    });
});

describe('rankTools', () => {
    const tools = [t('crm_find_contact', 'Find a contact'), t('crm_find_deal', 'Find a deal'), t('invoice_send', 'Send an invoice to a contact')];

    it('puts a word of the name above a word of the description, and drops what matches nothing', () => {
        expect(rankTools('contact', tools, 5).map(x => x.name)).toEqual(['crm_find_contact', 'invoice_send']);
        expect(rankTools('zebra', tools, 5)).toEqual([]);
    });

    it('ties keep the order of the candidates and maxResults cuts the list', () => {
        expect(rankTools('find', tools, 5).map(x => x.name)).toEqual(['crm_find_contact', 'crm_find_deal']);
        expect(rankTools('find', tools, 1).map(x => x.name)).toEqual(['crm_find_contact']);
    });

    it('is case-insensitive and splits on punctuation; one-letter words are noise', () => {
        expect(rankTools('FIND-deal!', tools, 5)[0].name).toBe('crm_find_deal');
        expect(scoreTool(words('a'), tools[0])).toBe(0);
    });
});

function words(s: string): string[] { return s.split(' ').filter(w => w.length > 1); }

describe('describeFound', () => {
    it('lists the names with a short description, and says so when there are none', () => {
        expect(describeFound([])).toMatch(/No tool matches/);
        expect(describeFound([t('a', 'does  a\nthing')])).toBe('1 tool is now available to call:\n- a: does a thing');
        expect(describeFound([t('a', 'x'), t('b', 'y')])).toMatch(/^2 tools are now available/);
    });

    it('with the schema, it says to call by name and carries the parameters of each tool', () => {
        const withParams = { ...t('a', 'x'), parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } };
        const out = describeFound([withParams], true);
        expect(out).toContain('1 tool is now available to call by name, with arguments that match its parameters:');
        expect(out).toContain('parameters (JSON Schema): {"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}');
        expect(describeFound([withParams])).not.toContain('JSON Schema');
    });
});
