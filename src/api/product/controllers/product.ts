/**
 * product controller
 *
 * Keeps the default CRUD actions (find, findOne, create, update, delete)
 * and adds a `checkout` action used by the storefront's "Checkout All" flow.
 */

import { randomBytes } from 'crypto';
import { factories } from '@strapi/strapi';

const PAYMENT_METHODS = ['Cash on Delivery', 'GCash', 'Maya', 'Bank Transfer'];

// Upper limits so one request cannot be abused to do huge amounts of work.
const MAX_CART_LINES = 50;
const MAX_QUANTITY = 1000;
const MAX_NAME_LENGTH = 100;
const MAX_ADDRESS_LENGTH = 300;

// Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX
const PH_MOBILE_REGEX = /^(09|\+639)\d{9}$/;

// Thrown inside the transaction so every stock change is rolled back.
class CheckoutError extends Error {
  problems: string[];

  constructor(problems: string[]) {
    super('Some items in your cart can no longer be purchased.');
    this.problems = problems;
  }
}

export default factories.createCoreController('api::product.product', ({ strapi }) => ({
  async checkout(ctx) {
    const body = ctx.request.body?.data ?? {};
    const customer = body.customer ?? {};
    const rawItems = Array.isArray(body.items) ? body.items : [];

    // ===== 1. Validate the customer details =====
    const fullName = String(customer.fullName ?? '').trim();
    const contactNumber = String(customer.contactNumber ?? '').replace(/[\s-]/g, '');
    const deliveryAddress = String(customer.deliveryAddress ?? '').trim();
    const paymentMethod = String(customer.paymentMethod ?? '').trim();

    const formErrors: string[] = [];
    if (fullName.length < 2) formErrors.push('Full name is required.');
    if (fullName.length > MAX_NAME_LENGTH) formErrors.push('Full name is too long.');
    if (deliveryAddress.length > MAX_ADDRESS_LENGTH) formErrors.push('Delivery address is too long.');
    if (!PH_MOBILE_REGEX.test(contactNumber)) {
      formErrors.push('Contact number must look like 09XXXXXXXXX or +639XXXXXXXXX.');
    }
    if (deliveryAddress.length < 10) formErrors.push('Please enter a complete delivery address.');
    if (!PAYMENT_METHODS.includes(paymentMethod)) formErrors.push('Please choose a valid payment method.');

    if (formErrors.length > 0) {
      return ctx.badRequest('Please check your checkout details.', { errors: formErrors });
    }

    // ===== 2. Validate the cart items (merge duplicates by documentId) =====
    if (rawItems.length > MAX_CART_LINES) {
      return ctx.badRequest(`A single order can have at most ${MAX_CART_LINES} products.`);
    }

    const quantities = new Map<string, number>();

    for (const item of rawItems) {
      const documentId = typeof item?.documentId === 'string' ? item.documentId : '';
      const quantity = Number(item?.quantity);

      if (!documentId || documentId.length > 64 || !Number.isInteger(quantity) || quantity < 1) {
        return ctx.badRequest('Your cart contains an invalid item.');
      }

      const total = (quantities.get(documentId) ?? 0) + quantity;
      if (total > MAX_QUANTITY) {
        return ctx.badRequest(`You can order at most ${MAX_QUANTITY} of one product.`);
      }

      quantities.set(documentId, total);
    }

    if (quantities.size === 0) {
      return ctx.badRequest('Your cart is empty.');
    }

    // ===== 3. Check stock and deduct it inside one database transaction =====
    try {
      const order = await strapi.db.transaction(async ({ trx }) => {
        // Lock the purchased product rows until this transaction finishes, so two
        // shoppers checking out at the same time cannot both buy the last item.
        await trx('products')
          .whereIn('document_id', [...quantities.keys()])
          .forUpdate()
          .select('id');

        const productService = strapi.documents('api::product.product');
        const lines = [];
        const problems: string[] = [];

        for (const [documentId, quantity] of quantities) {
          const product = await productService.findOne({ documentId });

          if (!product) {
            problems.push('A product in your cart no longer exists.');
            continue;
          }

          const stock = Number(product.stock ?? 0);

          if (!product.is_active) {
            problems.push(`${product.name} is no longer available.`);
          } else if (stock <= 0) {
            problems.push(`${product.name} is out of stock.`);
          } else if (quantity > stock) {
            problems.push(`Only ${stock} left of ${product.name} (you requested ${quantity}).`);
          } else {
            lines.push({ product, quantity, stock });
          }
        }

        // Nothing has been written yet, but throwing also rolls back the transaction.
        if (problems.length > 0) {
          throw new CheckoutError(problems);
        }

        const items = [];

        for (const { product, quantity, stock } of lines) {
          await productService.update({
            documentId: product.documentId,
            data: { stock: stock - quantity },
          });

          const price = Number(product.price ?? 0);

          items.push({
            documentId: product.documentId,
            name: product.name,
            price,
            quantity,
            subtotal: price * quantity,
            remainingStock: stock - quantity,
          });
        }

        return {
          // Time + random part, so two orders in the same millisecond still differ.
          reference: `SK-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`.toUpperCase(),
          customer: { fullName, contactNumber, deliveryAddress, paymentMethod },
          items,
          totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
          totalAmount: items.reduce((sum, item) => sum + item.subtotal, 0),
          placedAt: new Date().toISOString(),
        };
      });

      ctx.body = { data: order };
    } catch (error) {
      if (error instanceof CheckoutError) {
        return ctx.badRequest(error.message, { errors: error.problems });
      }

      throw error;
    }
  },
}));
