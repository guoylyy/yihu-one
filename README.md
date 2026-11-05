<div align="center">

# Yihu One

**The self-hosted platform that makes it easy for a company to build and deploy AI agents and apps — and to bring the systems it already has into one place.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.6.10%20beta-orange.svg)](CHANGELOG.md)
![Platform](https://img.shields.io/badge/runs%20on-macOS%20%7C%20Linux-lightgrey.svg)

English · [简体中文](README.zh-CN.md)

</div>

---

## Contents

- [Why this exists](#why-this-exists)
- [What you get](#what-you-get)
- [Official apps](#official-apps)
- [What's inside](#whats-inside)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Building an app](#building-an-app)
- [CLI](#cli)
- [Documentation](#documentation)
- [License](#license)

## Why this exists

Every internal tool needs the same groundwork before it does anything useful: logins, user and department data, a server, a deploy pipeline, backups — and now a model and a way for AI to use the tool. Every system you already bought or built has its own login and lives on its own island.

Yihu One (以虎 One) does that groundwork once, on a single machine (a Mac mini or a Linux server). The platform itself has no business features: approvals, CRM, attendance… each one is an app. The console only configures users, sign-in, models and apps.

> **Status:** 0.6.10 beta ([semantic versioning](CHANGELOG.md) — 0.x is beta), in production use. The UI and most docs are in Simplified Chinese.

## What you get

### 🤖 Build and ship AI agents

- **No-code agents** — build an assistant from a prompt, tools and a model; share it with colleagues or publish it company-wide
- **Agents that act** — apps expose their features as MCP tools; agents call them as the current user, with that user's permissions, and confirm before writing
- **One MCP endpoint** — Claude, Cursor or your own agent connect to `/api/mcp` with a personal API key and get every tool the user may use
- **Managed models** — configure OpenAI-compatible or Anthropic providers once; agents and apps share them, with per-role access and quotas
- **Knowledge base** — upload company documents; agents answer with cited sources
- **A home page per person** — rearrange cards yourself or ask your agent to; data cards call apps' read-only MCP tools as the viewer
- **Asset center** — versioned templates, brand VI and design components; agents fetch the brand spec over MCP and follow it
- **Skill center** — share Agent Skills (folders with a `SKILL.md`); agents upload, install and update them over MCP

### 🚀 Build and deploy apps

- **Publish from your own agent** — tell Claude Code or Codex "publish this to Yihu One"; same review rules as the web UI
- **Two commands to go live** — `yh new` scaffolds a Node or Python app with login, health check and MCP; `yh up` deploys it
- **Push to deploy** — push to `release`; the platform builds, health-checks and ships it, or rolls back and notifies the team
- **No servers per app** — one container, database and isolated network per app, behind one domain and HTTPS
- **No code at all** — describe a small tool (sign-up sheet, booking, dashboard) in chat and get a sandboxed lite app

### 🔌 Integrate the systems you already have

- **No-code SSO for off-the-shelf tools** — the platform is an OpenID Connect provider; GitLab, Grafana, Jenkins, Metabase and anything with "Generic OIDC" connect through a form
- **Register any existing system** — it stays where it runs and gets SSO, the platform's user and department data, a place in the AI assistant (once it serves MCP) and the managed models
- **Ready-made apps** — 8 general-purpose official apps, one command each; see [Official apps](#official-apps)
- **One workspace** — every app, built here or elsewhere, in one marketplace with one permission model and one audit log
- **Your company's look** — colours, fonts, corner radius, shadows and logo are a theme; each space (company or customer) can have its own

## Official apps

What the platform does day to day depends on the apps you install. There are 11 official apps: 8 general-purpose ones anyone can install, and 3 built for a customer.

Each general-purpose app is a public Git repository. One command installs it; sign-in, its database and its AI tools are wired up automatically.

| App | What it does | Version | Install |
| --- | --- | --- | --- |
| [Inbox](https://github.com/guoylyy/yihu-inbox) | Capture to-dos in a sentence, assign them to colleagues, tidy up in bulk, import tasks from other systems, review weekly patterns | 0.2.2 | `yh add inbox --git https://github.com/guoylyy/yihu-inbox.git && yh up inbox` |
| [Meetings & Minutes](https://github.com/guoylyy/yihu-meeting) | Record meetings or import minutes; AI extracts the meeting details, decisions, action items and risks, grouped by project | 0.2.2 | `yh add meeting --git https://github.com/guoylyy/yihu-meeting.git && yh up meeting` |
| [Expiry Ledger](https://github.com/guoylyy/yihu-expiry) | One ledger for contract and licence expiry dates: upload a file and AI fills in the entry, see days left at a glance, get reminded before expiry | 0.2.4 | `yh add expiry --git https://github.com/guoylyy/yihu-expiry.git && yh up expiry` |
| [FDE Delivery](https://github.com/guoylyy/yihu-fde) | Projects, milestones, tasks, timesheets and a knowledge base; engineers and AI agents delivering together | 0.3.1 | `yh add fde --git https://github.com/guoylyy/yihu-fde.git && yh up fde` |
| [HR & Attendance](https://github.com/guoylyy/yihu-hr) | Clock-in, leave and business-trip summaries from DingTalk / Feishu / WeCom, annual-leave balances, contracts, staff costs, 1:1s, people profiles | 0.3.6 | `yh add hr --git https://github.com/guoylyy/yihu-hr.git && yh up hr` |
| [Group Finance](https://github.com/guoylyy/yihu-finance) | Accounts and transactions across companies, receipts and payments, payroll and expenses, invoices and loans, month-end close, cash forecasts | 1.4.0 | `yh add finance --git https://github.com/guoylyy/yihu-finance.git && yh up finance` |
| [Personal Finance](https://github.com/guoylyy/yihu-personal-account) | A private ledger: net worth, income and spending, budgets, investment holdings, money lent and borrowed, AI bookkeeping | 1.5.2 | `yh add personal-account --git https://github.com/guoylyy/yihu-personal-account.git && yh up personal-account` |
| [Knowledge Base](https://github.com/guoylyy/yihu-knowledge) | Mobile-first personal knowledge base: Markdown notes, controlled sharing with access audit, backlink graph, AI summaries | 1.5.4 | `yh add knowledge --git https://github.com/guoylyy/yihu-knowledge.git && yh up knowledge` |

The first four can also be installed with one click in the console's setup wizard.

**Customer-built apps.** The other three — a trade CRM, a product catalogue and a trade-training app — were built for one customer and aren't published. They're not installable; they show what a company-specific app on the platform looks like.

What each app stores, how many AI tools it has and when to use it: [app catalogue](docs/应用清单.md) (Chinese).

## What's inside

**Console** (built in, configuration only)
- Users and departments, with optional DingTalk or Feishu directory sync
- Sign-in methods: password, DingTalk, Feishu (Lark), WeCom — any combination at once
- Models and AI: OpenAI-compatible providers (Qwen, DeepSeek, Kimi, GLM…), Anthropic, OpenHex; per-role access and daily quotas
- A browser setup wizard on first run, system settings, audit log

**App marketplace** — five kinds of apps, all versioned and reviewable

| Kind | What it is | Runs where | Who can publish |
| --- | --- | --- | --- |
| AI assistant | Prompt + chosen tools + model | Console's assistant runtime | Anyone |
| Lite app | A single HTML page, generated by chatting with AI | Sandboxed iframe (no network, no credentials) | Anyone |
| External app | An existing system elsewhere | Its own server; still gets SSO and MCP | Anyone (sharing needs review) |
| Hosted app | A Git repository | A container on the platform | Admins and developers |
| Skill | A folder with `SKILL.md` that teaches an agent how to do something | Each user's own agent | Anyone |

Apps can be kept private, shared with colleagues, or listed company-wide after admin review. Apps published by employees ask users for consent before they get user data.

**Operations** (the `yh` CLI)
- One command install, auto-start on boot, nightly backups, `yh doctor` self-check
- Per-app isolated Docker network and database
- Release notifications to Feishu / DingTalk / WeCom group bots
- Platform self-upgrade, including offline upgrade packages

## Quick start

**Requirements:** macOS or Linux; Docker with the compose plugin (on macOS, [Colima](https://github.com/abiosoft/colima) works) with at least 4 GB of memory (8 GB recommended); `git`, `jq`, `curl`, `openssl`, `rsync`. Bash 3.2+ — the stock macOS shell is fine.

### Try it locally (5 minutes)

```bash
git clone https://github.com/guoylyy/yihu-one.git
cd yihu-one
./install.sh --test --demo        # add --cn on networks in mainland China
```

Only have Docker (Docker Desktop on Windows / macOS, a NAS)? The platform image takes the same options:

```bash
docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock -v /opt/yihu-one:/opt/yihu-one \
  ghcr.io/guoylyy/yihu-one --test --demo
```

Open http://localhost:18080. Test mode creates an `admin` account and prints its password, and the login page has a "dev login" that lets you pick any user. `--demo` also installs two demo apps (Node and Python). Add `--lan` to serve on your LAN IP. Run `./yh destroy` when you're done.

Want to see real apps instead of the demos? Install any of the [official apps](#official-apps) with the command in its row.

### Deploy for a company

The platform machine stays on the company's internal network; a small cloud server only terminates HTTPS and forwards traffic through a tunnel (no public IP needed):

```bash
# On the platform machine
./install.sh --company acme --url https://one.example.com --apps-url https://apps.one.example.com \
             --frp-server <cloud server IP> --demo
# On the cloud server (install.sh prints this exact command, token filled in)
sudo DOMAIN=one.example.com APPS_DOMAIN=apps.one.example.com FRP_TOKEN=<token> INSTALL_DEPS=1 ./cloud/install.sh
```

The installer checks the machine and network, generates every secret, builds and starts the platform, installs boot-time services and nightly backups, runs a self-check, and writes a **handover sheet** (acceptance checklist). Then open the URL and create the admin in the setup wizard. Company installs use **upgrade packages**: each company decides when to upgrade (one click in the console, automatic rollback on failure). Pushing code never auto-updates them.

Preparation checklist, sizing, China mirrors, sign-in setup, acceptance, handover and upgrades: **[deployment guide](docs/部署手册.md)** (Chinese).

### After install: a 15-minute tour

With `--demo` installed, walk through it in this order:

1. **Workspace** — rearrange your home page with "编辑首页", or ask the AI assistant to do it
2. **Marketplace** — add a demo app to your workspace and open it: no second login, the app already knows who you are (SSO)
3. **AI assistant** — ask "which apps can I use?", then have it call the demo app's tools; writes ask for confirmation first
4. **Studio** — build an AI assistant from a prompt, or generate a lite app from one sentence ("a team-outing sign-up sheet")
5. **Your own agent** — create an API key under 个人中心 and connect Claude Code or Cursor; every platform tool is available over MCP
6. **Assets and VI** — upload your brand guidelines for agents to use; switch the console to your company's look under 系统设置 → 外观与主题

## How it works

```
                 https://<your-domain>/
                          │
               ┌──────────▼──────────┐
               │      yh-caddy       │  /apps/<code>/*  → yh-<code>   (prefix stripped)
               └───┬─────────────┬───┘  everything else → yh-console
                   │             │
        ┌──────────▼───┐   ┌─────▼──────┐
        │  yh-console  │   │  yh-<app>  │ …one container per app,
        │ Node/Express │   │            │   each on its own network
        │   + Vue 3    │   └────────────┘
        └───┬──────▲───┘
            │      │ /api/platform (token)
   MySQL ◀──┘      │
   Redis       ┌───┴──────┐
               │ yh agent │  runs on the host, owns Docker
               └──────────┘
```

- **The console never touches Docker.** When an admin clicks *install / deploy / stop / logs*, the console queues an operation; the `yh agent` running on the host picks it up, runs the matching `yh` command and reports the logs back.
- **Startup secrets live in `yh.env`**; everything else is a setting in the console that takes effect immediately.
- **Auto-deploy:** the agent watches each app's `release` branch. New commit → backup → build → health check → live, or roll back and notify.

More detail: [architecture](docs/架构说明.md) · [release flow](docs/发布方式.md) · [deployment guide](docs/部署手册.md).

## Building an app

A hosted app is any repository with a `Dockerfile` and a `yh-app.json`:

```json
{
  "code": "purchase",
  "name": "Purchasing",
  "port": 3000,
  "health": "/health",
  "callback": "/sso/callback",
  "mcp": "/mcp",
  "database": true,
  "deploy": { "branch": "release", "mode": "auto" }
}
```

The platform injects its config (`YH_CLIENT_ID`, `YH_CLIENT_SECRET`, `DATABASE_URL`, `YH_BASE_PATH`, …) as environment variables. The zero-dependency SDKs handle login in one line:

```js
import express from 'express'
import { Workspace } from './yh-one.mjs'

const app = express()
const ws = new Workspace()
app.use(ws.middleware())            // handles /sso/callback, requires login elsewhere

app.get('/', (req, res) => {
  ws.track(req.yhUser, 'home.view') // usage analytics
  res.send(`Hello, ${req.yhUser.name}`)
})
```

| Level | You get | You do |
| --- | --- | --- |
| L1 Deploy | Runs on the platform, shows up in the workspace | Add `yh-app.json` + `Dockerfile` |
| L2 SSO | Users arrive logged in | One line with the SDK |
| L3 Usage | Know who uses what | Call `track()` at key actions |
| L4 AI | Users can drive your app from the assistant | Serve an MCP endpoint |
| L5 Models | Your app's AI uses the platform's models | Change your OpenAI SDK's `baseURL` |

Apps created with `yh new` already do L1–L2. SDKs: [`yh-one.mjs`](console/frontend/public/sdk/yh-one.mjs) (Node 18+) and [`yh_one.py`](console/frontend/public/sdk/yh_one.py) (Python 3.10+, standard library only). A running platform serves the full developer docs at `/dev` (source: [`console/docs/devcenter/`](console/docs/devcenter/)).

## Integrating an existing system

You don't have to move a system onto the platform to bring it in:

1. An admin registers it under **Admin → Apps → Register external app** with its URL, SSO callback and (optionally) MCP endpoint, and gets a client ID, a secret and the OIDC discovery URL.
2. Connect its login:
   - **Off-the-shelf systems** with a "Generic OIDC / OAuth2" setting: paste the discovery URL, client ID and secret — no code. Example for Grafana and the full claim list: [OIDC guide](console/docs/devcenter/oidc.md).
   - **Your own systems:** any OIDC client library works, or use the SDK if it's Node or Python. See the [SSO guide](console/docs/devcenter/sso.md).
3. Optionally it reads users and departments from the [open API](console/docs/devcenter/users.md), reports usage, and serves an [MCP endpoint](console/docs/devcenter/mcp.md) so agents can work with it.

It then appears in the workspace and the marketplace like any other app, with the same visibility rules.

## CLI

| Command | What it does |
| --- | --- |
| `yh init --url <url>` / `--test` | First install: generate config and secrets, start everything |
| `yh start` | Start the platform, console and all apps |
| `yh new <code> --from node\|python` | Create an app from a template |
| `yh add <code> --git <repo>` / `--path <dir>` | Bring in an existing app |
| `yh up <code>` | Go live: database → register → build → route → health check |
| `yh update <code>` | Pull and redeploy, rolling back on failure |
| `yh down` / `restart` / `remove <code>` | Stop, restart, or remove (backs up first) |
| `yh status` / `logs <code>` / `doctor` | Status, logs, full self-check |
| `yh backup` / `restore <code> <file>` | Back up all databases; restore one |
| `yh upgrade` | Upgrade the platform itself |
| `yh agent` / `autostart` | Run the host agent; install boot-time services (launchd / systemd) |

Run `./yh help` for the full list.

## Repository layout

| Path | Contents |
| --- | --- |
| [`yh`](yh) | The CLI (bash, macOS bash 3.2 compatible) |
| [`console/backend/`](console/backend/) | Console API — Node 20, Express, Prisma, MySQL 8 |
| [`console/frontend/`](console/frontend/) | Console UI — Vue 3, Vite, Element Plus |
| [`console/docs/devcenter/`](console/docs/devcenter/) | Developer docs, bundled into the UI at `/dev` |
| [`platform/`](platform/) | Docker Compose for Caddy, MySQL, Redis, frpc |
| [`templates/`](templates/) | App templates (Node, Python) with SSO, health check and MCP wired up |
| [`cloud/`](cloud/) | Optional cloud-side tunnel and HTTPS entry |
| [`scripts/`](scripts/) | Self-tests, packaging |
| [`docs/`](docs/) | Architecture, deployment and release docs |

## Development

```bash
# Console backend (needs a MySQL 8 you can write to)
cd console/backend && cp .env.example .env    # set DATABASE_URL
npx prisma migrate deploy && npm run dev      # :3105

# Console frontend
cd console/frontend && npm i && npm run dev   # :5185, proxies /api to :3105
```

Tests:

```bash
cd console/backend && npm test   # unit tests, no database needed
./scripts/selftest.sh            # full end-to-end run in Docker (install → apps → deploy → rollback → backup)
./scripts/upgrade-test.sh        # platform upgrade, no Docker needed
./scripts/tunnel-test.sh         # tunnel config, no Docker needed
```

`selftest.sh` works in a temp directory and uses port 18080 and `yh-*` container names. It refuses to run on a machine that already has a platform installed.

## Documentation

Docs live in [`docs/`](docs/) and are in Chinese.

| Doc | What's in it |
| --- | --- |
| [Deployment guide](docs/部署手册.md) | Preparation checklist, install, sign-in setup, acceptance, handover, upgrades, troubleshooting |
| [Architecture](docs/架构说明.md) | Platform vs. app boundary, marketplace, console ↔ host, data model |
| [App integration spec](docs/应用接入规范.md) | Every rule an app must follow, with links to the details |
| [Versioning](docs/版本管理.md) | Version rules, where the version shows up, how to bump it and cut a release |
| [App catalogue](docs/应用清单.md) | The official apps in detail |
| [Release flow](docs/发布方式.md) | Tunnel-forwarding deployment and how auto-deploy works |
| [Open-source scope and license](docs/开源边界与协议说明.md) | What's open source and what stays private |

Developer docs for app builders are in [`console/docs/devcenter/`](console/docs/devcenter/); a running platform serves them at `/dev`.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The most important rule: **the console only does configuration**; a feature that only makes sense for one kind of business belongs in an app.

Building an app on the platform? The [app integration spec](docs/应用接入规范.md) lists every rule an app must follow, with links to the details.

## Security

Please don't report vulnerabilities in public issues — see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE) · Copyright 2026 Yihu Technology (see [NOTICE](NOTICE))
