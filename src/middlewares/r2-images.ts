/**
 * Serves product images from the private Cloudflare R2 bucket at
 *   GET /images/<file name>   e.g. /images/small_bag_7da8544b91.png
 *
 * Why: some internet providers block the public r2.dev address, so browsers on
 * those networks could not load images. Serving them from this server means
 * anyone who can reach the shop can see them, and the bucket can stay private.
 *
 * Set R2_PUBLIC_URL to "<PUBLIC_URL>/images" so new uploads get these addresses.
 * Without R2_BUCKET (local development) this middleware does nothing.
 */

import type { Core } from '@strapi/strapi';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Upload file names are letters, digits, "_", "-" and one extension (no folders).
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,200}\.[A-Za-z0-9]{1,10}$/;
const ONE_YEAR = 365 * 24 * 60 * 60;

export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) => {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    return async (_ctx: any, next: () => Promise<void>) => next();
  }

  const s3 = new S3Client({
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return async (ctx: any, next: () => Promise<void>) => {
    if (!ctx.path.startsWith('/images/') || !['GET', 'HEAD'].includes(ctx.method)) {
      return next();
    }

    const key = ctx.path.slice('/images/'.length);
    if (!KEY_PATTERN.test(key)) {
      ctx.status = 404;
      return;
    }

    try {
      const object = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          IfNoneMatch: ctx.get('If-None-Match') || undefined,
        })
      );

      // The bucket only holds product photos; refuse anything else.
      if (!object.ContentType?.startsWith('image/') || object.ContentType === 'image/svg+xml') {
        (object.Body as any)?.destroy?.();
        ctx.status = 404;
        return;
      }

      ctx.set({
        'Content-Type': object.ContentType,
        // File names contain a unique hash, so a file never changes.
        'Cache-Control': `public, max-age=${ONE_YEAR}, immutable`,
        'X-Content-Type-Options': 'nosniff',
        // The storefront runs on another site (Vercel).
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      if (object.ETag) ctx.set('ETag', object.ETag);
      if (object.ContentLength !== undefined) ctx.length = object.ContentLength;

      ctx.status = 200;
      if (ctx.method === 'HEAD') {
        (object.Body as any)?.destroy?.();
        return;
      }
      ctx.body = object.Body;
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      if (status === 304) {
        ctx.status = 304;
      } else if (status === 404 || error?.name === 'NoSuchKey') {
        ctx.status = 404;
      } else {
        strapi.log.error(`[r2-images] ${key}: ${error?.name || error}`);
        ctx.status = 502;
      }
    }
  };
};
