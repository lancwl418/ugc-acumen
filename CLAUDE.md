# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Shopify Custom App（嵌入后台），用于 Instagram UGC 内容运营。不是单纯的 UGC 展示工具，长期目标是构建内容驱动的品牌社区层。

核心功能流程：
1. 从 Instagram 抓取 UGC（Mentions/Tags 来源）
2. 在 Shopify 后台人工筛选可展示内容、设定分类
3. 为 UGC 关联 Shopify 产品，关联 Creator 与 Shopify 客户
4. 前端瀑布流展示，Modal 中展示产品卡片

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

三层架构：Instagram 数据层 → Node + Remix 后端层（Shopify Embedded App）→ Shopify 前端展示层

数据流：Instagram Graph API → 后端抓取 → Prisma/SQLite 持久化 → Shopify 前端通过 API 拉取 → 瀑布流展示

**Framework**: Remix on Vite with file-based routing. JavaScript (JSX), TypeScript-ready but not actively used.

**Key directories**:
- `app/routes/` — Remix file routes using dot-notation nesting (e.g., `_shell.admin.mentionsugc.jsx`)
- `app/lib/` — Server utilities for Instagram API, R2 storage, UGC sync, visible mentions management
- `prisma/` — SQLite database (Session, Mention, VisibleMention, Comment, CreatorLink, Product)
- `public/` — Static assets + storefront widget (`widget.js`)
- `extensions/ugc-display/` — Shopify app extension for storefront embedding

**Routing convention**: `_shell.*` routes are nested under the main layout (`_shell.jsx`). Admin routes at `_shell.admin.*`, API routes at `api-*` or `api.*`.

**Data persistence**: All UGC data stored in Prisma/SQLite. `Mention` holds raw fetched posts, `VisibleMention` holds curated/approved posts, `CreatorLink` maps Instagram usernames to Shopify customers, `Product` caches Shopify product data.

**Authentication**: Shopify OAuth via `@shopify/shopify-app-remix`. Session storage backed by Prisma. Auth routes under `/auth/*`.

**UGC 抓取模块**:
- `app/lib/instagramAPI.js` — Instagram Graph API 封装
- `app/lib/fetchInstagram.js` — 抓取 mentions/tags 数据
- `app/lib/syncAllMentions.server.js` — 批量同步到 Mention 表
- `app/lib/visibleMentions.js` — VisibleMention CRUD 操作

**Media CDN**: Instagram 媒体内容存储到 Cloudflare R2（S3-compatible），通过 `app/lib/r2Client.server.js` 上传。环境变量前缀 `CF_R2_*`。

**UI**: Shopify Polaris components throughout. Uses Remix `useFetcher` for non-navigating mutations and `defer`/`Await`/`Suspense` for progressive loading.

**Public API endpoints**: `app/routes/api-*.jsx` with CORS headers (`Access-Control-Allow-Origin: *`). Serve curated UGC and product data to the storefront widget.

## Environment Variables

Required: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `INSTAGRAM_IG_ID`, `INSTAGRAM_ACCESS_TOKEN`, `CF_R2_ACCOUNT_ID`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`, `CF_R2_BUCKET`, `CF_R2_PUBLIC_BASE`

Optional: `PAGE_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `SHOP_CUSTOM_DOMAIN`

Database (Supabase PostgreSQL): `DATABASE_URL` (connection pooler, port 6543), `DIRECT_URL` (direct connection, port 5432, used for migrations)

## Patterns

- Server-only files use `.server.js` suffix to exclude from client bundles
- Loader functions fetch data; action functions handle POST/PUT/DELETE mutations
- UGC objects are normalized via `buildFromAdmin()`/`normalize()` helpers in resolver files
- Featured items are sorted first, then by timestamp
- `eslint` global: `shopify` is declared as a global variable
