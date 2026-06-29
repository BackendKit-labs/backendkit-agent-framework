import type { NextConfig } from 'next';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const ABAC_URL = process.env.ABAC_URL || 'http://localhost:3005';

const nextConfig: NextConfig = {
  images: {
    domains: [],
  },
  async rewrites() {
    return [
      // Auth proxied directly to abac-service (IdP)
      {
        source: '/api/auth/:path*',
        destination: `${ABAC_URL}/auth/:path*`,
      },
      // Everything else → cloud-platform backend
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
