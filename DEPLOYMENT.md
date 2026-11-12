# Deploying ShopKart

| Part | Service | Repository |
| --- | --- | --- |
| Storefront (Nuxt 4) | Vercel | `cuencojasmine/shopkart-web-frontend` |
| API + admin panel (Strapi 5) | Render, free Docker web service | `cuencojasmine/shopkart-web-server` |
| Database (PostgreSQL 18) | Neon | — |
| Product images | Cloudflare R2 bucket | — |
| Keep-awake ping | UptimeRobot | — |

Never commit `.env`, `.env.render` or `.env.vercel`. They are git-ignored.

## How the security works

- **Public role** (shoppers): read products, check out, sign in. Nothing else.
- **Store Manager role**: create, edit and delete products and upload images. `/products` asks for a sign-in.
- **Authenticated role** (any other account): cannot change products.
- Self-registration is off, so the only accounts are the ones you create in the admin panel.
- `src/index.ts` applies these rules every time the server starts. If you change permissions in the admin panel under *Users & Permissions*, the next restart puts them back.
- Checkout is limited to 10 orders per minute per visitor, and sign-in to 10 tries per minute.
- The API accepts browser requests only from the addresses in `FRONTEND_URL`.

## 1. Neon (database)

1. Create a project named `shopkart`. Choose **Postgres 18**, which matches your local PostgreSQL, and region **AWS Asia Pacific (Singapore)**.
2. Under **Connect**, turn **Connection pooling off** and copy the connection string. It looks like `postgresql://neondb_owner:...@ep-....ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.

## 2. Cloudflare R2 (images)

1. In **R2 Object Storage**, create a bucket named `shopkart-images`.
2. Open the bucket, go to **Settings > Public Development URL** and click **Enable**. Copy the `https://pub-....r2.dev` address.
3. In **R2 > Manage API tokens**, create an API token with **Object Read & Write**, limited to `shopkart-images`. Copy the **Access Key ID**, the **Secret Access Key** and your **Account ID**.

## 3. Production environment file

Create `shopkart-server/.env.render` with the content below. Generate the five secrets once with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. `APP_KEYS` needs two values separated by a comma.

```env
NODE_ENV=production
IS_PROXIED=true
PUBLIC_URL=https://shopkart-server.onrender.com
FRONTEND_URL=https://shopkart.vercel.app

APP_KEYS=<secret>,<secret>
API_TOKEN_SALT=<secret>
ADMIN_JWT_SECRET=<secret>
TRANSFER_TOKEN_SALT=<secret>
JWT_SECRET=<secret>
ENCRYPTION_KEY=<secret>

DATABASE_CLIENT=postgres
DATABASE_URL=<Neon connection string>
DATABASE_SSL=true
DATABASE_POOL_MIN=0
DATABASE_POOL_MAX=5

R2_ACCOUNT_ID=<account id>
R2_ACCESS_KEY_ID=<access key id>
R2_SECRET_ACCESS_KEY=<secret access key>
R2_BUCKET=shopkart-images
R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev
```

Fix `PUBLIC_URL` and `FRONTEND_URL` after steps 5 and 6 if Render or Vercel gives a different address.

## 4. Copy the local data to Neon and the images to R2

Run these in Git Bash from `shopkart-server/`:

```bash
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
pg_dump -h 127.0.0.1 -U postgres -Fc -d shopkart-db -f shopkart.dump
pg_restore --no-owner --no-acl -d "$(grep '^DATABASE_URL=' .env.render | cut -d= -f2-)" shopkart.dump
node --env-file=.env.render scripts/migrate-uploads-to-r2.mjs           # dry run
node --env-file=.env.render scripts/migrate-uploads-to-r2.mjs --apply   # upload and repoint
rm shopkart.dump
```

The restore brings your Strapi admin account with it, so nobody else can claim the admin panel on the live site.

## 5. Render (backend)

> **Use a separate Render workspace.** Free hours (750 per month) are shared by every service in a workspace. If iMapSU and ShopKart are both kept awake around the clock in one workspace, the hours run out mid-month and Render suspends **both**. Create a new workspace (for example "ShopKart") from the workspace menu at the top left.

1. **New > Web Service**, then connect `shopkart-web-server`.
2. Set **Language** to *Docker*, **Branch** to `main`, **Region** to *Singapore* and **Instance type** to *Free*.
3. Under **Advanced**, set **Health Check Path** to `/_health`.
4. Under **Environment**, choose **Add from .env** and paste the whole `.env.render`.
5. Deploy. The first build takes about 5 to 10 minutes. When it finishes, `https://<service>.onrender.com/_health` returns an empty 204 response.

## 6. Vercel (frontend)

1. **Add New > Project**, then import `shopkart-web-frontend`. Vercel detects Nuxt.
2. Under **Environment Variables**, add `NUXT_PUBLIC_STRAPI_URL` = `https://<service>.onrender.com` (no trailing slash).
3. Deploy. If the address is not `https://shopkart.vercel.app`, set the real one as `FRONTEND_URL` on Render. Render redeploys automatically.

## 7. Create the Store Manager account

1. Open `https://<service>.onrender.com/admin` and sign in with your existing Strapi admin account.
2. Go to **Content Manager > User > Create new entry**. Enter a username, email and strong password, set **confirmed** to *true* and **role** to *Store Manager*, then save.
3. On the live site, open **Manage Products** and sign in with that account.

## 8. UptimeRobot (keep the backend awake)

Render's free service sleeps after 15 minutes without traffic, and waking up takes about a minute.

1. **New monitor > HTTP(s)**.
2. Set the URL to `https://<service>.onrender.com/_health` and the interval to **5 minutes**.

The health check does not touch the database, so Neon can still sleep and save its free compute hours.

## Updating the live site

- Push to `main` in either repository. Render and Vercel deploy on their own.
- Schema changes (new fields) are applied to Neon automatically when Strapi starts.
