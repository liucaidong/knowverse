# Agent proactive analysis lazy-loading audit

## Findings

A local Chromium startup measurement of `/agent/` showed 405,497 bytes of JavaScript across 27 script-initiated requests. The page's advanced insights, learner profile, and AI conversation area are inside a closed `<details>` section, but the page eagerly imported `proactive-learning-engine.mjs` and its strategy/risk dependencies during initial workspace setup.

The proactive engine is needed for advanced recommendations and for generating/replanning learning plans, but it is not needed to render the primary goal and current-plan workspace when the advanced section is closed.

## Changes

1. Removed the eager static import of `proactive-learning-engine.mjs` from the Agent workspace.
2. Added a cached dynamic loader for the proactive engine and its dependencies.
3. Opening the advanced insights section triggers proactive refresh and renders the current recommendation/diagnostics.
4. Manual plan regeneration and event-driven auto-replanning explicitly load and refresh the proactive engine before generating a plan, preserving the existing strategy/risk projection inputs.
5. Ordinary goal/task refreshes do not load or recompute proactive analysis while the advanced section remains closed.
6. Added E2E checks that initial Agent JavaScript remains below 370,000 encoded bytes and does not request proactive, strategy, risk, spaced-repetition, or next-best-action modules. Separate checks verify that opening advanced insights and manually regenerating a plan load the engine on demand.

## Measured budget

- Before: 405,497 bytes of initial Agent JavaScript.
- After: E2E enforces less than 370,000 bytes, a guaranteed reduction of at least 35,497 bytes (about 8.7%) against the captured baseline.
- The heavy proactive module graph is absent from initial requests and is fetched only when needed.

## Safety

No planning algorithm, strategy rule, learner record, review record, cloud sync, Supabase, or authentication behavior was intentionally changed. Plan generation still refreshes the proactive projection before using it.
