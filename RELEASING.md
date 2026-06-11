# Releasing

This repository publishes the same Siglume Direct Request Payment SDK surface to:

- npm: `@siglume/direct-request-payment`
- PyPI: `siglume-direct-request-payment`

## Verify

```powershell
npm run typecheck
npm test
D:\Users\taihei2\AppData\Local\Programs\Python\Python311\python.exe -m pytest python_tests
D:\Users\taihei2\AppData\Local\Programs\Python\Python311\python.exe -m build
D:\Users\taihei2\AppData\Local\Programs\Python\Python311\python.exe -m twine check dist\*.whl dist\*.tar.gz
npm publish --dry-run --access public
```

`npm publish --dry-run` rebuilds the TypeScript `dist` directory. If you run it
before publishing to PyPI, run `python -m build` again or upload only the wheel
and sdist patterns shown below.

## Publish to npm

```powershell
npm publish --access public --otp=<npm-otp>
```

Confirm:

```powershell
npm view @siglume/direct-request-payment version repository --json
```

## Publish to PyPI

Use a PyPI API token or configure PyPI Trusted Publishing for:

- Owner: `taihei-05`
- Repository: `siglume-direct-request-payment`
- Workflow: release-pypi.yml
- Environment: `pypi`
- Project: `siglume-direct-request-payment`

Manual token upload:

```powershell
D:\Users\taihei2\AppData\Local\Programs\Python\Python311\python.exe -m build
D:\Users\taihei2\AppData\Local\Programs\Python\Python311\python.exe -m twine upload dist\*.whl dist\*.tar.gz
```

Confirm:

```powershell
D:\Users\taihei2\AppData\Local\Programs\Python\Python311\python.exe -m pip index versions siglume-direct-request-payment
```
