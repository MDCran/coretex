# Coretex desktop

Coretex has two intentionally separate Windows desktop modes:

- **Installed app** — an NSIS-installed production build. It checks the
  `MDCran/coretex` GitHub Releases feed, downloads a verified update, and offers
  **Restart and install** when the update is ready.
- **Live development app** — Electron + Vite HMR for renderer/shared UI edits and
  a watched Coretex Brain for backend edits. It uses the name **Coretex Dev**,
  port `8766`, `.coretex-dev`, and separate Electron user data, so it can run at
  the same time as the installed app on port `8765`.

## Run the live app

From the monorepo root:

```powershell
npm run desktop:live
```

Keep that command running. Renderer and shared UI changes are applied through
Vite HMR; changes under `coretex/src` restart the development Brain.

The live command also ensures Docker Desktop is running, starts the persistent
`lifeos-postgres` service, waits for it to become healthy, and applies pending
Prisma migrations before the Brain starts. Docker Desktop must be installed,
but it does not need to be opened manually.

## Build the Windows installer locally

```powershell
npm run desktop:installer
```

The assisted installer is written to `apps/desktop/release` as
`Coretex-Setup-<version>-x64.exe`. The same directory contains the `.blockmap`
and channel YAML consumed by `electron-updater`.

Local installers are unsigned unless Windows signing secrets are configured.
They work for personal installation, but Windows SmartScreen may show
**Unknown publisher**.

## Publish an update

`apps/desktop/package.json` is the desktop version source of truth. The
monorepo root package stays at `0.0.0`; only the desktop workspace version names
an app release. The root `package-lock.json` must record the same desktop
version.

Coretex exposes exactly three update streams:

- Stable: `0.2.0` → `latest.yml`
- Beta: `0.3.0-beta.1` → `beta.yml`
- Nightly: `0.3.0-nightly.20260818040506.42` → `nightly.yml`

Other prerelease identifiers are rejected so a build cannot silently publish
metadata that no installed client requests.

### Stable and beta

1. Set the version from the monorepo root, for example:

   ```powershell
   npm version 0.2.0 --workspace apps/desktop --no-git-tag-version
   ```

2. Move the release's entries from `[Unreleased]` into a dated, exact-version
   section in the root `CHANGELOG.md`, and start a fresh `[Unreleased]` section.
3. Run `npm run smoke:release` and review the generated installer locally if
   the change warrants it.
4. Commit the package version, root lockfile, and changelog together.
5. Create and push the exact `v<version>` tag.

The `release-windows.yml` workflow rejects a tag/package/lock/changelog mismatch,
builds on Windows, derives release notes from that exact changelog section, and
verifies the installer digest, size, signature, and matching channel metadata
before it creates a release. It also refuses a version older than any published
build visible to that stream. Beta builds are marked as GitHub prereleases.

### Nightly

A manual nightly run derives the next patch prerelease from the committed
desktop version and appends a UTC timestamp plus GitHub run number. For example,
a committed `0.2.0` produces `0.2.1-nightly.<timestamp>.<run>`, which is newer
than the installed stable build. Nightly notes come from `[Unreleased]` and
include the source commit. Manual runs are non-publishing builds by default;
only an explicit **Publish** choice may create a nightly prerelease. Published
nightlies always use the workflow-generated version; an explicit version is
accepted only for a dry validation build, preventing an older nightly from
replacing newer channel metadata.

The workflow always runs the network-free release acceptance suite first. A
manual stable or beta run can validate/build, but publishing those streams is
tag-only. The release artifact copy retained by Actions contains the installer,
blockmap, exact channel YAML, and generated notes.

Never put a GitHub token in the installed app. Installed clients must be able to
fetch the release assets without repository credentials; if source visibility
does not permit that, publish the updater artifacts from a separately accessible
release host. The workflow uses GitHub's short-lived `GITHUB_TOKEN` only while
publishing.

Publishing requires both repository signing secrets; local and dry-run builds
may omit both:

- `WINDOWS_CSC_LINK`
- `WINDOWS_CSC_KEY_PASSWORD`

They let electron-builder Authenticode-sign the app and installer.
