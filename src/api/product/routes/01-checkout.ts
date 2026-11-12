/**
 * Custom checkout route.
 *
 * POST /api/products/checkout
 *
 * `auth: false` makes this route public so shoppers can check out without an
 * account. The core CRUD routes are still created by ./product.ts.
 *
 * The rate limiter (reused from the users-permissions plugin) allows each
 * visitor 10 checkouts per minute, so a script cannot drain the stock.
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/products/checkout',
      handler: 'product.checkout',
      config: {
        auth: false,
        middlewares: [
          {
            name: 'plugin::users-permissions.rateLimit',
            config: { interval: { min: 1 }, max: 10 },
          },
        ],
      },
    },
  ],
};
