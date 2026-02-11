# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shopify embedded admin app for managing user-generated content (UGC) from Instagram. Built for the Acumen Camera brand. Merchants can discover content via Instagram hashtags/mentions, curate visible posts, link products, and feature items on their storefront.

## Commands

- **Dev server**: `npm run dev` (runs `shopify app dev`, requires Shopify CLI)
- **Build**: `npm run build` (runs `remix vite:build`)
- **Start production**: `npm run start` (runs `remix-serve ./build/server/index.js`)
- **Lint**: `npm run lint` (ESLint with Remix + Prettier config)
- **Prisma generate**: `npx prisma generate`
- **Prisma migrate**: `npx prisma migrate deploy`
- **Setup (generate + migrate)**: `npm run setup`
- **Deploy to Shopify**: `npm run deploy`

No test framework is configured.

## Architecture

**Framework**: Remix on Vite with file-based routing. JavaScript (JSX), TypeScript-ready but not actively used.

**Key directories**:
- `app/routes/` — Remix file routes using dot-notation nesting (e.g., `_shell.admin.hashtags.jsx`)
- `app/lib/` — Server utilities for Instagram API, R2 storage, UGC resolution, memoization
- `prisma/` — SQLite database (only stores Shopify session data)
- `public/` — Static assets + JSON data files for curated UGC lists
- `extensions/ugc-display/` — Shopify app extension for storefront embedding

**Routing convention**: `_shell.*` routes are nested under the main layout (`_shell.jsx`). Admin routes at `_shell.admin.*`, API routes at `api-*` or `api.*`.

**Data persistence**: UGC visibility/curation data is stored as JSON files in `public/` (not in the database). Paths are configured in `app/lib/persistPaths.js` with env var overrides (`VISIBLE_HASH_PATH`, `VISIBLE_TAG_PATH`).

**Authentication**: Shopify OAuth via `@shopify/shopify-app-remix`. Session storage backed by Prisma. Auth routes under `/auth/*`.

**Instagram integration**: Fetches content via Instagram Graph API. `app/lib/fetchHashtagUGC.js` handles hashtag discovery, `app/lib/ugcResolverTag.server.js` handles mentions. Uses TTL-based memoization (`app/lib/memo.js`) and concurrency limiting (max 6 concurrent API calls).

**Media storage**: Cloudflare R2 (S3-compatible) via `app/lib/r2Client.server.js`. Environment variables prefixed `CF_R2_*`.

**UI**: Shopify Polaris components throughout. Uses Remix `useFetcher` for non-navigating mutations and `defer`/`Await`/`Suspense` for progressive loading.

**API endpoints**: Public JSON APIs in `app/routes/api-*.jsx` with CORS headers (`Access-Control-Allow-Origin: *`). These serve curated UGC and product data to the storefront widget.

## Environment Variables

Required: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `INSTAGRAM_IG_ID`, `INSTAGRAM_ACCESS_TOKEN`, `CF_R2_ACCOUNT_ID`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`, `CF_R2_BUCKET`, `CF_R2_PUBLIC_BASE`

Optional: `PAGE_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `HASHTAGS`, `SHOP_CUSTOM_DOMAIN`, `DATABASE_URL`

## Patterns

- Server-only files use `.server.js` suffix to exclude from client bundles
- Loader functions fetch data; action functions handle POST/PUT/DELETE mutations
- UGC objects are normalized via `buildFromAdmin()`/`normalize()` helpers in resolver files
- Featured items are sorted first, then by timestamp
- `eslint` global: `shopify` is declared as a global variable
