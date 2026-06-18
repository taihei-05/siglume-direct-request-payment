# Releasing

This repository publishes the same Siglume Direct Request Payment SDK surface to:

- npm: `@siglume/direct-request-payment`
- PyPI: `siglume-direct-request-payment`

Releases are automated through GitHub Actions. Do not publish from a developer
machine during the normal release flow; local `npm publish` requires OTP and
local PyPI upload depends on workstation credentials/network state.

## One-Time Registry Setup

npm Trusted Publishing must be configured for:

- Package: `@siglume/direct-request-payment`
- Owner: `taihei-05`
- Repository: `siglume-direct-request-payment`
- Workflow: `release-npm.yml`
- Environment: `npm`

PyPI Trusted Publishing must be configured for:

- Project: `siglume-direct-request-payment`
- Owner: `taihei-05`
- Repository: `siglume-direct-request-payment`
- Workflow: `release-pypi.yml`
- Environment: `pypi`

After these registry-side settings exist, no npm OTP, PyPI token, or local
publish command is needed for normal releases.

## Verify Locally

```powershell
npm run typecheck
npm test
py -3.11 -m pytest python_tests
npm publish --dry-run --access public
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
py -3.11 -m build
py -3.11 -m twine check dist\*.whl dist\*.tar.gz
```

`npm publish --dry-run` rebuilds the TypeScript `dist` directory. Rebuild Python
artifacts after npm dry-run before running `twine check`.

## Release

Update both versions to the same value:

- `package.json`
- `package-lock.json`
- `pyproject.toml`
- runtime user-agent strings, when they include the package version
- `CHANGELOG.md`

Then commit and push a matching tag:

```powershell
git commit -am "Release direct request payment SDK <version>"
git tag v<version>
git push origin main
git push origin v<version>
```

The `v*` tag triggers:

- `.github/workflows/release-npm.yml`
- `.github/workflows/release-pypi.yml`

Both workflows are idempotent for already-published versions. npm checks the
exact package version before publishing; PyPI uses `skip-existing`.

## Confirm

```powershell
npm view @siglume/direct-request-payment version repository --json
py -3.11 -m pip index versions siglume-direct-request-payment
```

Both registries should show the tag version as latest.
