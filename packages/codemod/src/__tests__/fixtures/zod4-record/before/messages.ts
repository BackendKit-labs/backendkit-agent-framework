import { z } from 'zod';

export const name = z.string({ invalid_type_error: 'must be text', required_error: 'required' });
export const ok = z.record(z.number());
