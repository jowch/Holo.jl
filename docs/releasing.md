# Releasing Holo to General

The registration path locked in the next-wave plan: **CHANGELOG freeze → General
registration**, and only **after** drag-to-pan / drag-to-rotate. Sliders-only was
explicitly not a shortcut. Drag shipped in `#48`; this document is the remaining
path.

Julia ships the registered git *tree*, not GitHub release assets. CI is the sole
author of `assets/overlay.js` (and `assets/holo-webgl.js`) on `main`. Register and
tag a **CI-green `main` commit**, never a branch head that CI has not rebuilt.

## What this repo already has

- `Project.toml` `version = "0.1.0"` (standard first-registration version).
- MIT `LICENSE`.
- `[compat]` for every `[deps]` and `[weakdeps]` entry, plus `julia = "1.10"`.
- CHANGELOG frozen at `[0.1.0]` including `ViewInteractable` drag-to-pan / rotate.
- TagBot workflow (`.github/workflows/TagBot.yml`).
- Name `Holo` is free in General (checked against the depot registry). It is **4
  letters**, so AutoMerge will not merge the new-package PR unaided — a registry
  moderator has to approve the short name (guideline is ≥5 characters). Do not
  rename.

## Human steps (Jonathan)

1. **Merge** the CHANGELOG-freeze PR to `main`.
2. **Wait for CI on `main`** — especially the frontend jobs that may commit
   `assets/overlay.js` / `assets/holo-webgl.js` back. Register *that* commit (or
   a later green one), not the merge commit if a `[skip ci]` bundle follow-up
   lands after it.
3. **One-time repo access**
   - Invite [JuliaTagBot](https://github.com/JuliaTagBot) as a collaborator with
     write (TagBot's `issue_comment` trigger needs it).
   - Install the [JuliaRegistrator](https://github.com/apps/julia-registrator)
     GitHub App on `jowch/Holo.jl`, or use the
     [web UI](https://juliahub.com/ui/Registrator).
4. On the CI-green `main` commit, comment:

   ```text
   @JuliaRegistrator register
   ```

   Optional release notes (TagBot copies them onto the GitHub release):

   ```text
   @JuliaRegistrator register

   Release notes:

   First General release. Frozen after drag-to-pan / drag-to-rotate
   (`ViewInteractable`); not a sliders-only API freeze.
   ```

5. Registrator opens a PR against [JuliaRegistries/General](https://github.com/JuliaRegistries/General).
   New packages wait **3 days** for community feedback; expect a human for the
   4-letter name even if the other AutoMerge checks pass.
6. When that PR merges, TagBot creates the `v0.1.0` git tag and GitHub release.
   Do **not** tag by hand first — a hand tag on the wrong SHA would publish a
   tree CI has not signed off as the bundle author.

## Later versions

Bump `Project.toml` `version`, add a dated CHANGELOG section, merge to `main`,
wait for the bundle commit-back, then `@JuliaRegistrator register` on that
commit. TagBot tags. CompatHelper is not part of this path (YAGNI until a dep
churn actually hurts).

## What this path does not do

- Does not register from a feature branch.
- Does not ship a Documenter site (still YAGNI; README is the install surface).
- Does not un-park animation / live drag preview / `LScene`.
