# Changelog

Yihu One follows [Semantic Versioning](https://semver.org/). `0.x` releases are **beta**. The version lives in [`VERSION`](VERSION); bump it with `./scripts/bump-version.sh <x.y.z>` (see [docs/版本管理.md](docs/版本管理.md)).

Release notes are kept in one place so the console can show them to users:
[`console/docs/devcenter/releases.md`](console/docs/devcenter/releases.md) (served at `/dev/releases` on every installation).
Integration-facing changes (APIs, SDK, manifest) are in [`console/docs/devcenter/changelog.md`](console/docs/devcenter/changelog.md).

## 0.6.3 — 2026-10-17

Patch release. The agent no longer loses operation results: if the console's database stalls when the agent reports back (e.g. while Docker deletes a removed app's images), the result used to be dropped silently, leaving the console on 「正在移除 …」 and the removed app still listed. `yh agent` now waits for the console's confirmation, retries for ~30 s, and otherwise queues the call and replays it in order once the console is back (op results, app remove / disable). No database changes.

## 0.6.2 — 2026-10-17

Patch release. Single sign-on keeps the app's hash route: opening an app page such as `/apps/hr/#/people` while signed out now returns to that page after login instead of the app's home page (the authorize page carries the fragment back to SDK apps; standard OIDC clients are unchanged). No app changes needed. No database changes.

## 0.6.1 — 2026-10-17

Patch release. Apps can sign people out of the platform: the console's new `/logout?redirect=/apps/<code>/` clears the platform login and shows the login page, and after signing in (any method) the person lands back in the app, so accounts can be switched (e.g. to test a staff role). SDKs gain `ws.logoutUrl(req)` / `ws.logout_url(headers)`. No database changes.

## 0.6.0 — 2026-10-15

Minor release: platform file storage backed by Qiniu Kodo. Admins configure it in 系统设置 → 文件存储 and run a step-by-step connection test; apps use `/api/open/storage/*` (upload tokens for direct uploads, signed download URLs, stat / list / delete, each app confined to its own folder) and the new `ws.storage` helpers in the JS and Python SDKs. Off by default. No database changes.

## 0.5.3 — 2026-10-15

Patch release. The directory API (`GET /api/open/users`) includes each person's `avatar`, so apps can sync head icons with the rest of the profile instead of waiting for each person to sign in (FDE 0.3.1 does). No database changes.

## 0.5.2 — 2026-10-15

Patch release. 管理 → 应用 gets a 版本 column: each hosted app's own version (new optional `version` in `yh-app.json`, falling back to the source `package.json` / `backend/package.json`), its source commit (Git-installed apps) and when it was last deployed. `yh` reports these as separate fields; `yh status` shows `v1.2.3 (sha)`. No database changes.

## 0.5.1 — 2026-10-15

Patch release. Admins whose platform isn't fully onboarded are taken to the setup wizard when they open the home page (once per login, never after 完成开通); the home page 开始配置 card is retired and dropped from saved layouts. The open LLM API accepts image input (OpenAI `image_url`, converted for Anthropic models) and adds `POST /api/open/llm/embeddings`; the JS / Python SDKs gain `embed()`. No database changes.

## 0.5.0 — 2026-10-15

Minor release: easier on-prem installs. A browser **setup wizard** (开通向导) takes admins through company info, theme, models (vendor presets + test), login methods (permission checklist, callback URLs, connection test for DingTalk / Feishu / WeCom), people (directory sync, or xlsx / CSV / paste import with departments, leaders and admins), notifications, apps (one-click official app install) and a downloadable onboarding report. `install.sh` asks step by step when run without arguments and gains an **intranet mode** (`--intranet`: no domain or tunnel, `http://<LAN IP>`). Machines with only Docker can install with the platform image (`docker run … ghcr.io/guoylyy/yihu-one:<version>`, same arguments as `install.sh`; the agent runs as the `yh-agent` container). Package-mode installs download a **prebuilt console image** from GHCR (built by GitHub Actions on every tag, amd64 + arm64) instead of building on site, with a local-build fallback. Fixed: consoles built with `CONSOLE_OMIT_OPTIONAL=1` crashed on startup. No database changes.

## 0.4.0 — 2026-10-15

Minor release: apps for the boss. A daily business brief pushed to DingTalk / Feishu / WeCom, a preset 老板助理 (executive assistant), and a 管理层 home page, all fed by three read-only standard tools apps can implement (`get_key_metrics`, `get_daily_summary`, `list_pending_decisions`; see `/dev/briefing`). Scheduled AI tasks for everyone (read-only, run as their owner). New app tools are usable right after a deploy. One new table.

## 0.3.0 — 2026-10-14

Minor release. Hosted apps can use a picture file from the repo as their icon (`"icon": "icon.png"` in `yh-app.json`, PNG/JPG/GIF/WebP/SVG up to 28 KB). Admins (管理 → 应用 → 设置) and app creators (创作中心 → 上架信息) can change a hosted app's icon in the console; a custom icon is kept on later deploys and can be reset to the manifest's. One database migration adds the columns.

## 0.2.0 — 2026-10-14

Minor release, no breaking changes. Two new open APIs for apps: `GET /api/open/app` (the app's space, platform URL and brand: space VI or the platform's name, logo and theme) and `POST /api/open/notify` (admin-installed apps send personal messages to platform users over DingTalk work notices, Feishu cards or WeCom app messages, picked per person). DingTalk settings gain an **AgentId** field, needed for work notices. FDE 0.2.0 needs this version.

## 0.1.2 — 2026-10-13

Patch release. New `GET /api/open/llm/models`: the chat models an app may use, in the OpenAI `/models` shape (`id` is the `model` value, the first one is the default), filtered by the user's roles when `X-User-Token` is sent. No keys or upstream URLs.

## 0.1.1 — 2026-10-13

Patch release. The built-in assistant no longer fails when apps expose more tools than the model accepts (large apps are routed through `find_app_tools` / `call_app_tool`); knowledge-base embedding fixes; tool-less agents; login permission guide in the doc center; WeCom domain-verification file served from the console. Packages are signed from this version on: after upgrading, a machine only accepts packages signed by Yihu.

## 0.1.0 — 2026-10-11

First public beta. See the release notes for details.
