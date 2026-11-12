import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // Public address of this server (e.g. https://shopkart-server.onrender.com).
  // Used for the admin panel and absolute links. Empty in local development.
  ...(env('PUBLIC_URL') ? { url: env('PUBLIC_URL') } : {}),
  // Render (and most hosts) put a proxy in front of the app. Trusting it lets
  // Strapi see HTTPS and the real visitor IP, which secure cookies and the
  // rate limiter need. Keep it off locally.
  proxy: { koa: env.bool('IS_PROXIED', false) },
  app: {
    keys: env.array('APP_KEYS')!,
  },
  logger: { updates: { enabled: false } },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});

export default config;
