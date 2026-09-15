# Docs index

Which doc to read depends on whether you're using Holo or maintaining it.

| Doc | Audience | What it covers |
|---|---|---|
| [`tooltips.md`](tooltips.md) | user | The `holo"..."` template syntax for tooltip text. |
| [`architecture.md`](architecture.md) | maintainer | The design contract: `AbstractBackend`/`AbstractInteractable`, the geometry primitives between them, the manifest shape. |
| [`backend-comparison.md`](backend-comparison.md) | maintainer | Cost/latency comparison between the `:cairo` and `:webgl` backends, and why both are co-equal entry points rather than one being a heavier version of the other. |
| [`design.md`](design.md) | maintainer | Historical design notes (2026-06-26 snapshot); superseded by `architecture.md`/`roadmap.md` where they disagree. |
| [`frontend-delivery.md`](frontend-delivery.md) | maintainer | Browser-side build/delivery decisions: bundling, manifest transport, DPI/sizing, JS testing, CI. |
| [`live-interaction-checklist.md`](live-interaction-checklist.md) | maintainer | The live-verification playbook run against a real Pluto + browser before any user-facing change is called done. |
| [`perf-findings.md`](perf-findings.md) | maintainer | The measured payload-size and click-latency envelope; the single source of those numbers for the rest of the docs. |
| [`releasing.md`](releasing.md) | maintainer | Steps for registering and tagging a Holo release. |
| [`research-findings.md`](research-findings.md) | maintainer | Historical feasibility research backing the original design. |
| [`roadmap.md`](roadmap.md) | maintainer | Milestones and priorities for the rest of the feature set. |
| [`survey-makie-surfaces.md`](survey-makie-surfaces.md) | maintainer | Survey of Makie plot/interaction APIs behind the introspection recipes in `src/introspect.jl`. |

The top-level [`README.md`](../README.md) is the primary user-facing entry point (install,
quick start, API reference); these docs go deeper on design and process.
