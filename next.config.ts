import type { NextConfig } from 'next';

const config: NextConfig = {
  // output: 'standalone', // built in CI, shipped as an image - never `next build` on the VPS
  typedRoutes: true,
};

export default config;
