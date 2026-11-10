# Publishing to npm (manual)

Publishing is a manual, owner-only step. Nothing in this repository publishes, tags or releases automatically. Version **1.2.0** was published by the owner and verified in the public npm registry on 2026-11-10. Do not attempt to publish that version again; use the future-version procedure below.

Reference: [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) and [Pi CLI package commands](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md#package-commands).

## Package contract

- `pi.extensions` is `./pi-profile-cycler.ts`, relative to the package root. The extension is TypeScript loaded by Pi; there is no build step.
- Keyword `pi-package` makes the package eligible for the Pi gallery.
- `@earendil-works/pi-ai`, `pi-coding-agent` and `pi-tui` are `peerDependencies` with `"*"`, because Pi supplies them and they must not be bundled or listed in `dependencies`. The `"*"` range is **not** a support claim: only Pi 1.5.x is verified ([compatibility](compatibility.md)). The same packages (and `pi-agent-core`) stay pinned to 1.5.0 in `devDependencies` for tests and typechecking.
- `files` allows only `pi-profile-cycler.ts`, `src`, `examples`, `images`, `docs/*.md`, `README.md` (and `LICENSE`, `package.json` automatically). Tests, fixtures, `docs/exec-plans` and local `profile-cycler.json` are excluded.
- `engines.node` is `>=24`.

## Release checklist

1. Clean working tree on the release commit; version in `package.json` and `package-lock.json` match.
2. `npm view pi-profile-cycler` should return 404 for a first publish (it did on 2026-11-10).
3. `npm ci`, `npm test`, then `npm run typecheck`; stop if any command fails.
4. `npm pack --dry-run`; confirm only the allowlisted files appear (21 files for 1.2.0 including this guide; documentation changes affect byte sizes).
5. `npm login` (account with 2FA), then `npm whoami` to confirm the publisher. Run **`npm publish --access public`** manually. `publishConfig` targets the public npm registry.
6. Verify the registry before any tag or release:

   ```powershell
   npm view pi-profile-cycler@1.2.0 version dist.integrity dist.tarball pi --json --registry=https://registry.npmjs.org/
   ```

7. Test the published version in a disposable agent directory and project (PowerShell; no personal settings or credentials are copied):

   ```powershell
   $sandbox = Join-Path ([IO.Path]::GetTempPath()) ("pi-release-" + [guid]::NewGuid())
   $previousAgentDir = $env:PI_CODING_AGENT_DIR
   New-Item -ItemType Directory -Path $sandbox | Out-Null
   Push-Location $sandbox
   try {
     $env:PI_CODING_AGENT_DIR = Join-Path $sandbox "agent"
     pi install npm:pi-subagents@0.87.0
     if ($LASTEXITCODE -ne 0) { throw "pi-subagents installation failed" }
     pi install npm:pi-profile-cycler@1.2.0
     if ($LASTEXITCODE -ne 0) { throw "Profile cycler installation failed" }
     pi list
     if ($LASTEXITCODE -ne 0) { throw "Package listing failed" }
     pi
     if ($LASTEXITCODE -ne 0) { throw "Pi smoke session failed" }
     # In Pi: /hprofile, /hprofile status, then exit.
     # Provider-backed routing requires separate, explicitly configured credentials.
     pi update npm:pi-profile-cycler@1.2.0
     if ($LASTEXITCODE -ne 0) { throw "Package reconciliation failed" }
     pi remove npm:pi-profile-cycler@1.2.0
     if ($LASTEXITCODE -ne 0) { throw "Package removal failed" }
   } finally {
     $env:PI_CODING_AGENT_DIR = $previousAgentDir
     Pop-Location
     Remove-Item -LiteralPath $sandbox -Recurse -Force
   }
   ```

   Check each command's exit status and stop on failures. A pinned update reconciles the same version; use an unpinned source to receive later versions.

8. Only after publication and verification, with owner authorization, associate a tag and GitHub Release with the release commit. **A local `v1.2.0` already exists and points to a different commit from the preparation HEAD.** Inspect `git show v1.2.0` and `git ls-remote --tags origin refs/tags/v1.2.0` before proceeding. Do not force-move or recreate the tag automatically. Resolve its intended identity with the owner; if necessary choose a new package version and repeat validation. When the intended tag is absent, the normal commands are `git tag -a v1.2.0 <release-commit> -m "Release 1.2.0"`, `git push origin v1.2.0`, then create the GitHub Release from that tag with validation notes. These are future authorized actions, not part of package preparation.

## Future versions

Update the version in both manifest and lockfile (for example `npm version patch --no-git-tag-version`), document changes, and repeat all preflight and isolated package checks. The name should already exist: check ownership with `npm owner ls pi-profile-cycler` and confirm `npm view pi-profile-cycler@<next-version> version --registry=https://registry.npmjs.org/` returns an absent-version error. Never overwrite a published version; use a new version. Publish, verify that exact version, then tag and release its matching commit with authorization. Recheck official Pi packaging guidance and supported Pi/pi-subagents versions before expanding compatibility claims.

Update semantics (verified with Pi 1.5.1 `--help` and the current CLI docs): `pi update` alone updates Pi itself; `pi update --extensions` updates all packages; `pi update <source>` or `--extension <source>` updates one. Version-pinned npm sources and git tags/commits are not moved. `pi uninstall` is an alias of `pi remove`; `-l` targets project settings.

## Evidence recorded on 2026-11-10 (pre-publication)

Environment: Windows 11, Node 24.18.0, npm 11.16.0. The installed global Pi CLI reports **1.5.1**; the repository's dev SDK is 1.5.0. Both are on the supported 1.5.x line, but the CLI smoke ran on 1.5.1, not 1.5.0.

| Check | Result |
|---|---|
| `npm view pi-profile-cycler` | 404 Not Found: the name is free (read-only check; not a reservation, and a race remains until publish) |
| `npm ci` | succeeded, 0 vulnerabilities |
| `npm test` | 109 tests: 108 pass, 0 fail, 1 skipped |
| `npm run typecheck` | clean |
| `npm pack --dry-run` and a real `npm pack` into a temp directory | 20 files, 426.4 kB packed (before this guide was added; a later dry-run: 21 files, 428.8 kB / 531.3 kB unpacked). These sizes are historical evidence, not final artifact identifiers: subsequent documentation edits change them. Every entry inspected: only allowlisted paths. No tests, `node_modules`, exec plans or credentials |
| Relative imports in the extracted tarball | every `./` import in `pi-profile-cycler.ts` and `src/*.ts` resolves inside the package |
| Real Pi 1.5.1 loader, isolated `PI_CODING_AGENT_DIR` and project in temp, telemetry off | the extracted tarball installed with `pi install <dir>`, `pi list` showed it, and RPC `get_commands` listed `/hprofile` from the package path |
| `/hprofile status` via RPC | ran and answered ("no profiles yet", `profile: none`) |
| Same with `npm:pi-subagents@0.87.0` installed in the isolated dir | `/hprofile status` ran, and the "builtin agents not found" warning disappeared; the `subagent-async` widget and pi-subagents commands loaded alongside |
| `pi install <file>.tgz` | Pi treats a `.tgz` path as a single local extension file, so it is **not** a way to test an npm install. The tarball was extracted and the directory installed instead |

## Gaps (not verified)

- Version 1.2.0 is now present in the public registry, but a clean registry installation (including Pi's peer-install suppression) has not yet been tested here. Run the isolated post-publication check above.
- The smoke used a local-directory install, not a registry install.
- No provider credentials were available, so no model was active: profile activation, Alt+M, routing of a real `subagent` launch and `model_verification_failed` behaviour were not exercised. No paid calls were made. See [manual testing](manual-testing.md).
- Windows hotkeys, concurrent windows and Pi 1.5.0 as the CLI (rather than the SDK) remain unverified.
