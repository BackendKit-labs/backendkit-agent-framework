/** @type {import('next').NextConfig} */
const DIRECTOR_URL = process.env.DIRECTOR_URL || 'http://localhost:4000';

const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3500',
  },
  async rewrites() {
    return [
      { source: '/api/director/:path*', destination: `${DIRECTOR_URL}/api/:path*` },
    ];
  },
};
export default nextConfig;
