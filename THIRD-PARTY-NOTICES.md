# Third-Party Notices

Coretex is built with the open-source and third-party software listed below. Each is
the property of its respective authors and is used under its own license. This file
satisfies the attribution requirements of those licenses for distributions of Coretex.

Company names, product names, and logos displayed within Coretex (e.g. OpenAI, Anthropic,
Google, Stripe, GitHub, Supabase, Docker, and others) are trademarks of their respective
owners and are used solely for identification. Their appearance does not imply any
affiliation with or endorsement by those companies.

## Untitled UI React and official starter kits

Coretex includes source code copied from and modified from Untitled UI React
and the official Untitled UI Next.js and Vite starter kits:

- https://github.com/untitleduico/react
- https://github.com/untitleduico/untitledui-nextjs-starter-kit
- https://github.com/untitleduico/untitledui-vite-starter-kit

The synchronized component baseline was upstream commit
`c42bc4e33eba53dd58549bb6ba6045fe50338921`.

The open-source components and starter-kit files are licensed under the MIT
License. This notice applies only to files included in those public
open-source repositories. Untitled UI React PRO files are governed by a
separate license and are not redistributed by this repository.

MIT License

Copyright (c) 2025 Untitled UI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Untitled UI icon packages

- **@untitledui/icons** is used as an application icon dependency under its
  shipped license. That license permits use in personal and commercial projects
  and prohibits selling, sublicensing, or distributing the icons in original or
  modified form, creating derivative icon libraries, or using them in a UI kit,
  library, or template intended for resale. Coretex does not redistribute the
  package as a standalone icon library. See
  https://github.com/untitleduico/icons/blob/main/LICENSE and
  https://www.untitledui.com/license.
- **@untitledui/file-icons** is used as a compiled application dependency. Its
  published package metadata identifies the package as MIT-licensed; Coretex
  does not redistribute it as a standalone icon library.

## Runtime libraries

| Project | License | Use in Coretex |
| --- | --- | --- |
| React / React DOM | MIT | UI runtime |
| xterm.js (`@xterm/xterm`) | MIT | In-app terminals |
| Recharts | MIT | Usage & analytics charts |
| dockerode | Apache-2.0 | Docker engine integration |
| ssh2 | MIT | Remote (SFTP/SSH) |
| basic-ftp | MIT | Remote (FTP) |
| Monaco Editor | MIT | Code / document editing |
| Tailwind CSS | MIT | Styling |
| React Aria Components | Apache-2.0 | Accessible component primitives |

## Brand logos

- **LogoKit** — optional third-party brand-logo delivery. Self-hosters provide their
  own publishable (`pk_`) key; Coretex does not bundle a maintainer token. Logos are
  trademarks of their respective owners and are displayed for identification only,
  under LogoKit's terms of service.

## Notes

- The license texts for the MIT/Apache-2.0 dependencies above are included with their
  respective packages under `node_modules/<package>/LICENSE`.
- This list covers the primary third-party components surfaced in the product UI; the
  complete dependency tree and its licenses are available via `npm ls` / each package's
  metadata.

© 2026 Coretex. Coretex application code is the property of its authors.
