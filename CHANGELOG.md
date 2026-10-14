# Changelog

Yihu One follows [Semantic Versioning](https://semver.org/). `0.x` releases are **beta**. The version lives in [`VERSION`](VERSION); bump it with `./scripts/bump-version.sh <x.y.z>` (see [docs/版本管理.md](docs/版本管理.md)).

Release notes are kept in one place so the console can show them to users:
[`console/docs/devcenter/releases.md`](console/docs/devcenter/releases.md) (served at `/dev/releases` on every installation).
Integration-facing changes (APIs, SDK, manifest) are in [`console/docs/devcenter/changelog.md`](console/docs/devcenter/changelog.md).

## 0.2.0 — 2026-10-14

Minor release, no breaking changes. Two new open APIs for apps: `GET /api/open/app` (the app's space, platform URL and brand: space VI or the platform's name, logo and theme) and `POST /api/open/notify` (admin-installed apps send personal messages to platform users over DingTalk work notices, Feishu cards or WeCom app messages, picked per person). DingTalk settings gain an **AgentId** field, needed for work notices. FDE 0.2.0 needs this version.

## 0.1.2 — 2026-10-13

Patch release. New `GET /api/open/llm/models`: the chat models an app may use, in the OpenAI `/models` shape (`id` is the `model` value, the first one is the default), filtered by the user's roles when `X-User-Token` is sent. No keys or upstream URLs.

## 0.1.1 — 2026-10-13

Patch release. The built-in assistant no longer fails when apps expose more tools than the model accepts (large apps are routed through `find_app_tools` / `call_app_tool`); knowledge-base embedding fixes; tool-less agents; login permission guide in the doc center; WeCom domain-verification file served from the console. Packages are signed from this version on: after upgrading, a machine only accepts packages signed by Yihu.

## 0.1.0 — 2026-10-11

First public beta. See the release notes for details.
