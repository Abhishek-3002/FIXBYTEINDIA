# FIXBYTE Desktop Starter

This directory is reserved for the reusable Windows-first desktop application template.

## Planned stack
- Tauri 2
- React + TypeScript + Vite
- Rust for native commands only when needed
- SQLite for local-first data, with explicit migrations
- Shared API client for optional cloud services

## Initial acceptance checklist
- [ ] App opens in a native desktop window
- [ ] App name, icon, and version are configurable
- [ ] Navigation and settings screen work
- [ ] Local database initializes and migrations run
- [ ] App handles offline state clearly
- [ ] Unit tests and type-check pass
- [ ] Windows installer builds on CI
- [ ] Installer tested on a clean Windows 10/11 machine

No production credentials, signing keys, or customer data belong in this template.
