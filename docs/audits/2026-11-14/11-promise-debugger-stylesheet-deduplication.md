# Promise debugger stylesheet deduplication audit

## Finding

`lab/experiments/promise-debugger/index.html` already declares `workspace-layout.css` in the document head. After decoding the runtime bundle, `debugger.js` appended a second link to the same stylesheet and awaited its load event before initializing the debugger. This duplicated stylesheet registration and introduced an unnecessary asynchronous gate in the workbench startup path.

## Change

Removed the second, dynamically injected stylesheet link and its load-event wait. The existing head stylesheet remains the single source of layout rules and is requested by the browser as part of normal document loading. The runtime bundle CSS is still injected separately because it is generated as part of the versioned runtime bundle.

The unified learning integration remains enabled: the debugger is a registered live learning work with an associated checkpoint and tutor workflow. Removing that integration would have broken learning functionality and failed the content contract, so it was retained.

## Regression coverage

The Chromium desktop and WebKit mobile workbench E2E now asserts that exactly one `workspace-layout.css` link exists, while retaining checks for the bundled theme, scenarios, no obsolete stylesheet request, viewport fit, and executable Run control.

## Scope

No learning integration, learning data, checkpoint behavior, sync, Supabase, or authentication behavior was changed.
