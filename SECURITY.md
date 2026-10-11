# Security Policy

## Reporting a vulnerability

Please **don't** report security issues in public GitHub issues or pull requests.

Use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**). Include what you found, how to reproduce it, and what an attacker could do with it. We'll acknowledge the report, keep you updated while we fix it, and credit you if you'd like.

## Scope

In scope: the console (backend and frontend), the `yh` CLI, the SDKs and app templates in this repository — for example authentication and SSO/OIDC, visibility and permission checks, the lite-app sandbox, the MCP gateway, Skill uploads, and anything that lets an app or user reach data they shouldn't.

Out of scope: apps built on the platform by third parties, and issues that require an already-compromised host or admin account.

## Supported versions

Security fixes go into the latest release. Upgrade with `yh upgrade` (or from the console's overview page).
