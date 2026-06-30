/** @type {import('next').NextConfig} */
const config = {
    async rewrites() {
        const gateway  = process.env.GATEWAY_URL  ?? 'http://localhost:3400';
        const director = process.env.DIRECTOR_URL ?? 'http://localhost:4000';
        const abac     = process.env.ABAC_URL     ?? 'http://localhost:3005';
        return [
            // director-api — must come before the catch-all gateway rule
            { source: '/api/director/:path*', destination: `${director}/api/:path*` },
            // abac-service — resources & permissions endpoints
            { source: '/api/abac/:path*', destination: `${abac}/:path*` },
            // SSE is handled by the Next.js Route Handler (app/api/runs/stream)
            // All other gateway calls are proxied here
            { source: '/api/:path((?!runs/stream).*)', destination: `${gateway}/api/:path` },
        ];
    },
};

export default config;
