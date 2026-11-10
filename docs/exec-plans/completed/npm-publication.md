# Prepare npm publication

## Objective and constraints

Prepare version 1.2.0 for manual public npm publication, preserving runtime behavior, Node requirements and TypeScript configuration. Do not commit, push, publish, tag or create releases. Never modify personal/global installations or configuration.

## Plan

1. Inspect official Pi package and CLI documentation, repository dependencies and npm name availability.
2. Adjust only publication metadata, package allowlist and host peer declarations; reconcile the lockfile.
3. Preserve functional README content while documenting npm/git installation and package lifecycle. Add a concise manual publishing guide.
4. Run npm ci, npm test, npm run typecheck and npm pack --dry-run. Inspect a real tarball and relative imports.
5. Exercise the tarball with the real Pi loader in a disposable environment, including command registration and available pi-subagents integration checks without providers. Record actual evidence and manual-only gaps.
6. Obtain independent review, correct actionable issues, and archive this plan with validation outcomes.

## Progress

- Repository inspected; clean working tree at start. Existing package is private, with explicit TypeScript entrypoint and Pi SDK peers. No Codegraph index.
- Official current package documentation inspected: explicit manifest paths are package-relative; pi-package enables gallery discovery; host packages should use wildcard peers and must not be bundled.
- Steps 1–6 completed, including independent review and corrections; publication and release remain owner-only future actions.

## Validation and decisions

Implemented 2026-11-10. `private` removed; `pi-package` keyword, repository/homepage/bugs/author and a `files` allowlist added; Pi SDK peers set to `"*"` (lockfile root entry updated; devDependencies still pinned to 1.5.0). README documents conditional npm availability, git fallback and lifecycle commands; `docs/publishing.md` contains the checklist, evidence and gaps; `docs/compatibility.md` peer wording reconciled. Official reference: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md. Compatibility support remains Pi 1.5.x regardless of broad host peer declarations recommended by Pi.

## Implementation Outcome

### Implemented

Prepared public npm metadata and registry configuration, package allowlist and host peers, reconciled the lockfile, and documented installation, compatibility and manual publication. No runtime, Node requirement or TypeScript configuration behavior changed.

### Deviations from Design

The real tarball was extracted and installed as a directory for the Pi smoke: Pi treats a `.tgz` path as a single extension file, not an npm package install. Registry installation remains a post-publication check.

### Validation

`npm ci` succeeded with zero vulnerabilities; 109 tests yielded 108 passes and one skip; typecheck, dry-run and real pack passed. The 21-file package contents were inspected and relative imports resolved. Isolated Pi 1.5.1 RPC registered `/hprofile` and ran `status`, including with pi-subagents 0.87.0 co-loaded. Historical tarball sizes in the publishing guide are not final artifact identifiers because documentation changed afterward. Initial review findings were corrected; final review was PASS WITH FINDINGS, and its sole finding about PowerShell native exit codes was corrected with per-command `LASTEXITCODE` checks.

### Follow-up

No commit, push, publication, tag or release was made, and no provider or global configuration was changed. The npm name returned 404 but is not reserved. After authorized publication, verify registry installation and the provider-backed and hotkey checks listed in the publishing guide. The existing local `v1.2.0` tag points elsewhere; the owner must reconcile its identity before a Git release, without automatically moving it.
