import path from 'node:path';

const basePath = process.env.EVOMATE_BASE_PATH || '';
const staticExport = process.env.EVOMATE_STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(staticExport ? { output: 'export', trailingSlash: true } : {}),
  ...(basePath ? { basePath } : {}),
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  images: {
    unoptimized: true
  },
  transpilePackages: []
};

export default nextConfig;
