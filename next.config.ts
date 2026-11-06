import type { NextConfig } from 'next';

const config: NextConfig = {
  typedRoutes: true,
  async headers() {
    return [{ source: '/track/:path*', headers: [
      { key: 'Cache-Control', value: 'private, no-store' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ] }];
  },
};

export default config;
