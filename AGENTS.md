## Cursor Cloud specific instructions

- Use `pnpm` for all package/script commands in this repository.
- The repository currently enforces a pnpm supply-chain release-age policy that can block normal script execution in fresh cloud sessions. Run project commands with `PNPM_CONFIG_MINIMUM_RELEASE_AGE=0` in this environment when the lockfile verification gate fails.
- Standard scripts are defined in `package.json` (`dev`, `typecheck`, `build`, `deploy`). Prefer those over ad-hoc command variants.
- For local cloud-agent runtime validation without Cloudflare OAuth, run the Worker in local mode:
  - `PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 pnpm exec wrangler dev --local --port 8787`
- `pnpm run dev` may trigger Wrangler OAuth login for remote mode. Use local mode above when you only need local end-to-end validation.
- There is no dedicated test script in `package.json` at this time; use `typecheck` and `build` as the primary automated validation commands.
