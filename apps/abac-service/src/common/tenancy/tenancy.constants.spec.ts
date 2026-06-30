import {
    SYSTEM_ORG_ID,
    SYSTEM_ORG_SLUG,
    DEFAULT_ORG_ID,
    DEFAULT_ORG_SLUG,
} from './tenancy.constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('tenancy.constants', () => {
    it('System y Default tienen UUIDs válidos y fijos', () => {
        expect(SYSTEM_ORG_ID).toMatch(UUID_RE);
        expect(DEFAULT_ORG_ID).toMatch(UUID_RE);
        // Reservados — no deben cambiar (la migración los siembra con estos valores).
        expect(SYSTEM_ORG_ID).toBe('00000000-0000-0000-0000-000000000001');
        expect(DEFAULT_ORG_ID).toBe('00000000-0000-0000-0000-000000000002');
    });

    it('System y Default son organizaciones distintas', () => {
        expect(SYSTEM_ORG_ID).not.toBe(DEFAULT_ORG_ID);
        expect(SYSTEM_ORG_SLUG).not.toBe(DEFAULT_ORG_SLUG);
    });
});
