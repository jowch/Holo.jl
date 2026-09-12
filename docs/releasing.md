# Releasing Holo to General

Prep for **v0.1.0**. Jonathan comments `@JuliaRegistrator register` **after**
this prep merges — never on the prep PR, and never before `main` CI is green.

Julia ships the registered git *tree*, not GitHub release assets. CI is the sole
author of `assets/overlay.js` (and `assets/holo-webgl.js`) on `main`. Register
and tag a **CI-green `main` commit**, never a branch head that CI has not rebuilt.

Do **not** run Registrator, create a git tag, or open a GitHub Release from the
prep PR. Those are Jonathan's post-merge steps.

## What this repo already has

- `Project.toml` `version = "0.1.0"` (standard first-registration version).
- MIT `LICENSE`.
- `[compat]` for every `[deps]` and `[weakdeps]` entry, plus `julia = "1.10"`.
- CHANGELOG frozen at `[0.1.0]` including `ViewInteractable` drag-to-pan / rotate
  and the overlay visual / live-verify playbook (#50, #52, #53).
- TagBot workflow (`.github/workflows/TagBot.yml`) — official v1.25.11 pin plus
  `ssh: ${{ secrets.DOCUMENTER_KEY }}`.
- Name `Holo` and UUID `82b01fb5-7eeb-4559-83ea-8d75f85d4328` are free in
  General (checked against the *unpacked package index* in `General.tar.gz`, not
  the 129-byte `General.toml` pointer). Nearby `HoloProcessing` /
  `DigitalHolography` / `ParticleHolography` are not a clash. The name is **4
  letters**, so AutoMerge will not merge the new-package PR unaided — a registry
  moderator has to approve the short name (guideline is ≥5 characters). Do not
  rename.

## What must be true before v0.1.0

All of these, then Jonathan registers:

1. This prep PR is merged (TagBot + freeze + docs).
2. CI on `main` is green for that tree (frontend jobs may commit
   `assets/overlay.js` / `assets/holo-webgl.js` back).
3. The SHA he registers is that CI-green commit **and** does not modify
   `.github/workflows/*.yml`, unless `DOCUMENTER_KEY` is set (see
   [First tag](#first-tag-this-prep-adds-tagbotyml)).
4. [JuliaTagBot](https://github.com/JuliaTagBot) is a collaborator with **write**
   (`issue_comment` trigger).
5. Repo **Settings → Actions → General → Workflow permissions** is **Read and
   write**. Do **not** add a workflow-level `permissions:` block to
   `TagBot.yml` (official TagBot tip).
6. The [JuliaRegistrator](https://github.com/apps/julia-registrator) GitHub App
   is installed on `jowch/Holo.jl`, or he uses the
   [web UI](https://juliahub.com/ui/Registrator).
7. He comments on **that commit's GitHub page**, not on an issue or pull request.

## Human steps (Jonathan, after merge)

1. **Merge** the CHANGELOG-freeze / TagBot prep PR to `main`. Do not comment `@JuliaRegistrator register` on a pull request — Registrator ignores PR comments.
2. **Wait for CI on `main`**. Prefer the frontend `[skip ci]` bundle follow-up
   if one lands — that commit does not touch workflows and is the SHA TagBot
   can tag with `GITHUB_TOKEN`.
3. **One-time repo access** (if not already done): JuliaTagBot write invite,
   Actions **Read and write**, Registrator app. Optional: create a write deploy
   key and store the private key as repo secret `DOCUMENTER_KEY` (Documenter's
   `genkeys` works even without a Documenter site). The workflow already reads
   it.
4. On **that commit's GitHub page**, comment:

   ```text
   @JuliaRegistrator register

   Release notes:

   First General release of Holo.jl — light, server-free interactivity for
   Makie plots in Pluto. Same hover / click / @bind contract on CairoMakie
   (static PNG) and WGLMakie (live canvas).

   Highlights: holo(fig) auto-extract + explicit interactables; tooltips and
   selection; ROI / thresholds; Axis3 and PolarAxis discrete overlays;
   Arrows3D start→end segments; drag-to-pan / drag-to-rotate
   (ViewInteractable, commit-on-release); overlay chrome #3A6F7C wash / ring /
   halo.

   Install: ] add Holo
   0.1.x stays additive; breaking changes go to 0.2.
   ```

   A later push can race an issue/PR comment (those register default-branch
   HEAD). The commit page pins the SHA.
5. Registrator opens a PR against
   [JuliaRegistries/General](https://github.com/JuliaRegistries/General). New
   packages wait **3 days**; expect a human for the 4-letter name even if the
   other AutoMerge checks pass.
6. When that General PR merges, TagBot creates the `v0.1.0` git tag and GitHub
   Release. Do **not** tag or open the Release first. If TagBot cannot push
   because the registered SHA modified a workflow file, it opens a
   **manual-release** issue — follow that, then (only then) tag / `gh release
   create` on the *registered* SHA.

## First tag (this prep adds `TagBot.yml`)

Official TagBot: `GITHUB_TOKEN` cannot create a tag or GitHub Release for a
commit that changes `.github/workflows/*.yml`. This prep *is* that change. The
merge commit (or a squash of it) is therefore a bad first-tag SHA unless
`DOCUMENTER_KEY` is set.

| Registered SHA | `GITHUB_TOKEN` can tag? | What to do |
|---|---|---|
| This prep's merge (adds `TagBot.yml`) | No | Do not register it. Wait for a later no-workflow commit, or set `DOCUMENTER_KEY`. |
| Later CI bundle commit-back (`[skip ci]`, no workflow diff) | Yes | Register **that** commit's page. |
| Any later green `main` commit that does not touch workflows | Yes | Same. |

`ssh: ${{ secrets.DOCUMENTER_KEY }}` is in the workflow (official example). An
empty secret is ignored; a real deploy key lets TagBot *tag* a
workflow-touching SHA. The GitHub Release for that SHA may still need the
auto-opened issue.

## Later versions

Bump `Project.toml` `version`, add a dated CHANGELOG section, merge to `main`,
wait for the bundle commit-back, then `@JuliaRegistrator register` on **that
commit's GitHub page**. TagBot tags. CompatHelper is not part of this path
(YAGNI until a dep churn actually hurts).

## What this path does not do

- Does not register from a feature branch or from this prep PR.
- Does not ship a Documenter site (still YAGNI; README is the install surface).
- Does not un-park animation / live drag preview / `LScene`.
