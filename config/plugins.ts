import type { Core } from '@strapi/strapi';

// The shop only stores product photos. SVG is refused because it can carry scripts.
const allowedTypes = ['image/*'];
const deniedTypes = ['image/svg+xml'];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  // In production, images go to a Cloudflare R2 bucket (S3-compatible), because
  // Render's free tier erases local files on every restart. Without R2_BUCKET the
  // files stay in public/uploads, as in local development.
  const useR2 = Boolean(env('R2_BUCKET'));

  return {
    'users-permissions': {
      config: {
        // Short-lived access token (jwt) plus a refresh token the storefront
        // keeps in sessionStorage. Cookies are not used because the frontend
        // (Vercel) and this API (Render) are on different sites.
        jwtManagement: 'refresh',
        sessions: {
          accessTokenLifespan: 30 * 60, // 30 minutes
          idleRefreshTokenLifespan: 24 * 60 * 60, // 1 day without use
          maxRefreshTokenLifespan: 7 * 24 * 60 * 60, // 7 days at most
          idleSessionLifespan: 24 * 60 * 60,
          maxSessionLifespan: 7 * 24 * 60 * 60,
          httpOnly: false,
        },
        // Sign-in attempts per IP: 10 per minute.
        ratelimit: { interval: 60000, max: 10 },
      },
    },
    upload: {
      config: {
        sizeLimit: 5 * 1024 * 1024, // 5 MB per image
        security: { allowedTypes, deniedTypes },
        ...(useR2
          ? {
              provider: 'aws-s3',
              providerOptions: {
                // Public address of the bucket (r2.dev subdomain or custom domain).
                baseUrl: env('R2_PUBLIC_URL'),
                s3Options: {
                  endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
                  region: 'auto',
                  forcePathStyle: true,
                  credentials: {
                    accessKeyId: env('R2_ACCESS_KEY_ID'),
                    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
                  },
                  // R2 does not accept the SDK's optional checksum headers on every call.
                  requestChecksumCalculation: 'WHEN_REQUIRED',
                  responseChecksumValidation: 'WHEN_REQUIRED',
                  params: {
                    Bucket: env('R2_BUCKET'),
                    // R2 has no per-object ACLs; leaving ACL undefined stops the
                    // provider from sending its default "public-read".
                    ACL: undefined,
                  },
                },
              },
            }
          : {}),
      },
    },
  };
};

export default config;
