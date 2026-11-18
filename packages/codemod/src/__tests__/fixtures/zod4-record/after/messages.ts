import { z } from 'zod';

// TODO(codemod): invalid_type_error and required_error are one `error` in zod 4, and its messages changed; see the migration guide
export const name = z.string({ invalid_type_error: 'must be text', required_error: 'required' });
export const ok = z.record(z.string(), z.number());
