import type { NextConfig } from 'next';

const config: NextConfig = {
  typedRoutes: true,
  // Public source revision only; never put runtime credentials in build-time env.
  env: { APP_REVISION: /^[a-f0-9]{40}$/i.test(process.env.COMMIT_REF ?? '') ? process.env.COMMIT_REF! : 'local' },
  async headers() {
    return [{ source: '/track/:path*', headers: [
      { key: 'Cache-Control', value: 'private, no-store' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ] }];
  },
};

export default config;
