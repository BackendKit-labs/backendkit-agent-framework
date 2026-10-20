import { isBearerAuthorized } from '../auth.js';

describe('isBearerAuthorized', () => {
    it.each([
        [undefined, false],
        ['', false],
        ['Bearer ', false],
        ['bearer key', false],
        ['Basic key', false],
        ['Bearer wrong', false],
        ['Bearer key-longer', false],
        ['Bearer key', true],
    ])('%p -> %p', (header, expected) => {
        expect(isBearerAuthorized(header, 'key')).toBe(expected);
    });
});
