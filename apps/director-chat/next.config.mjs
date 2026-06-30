/** @type {import('next').NextConfig} */
const ABAC_URL = process.env.ABAC_URL || 'http://localhost:3005';
const DIRECTOR_URL = process.env.DIRECTOR_URL || 'http://localhost:4000';

const nextConfig = {
  env: {
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3500',
  },
  async rewrites() {
    return [
      { source: '/api/auth/:path*', destination: `${ABAC_URL}/auth/:path*` },
      { source: '/api/director/:path*', destination: `${DIRECTOR_URL}/api/:path*` },
    ];
  },
};
export default nextConfig;
