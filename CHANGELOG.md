# Changelog

Yihu One follows [Semantic Versioning](https://semver.org/). `0.x` releases are **beta**. The version lives in [`VERSION`](VERSION); bump it with `./scripts/bump-version.sh <x.y.z>` (see [docs/版本管理.md](docs/版本管理.md)).

Release notes are kept in one place so the console can show them to users:
[`console/docs/devcenter/releases.md`](console/docs/devcenter/releases.md) (served at `/dev/releases` on every installation).
Integration-facing changes (APIs, SDK, manifest) are in [`console/docs/devcenter/changelog.md`](console/docs/devcenter/changelog.md).

## 0.1.1 — 2026-10-13

Patch release. The built-in assistant no longer fails when apps expose more tools than the model accepts (large apps are routed through `find_app_tools` / `call_app_tool`); knowledge-base embedding fixes; tool-less agents; login permission guide in the doc center; WeCom domain-verification file served from the console. Packages are signed from this version on: after upgrading, a machine only accepts packages signed by Yihu.

## 0.1.0 — 2026-10-11

First public beta. See the release notes for details.
