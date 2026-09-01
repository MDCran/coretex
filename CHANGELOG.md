# Changelog

All notable user-facing changes to Coretex are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and desktop
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Stable, beta, and nightly Windows release streams with channel-specific
  updater metadata.
- Deterministic release notes generated from this changelog and a mocked,
  network-free release acceptance suite.
- Automated dependency and full-history secret scanning for repository changes.

### Security

- Added per-launch authentication and exact-origin validation to the local
  WebSocket bridge.
- Hardened Electron renderer isolation, IPC access, navigation, embedded web
  content, permissions, and Content Security Policy defaults.
- Expanded repository privacy boundaries for credentials, browser profiles,
  personal documents, and local diagnostic state.

## [0.1.0] - 2026-09-01

### Added

- Coretex Windows desktop workspace with the local Brain service, agents,
  projects, tasks, terminal, database, Docker, email, calendar, health,
  workouts, nutrition, finance, and social workspaces.
- Native NSIS installer packaging and release-based update delivery.
- Configurable agent and social graph canvases with durable layouts.

### Changed

- Consistent Untitled UI patterns, responsive navigation, contextual action
  docks, and clearer empty states.
- Expanded local-first secrets, provider, model, and project configuration.

### Fixed

- Improved database recovery, terminal privacy, calendar editing,
  nutrition and workout tracking, and Docker action feedback.

[Unreleased]: https://github.com/MDCran/coretex/commits/main
