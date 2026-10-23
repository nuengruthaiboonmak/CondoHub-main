import type { NextConfig } from 'next';

const s3Host = (process.env.S3_ENDPOINT ?? '').replace(/^https?:\/\//, '').split('/')[0];

const connectSrc = ["'self'", 'wss:'];
if (s3Host !== undefined && s3Host !== '') connectSrc.push(`https://${s3Host}`);
const imgSrc = ["'self'", 'data:', 'blob:'];
if (s3Host !== undefined && s3Host !== '') imgSrc.push(`https://${s3Host}`);

const contentSecurityPolicy = [
  "default-src 'self'",
  `img-src ${imgSrc.join(' ')}`,
  `connect-src ${connectSrc.join(' ')}`,
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
