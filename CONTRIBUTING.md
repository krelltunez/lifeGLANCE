# Contributing to lifeGLANCE

Thanks for your interest. lifeGLANCE is a stable, maintained project, and small fixes are genuinely welcome. Larger changes need a conversation first.

## Before You Open a PR

- **Small fixes** (typos, broken links, doc improvements, obvious bugs): open a PR directly, no issue needed.
- **Anything larger** (new features, dependency changes, refactors, UI changes): open an issue first so we can talk through whether it fits. lifeGLANCE has a deliberately narrow scope, and most feature requests are declined. Opening an issue saves you the work of building something that won't be merged.

The bar for "fits the scope" is: does this make the timeline more useful for tracking personal milestones, without adding network dependencies, accounts, or telemetry? If the answer requires explanation, it probably doesn't fit.

## What Won't Be Accepted

- Anything that sends data off the device by default
- Analytics, telemetry, or "anonymous usage" reporting in any form
- Account systems, server-side storage, or sync features that require a hosted backend
- Heavy dependencies for marginal features
- AI-generated PRs that haven't been reviewed and understood by the submitter

## Development

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
npm run lint       # ESLint (lint errors fail CI; warnings are advisory)
npm run lint:fix   # Auto-fix what ESLint can
npm test           # Run the Vitest suite
```

Node 20 or later is required. CI runs `npm run lint` on every push and PR, so run it locally before opening a PR.

## Pull Request Conventions

- Branch from `main` and PR back into `main`.
- Keep PRs focused: one logical change per PR.
- Update the README or other docs in the same PR if your change affects them.
- No em dashes in user-facing copy (commits and PR descriptions are fine).
- If your change touches the timeline rendering, test it at multiple zoom levels (single week through multiple decades) and in both light and dark mode before submitting.

## Reporting Issues

When filing a bug, include:

- Browser and OS
- Steps to reproduce
- Expected vs actual behavior
- Whether it reproduces on [lifeglance.app](https://lifeglance.app) or only on your self-hosted instance
- Console errors, if any

For privacy or security issues, please open a private security advisory on GitHub rather than a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
