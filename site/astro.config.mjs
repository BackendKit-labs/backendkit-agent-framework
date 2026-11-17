import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// A white, minimal documentation site. Light only: the theme provider and selector are replaced (see src/components).
export default defineConfig({
  integrations: [
    starlight({
      title: 'BackendKit Agent Framework',
      description: 'Learn to build agents in TypeScript: typed tools, governance, durable flows, MCP and tests.',
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/BackendKit-labs/backendkit-agent-framework' }],
      editLink: { baseUrl: 'https://github.com/BackendKit-labs/backendkit-agent-framework/edit/master/site/' },
      customCss: [
        '@fontsource/ibm-plex-sans/400.css',
        '@fontsource/ibm-plex-sans/500.css',
        '@fontsource/ibm-plex-sans/600.css',
        '@fontsource/ibm-plex-mono/400.css',
        '@fontsource/ibm-plex-mono/500.css',
        './src/styles/custom.css',
      ],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      components: {
        Footer: './src/components/Footer.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      expressiveCode: { themes: ['github-light'], useStarlightUiThemeColors: false },
      lastUpdated: false,
      pagination: true,
      sidebar: [
        {
          label: 'Start here',
          items: [
            { slug: 'start/what-is-it' },
            { slug: 'start/quickstart' },
            { slug: 'start/first-agent' },
          ],
        },
        {
          label: 'Kinds of agents',
          items: [
            { slug: 'agents/overview' },
            { slug: 'agents/assistants' },
            { slug: 'agents/coding' },
            { slug: 'agents/autonomous' },
            { slug: 'agents/knowledge' },
            { slug: 'agents/services' },
            { slug: 'agents/sandboxed' },
            { slug: 'agents/connected' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { slug: 'concepts/engine-and-tools' },
            { slug: 'concepts/providers' },
            { slug: 'concepts/governance' },
            { slug: 'concepts/multi-agent' },
            { slug: 'concepts/flows' },
            { slug: 'concepts/mcp' },
            { slug: 'concepts/memory-and-learning' },
            { slug: 'concepts/observability-and-cost' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { slug: 'guides/govern-a-payment-tool' },
            { slug: 'guides/durable-flow-with-approval' },
            { slug: 'guides/flows-across-processes' },
            { slug: 'guides/test-an-agent' },
            { slug: 'guides/let-a-model-supervise-flows' },
          ],
        },
        {
          label: 'Examples',
          items: [
            { slug: 'examples/overview' },
            { slug: 'examples/starters' },
            {
              label: 'Deep dives',
              items: [
                { slug: 'examples/research-desk' },
                { slug: 'examples/release-captain' },
                { slug: 'examples/audit-desk' },
              ],
            },
          ],
        },
        { label: 'Packages', items: [{ autogenerate: { directory: 'packages' } }] },
      ],
    }),
  ],
});
