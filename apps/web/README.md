# Coretex web

The Coretex web workspace is the browser client for the local Coretex Brain.
It shares the application UI with the Electron desktop app while keeping web
runtime and build concerns isolated.

From the repository root:

```powershell
npm ci
npm run dev:webbrain
```

The Brain starts on its configured local bridge port and Next.js serves the web
client. See the root [README](../../README.md) for architecture, security, and
release guidance.
