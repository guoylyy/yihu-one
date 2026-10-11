# Contributing to Yihu One

Thanks for helping. Issues and pull requests are welcome — in English or Chinese.

## Before you start

- Read [`docs/架构说明.md`](docs/架构说明.md) (architecture) and the conventions in [`CLAUDE.md`](CLAUDE.md).
- For anything bigger than a bug fix, open an issue first so we can agree on the approach.
- Integrating an app rather than changing the platform? See the [app integration spec](docs/应用接入规范.md) instead.

## The rules that matter most

1. **The console only does configuration.** A feature that only makes sense for one kind of business (approvals, attendance, purchasing…) belongs in an app, not in the console.
2. **Permissions live in the service layer** (`console/backend/src/services/`); routes stay thin. Business functions take `ctx = { user, via, ip }` first.
3. **Visibility is decided in one place** — `services/apps.js` `visibleTo`. Don't write another check.
4. **Write operations leave an audit trail** (`audit(ctx, 'domain.action', …)`), and AI/MCP write tools are marked `write: true, confirm: true`.
5. **New settings go in `services/settings.js` `SCHEMA`**, not new environment variables.
6. **The console never touches Docker.** Host-side actions go through the `PlatformOp` queue, executed by `yh agent`.
7. **Lite apps are untrusted code.** Don't loosen the sandbox or CSP in `LiteFrame.vue`.
8. **`yh` must run on macOS's stock bash 3.2** — no associative arrays, `${var,,}`, `mapfile` or `BASHPID`.

## Making a change

```bash
cd console/backend && npm test        # unit tests, no database needed
cd console/frontend && npm run build  # the frontend must build
./scripts/selftest.sh                 # end-to-end in Docker; required if you touch yh, platform APIs, SDKs or templates
```

- Changed `schema.prisma`? Create a migration with `npx prisma migrate dev --name <name>` and commit it.
- Changed an SDK in `console/frontend/public/sdk/`? Copy it to `templates/node/` and `templates/python/` (the self-test checks).
- Changed anything apps integrate with? Update the developer docs in `console/docs/devcenter/` and add a line to `changelog.md`. Don't rename those files — their names are public URLs.
- Changed `yh`'s upgrade code or `scripts/pack.sh`? Run `./scripts/upgrade-test.sh`. Tunnel config? `./scripts/tunnel-test.sh`.

## Pull requests

- Develop against `main`. The `release` branch is only updated by `./release.sh`.
- Keep PRs focused; describe what changed, why, and how you tested it.
- Match the surrounding code: naming, comment density (comments are in Chinese), and the `{ code: 0, data }` response shape (standard-protocol endpoints like OIDC are the exception).

## Security issues

Please don't open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
