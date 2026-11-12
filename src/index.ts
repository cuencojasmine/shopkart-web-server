import type { Core } from '@strapi/strapi';

/**
 * API permissions, applied every time the server starts so a fresh database
 * (e.g. Neon) and the local one always behave the same.
 *
 * - Public (shoppers, not signed in): read products, check out, sign in.
 *   Checkout is a public route (auth: false), so it needs no permission here.
 * - Store Manager (the account used on /products): full product CRUD and
 *   image upload.
 * - Authenticated (default role for any other account): no product changes.
 *
 * Self-registration is turned off, so only accounts created in the Strapi admin
 * panel (Content Manager > User) can sign in.
 */

const PUBLIC_ACTIONS = [
  'api::product.product.find',
  'api::product.product.findOne',
  'plugin::users-permissions.auth.callback', // POST /api/auth/local (sign in)
  'plugin::users-permissions.auth.refresh', // POST /api/auth/refresh
];

const MANAGER_ROLE = {
  type: 'store_manager',
  name: 'Store Manager',
  description: 'Can create, edit and delete products and upload product images.',
};

const MANAGER_ACTIONS = [
  'api::product.product.find',
  'api::product.product.findOne',
  'api::product.product.create',
  'api::product.product.update',
  'api::product.product.delete',
  'plugin::upload.content-api.upload',
  'plugin::users-permissions.auth.logout',
  'plugin::users-permissions.user.me',
];

// Actions no other role may ever have.
const WRITE_ACTIONS = [
  'api::product.product.create',
  'api::product.product.update',
  'api::product.product.delete',
  'plugin::upload.content-api.upload',
  'plugin::upload.content-api.destroy',
];

type RoleMode = 'exact' | 'deny';

async function syncRolePermissions(
  strapi: Core.Strapi,
  roleId: number,
  actions: string[],
  mode: RoleMode
) {
  const permissions = strapi.db.query('plugin::users-permissions.permission');
  const current: { id: number; action: string }[] = await permissions.findMany({
    where: { role: roleId },
    select: ['id', 'action'],
  });

  // 'exact': the role gets exactly `actions`.
  // 'deny': the role keeps its own permissions except the ones in `actions`.
  const toRemove =
    mode === 'exact'
      ? current.filter((permission) => !actions.includes(permission.action))
      : current.filter((permission) => actions.includes(permission.action));

  for (const permission of toRemove) {
    await permissions.delete({ where: { id: permission.id } });
  }

  if (mode === 'exact') {
    const existing = new Set(current.map((permission) => permission.action));
    for (const action of actions.filter((a) => !existing.has(a))) {
      await permissions.create({ data: { action, role: roleId } });
    }
  }
}

async function setupPermissions(strapi: Core.Strapi) {
  const roles = strapi.db.query('plugin::users-permissions.role');

  const publicRole = await roles.findOne({ where: { type: 'public' } });
  const authenticatedRole = await roles.findOne({ where: { type: 'authenticated' } });
  let managerRole = await roles.findOne({ where: { type: MANAGER_ROLE.type } });

  if (!managerRole) {
    managerRole = await roles.create({ data: MANAGER_ROLE });
    strapi.log.info('[shopkart] Created the "Store Manager" role.');
  }

  if (publicRole) await syncRolePermissions(strapi, publicRole.id, PUBLIC_ACTIONS, 'exact');
  if (authenticatedRole) await syncRolePermissions(strapi, authenticatedRole.id, WRITE_ACTIONS, 'deny');
  await syncRolePermissions(strapi, managerRole.id, MANAGER_ACTIONS, 'exact');

  // Nobody can create their own account from the storefront.
  const store = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const advanced = ((await store.get({ key: 'advanced' })) as Record<string, unknown>) || {};
  if (advanced.allow_register !== false) {
    await store.set({ key: 'advanced', value: { ...advanced, allow_register: false } });
  }
}

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await setupPermissions(strapi);
  },
};
