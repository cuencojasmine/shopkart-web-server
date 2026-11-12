import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => {
  // Image host of the Cloudflare R2 bucket (e.g. pub-xxxx.r2.dev), so the admin
  // panel may show product images stored there.
  const r2PublicUrl = env('R2_PUBLIC_URL', '');
  const imageHosts = r2PublicUrl ? [new URL(r2PublicUrl).host] : [];

  return [
    'strapi::logger',
    'strapi::errors',
    // GET /images/<file> streams product images from R2 (src/middlewares/r2-images.ts)
    'global::r2-images',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', ...imageHosts],
            'media-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', ...imageHosts],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: 'strapi::cors',
      config: {
        // Only the storefront may call the API from a browser.
        // FRONTEND_URL accepts a comma-separated list, e.g.
        // https://shopkart.vercel.app,http://localhost:3000
        origin: env.array('FRONTEND_URL', ['http://localhost:3000']),
        headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
        credentials: false,
      },
    },
    'strapi::poweredBy',
    'strapi::query',
    {
      name: 'strapi::body',
      config: {
        // Product photos only; matches the upload plugin's sizeLimit.
        formidable: { maxFileSize: 5 * 1024 * 1024 },
      },
    },
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};

export default config;
