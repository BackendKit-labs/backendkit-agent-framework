/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // codex-context-agent-v2's KnowledgeEngine pulls @xenova/transformers +
    // onnxruntime-node (a native .node binary). Keep them external so webpack
    // requires them at runtime instead of trying to bundle the native addon.
    serverComponentsExternalPackages: ['@xenova/transformers', 'onnxruntime-node'],
  },
};

module.exports = nextConfig;
