# Docs index

User docs are the [Documenter site](https://jowch.github.io/Holo.jl), built from
[`docs/src/`](src/). Maintainer notes are [`docs/dev/`](dev/):

Building the site runs every example notebook (`docs/export_notebooks.jl`) to produce its
static export, so a local build takes several minutes on a warm depot and longer cold.

| Doc | What it covers |
|---|---|
| [`architecture.md`](dev/architecture.md) | The design contract: `AbstractBackend`/`AbstractInteractable`, the geometry primitives between them, the manifest shape, tooltips wire format. |
| [`backend-comparison.md`](dev/backend-comparison.md) | Cost/latency comparison between the `:cairo` and `:webgl` backends. |
| [`frontend-delivery.md`](dev/frontend-delivery.md) | Browser-side build/delivery decisions: bundling, manifest transport, DPI/sizing, JS testing, CI. |
| [`live-interaction-checklist.md`](dev/live-interaction-checklist.md) | The live-verification playbook run against a real Pluto + browser before any user-facing change is called done. |
| [`perf-findings.md`](dev/perf-findings.md) | The measured payload-size and click-latency envelope; the single source of those numbers for the rest of the docs. |
| [`releasing.md`](dev/releasing.md) | Steps for registering and tagging a Holo release. |
| [`roadmap.md`](dev/roadmap.md) | Milestones and priorities for the rest of the feature set. |
