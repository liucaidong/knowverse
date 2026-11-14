# Review and Agent asynchronous layout stability audit

## Findings

A representative desktop startup measurement exposed layout shifts caused by asynchronous workspace initialization:

- Review workspace: CLS reached 0.119 in the initial run (a repeated run measured 0.1802). The `#target-list` placeholder was about 66 px tall, then expanded to 687 px after the learning map loaded, moving the review history and footer by more than 600 px while they were still in the viewport.
- Agent workspace: CLS measured 0.071. The footer was initially visible immediately after a 94 px loading message, then moved below a newly revealed workspace that was about 1,002 px tall.

## Changes

1. Reserve 690 px for the review target list before its asynchronous topic groups render. This matches the current desktop registry layout and keeps the history section below the initial viewport while content is populated. On narrow screens, the longer stacked list naturally keeps the history section below the viewport.
2. Keep the Agent footer hidden while the workspace is still initializing. Reveal it after the workspace is ready, or after initialization fails, so it does not jump from the initial loading position to the bottom of the rendered workspace.
3. Extend `scripts/e2e-layout-performance.mjs` to test review and Agent at 1440×960 and 390×844, asserting CLS below 0.1, no horizontal overflow, and correct footer reveal after Agent initialization.

## Verification

- Browser E2E: all four route/viewport combinations satisfy CLS < 0.1.
- Existing review, Agent, navigation, and page-startup interaction tests remain part of the combined regression suite.

No review-session records, learner state, cloud sync, Supabase, or authentication data were changed.
