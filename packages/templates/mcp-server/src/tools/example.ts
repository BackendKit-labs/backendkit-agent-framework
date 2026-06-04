import { z } from 'zod';

export const exampleInputSchema = z.object({
    query: z.string().describe('The query to process'),
});

export async function exampleHandler({ query }: z.infer<typeof exampleInputSchema>): Promise<string> {
    // TODO: implement your tool logic
    return `Result for: ${query}`;
}
