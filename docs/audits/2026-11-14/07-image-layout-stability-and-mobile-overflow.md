# Image layout stability and mobile overflow audit

## Scope

- Scanned all 148 HTML documents in the static site.
- Found 28 local `<img>` elements; all 28 lacked explicit intrinsic `width` and `height` attributes.
- Ten Monorepo unit diagrams also lacked `decoding="async"`.
- Existing image E2E coverage exercised only a subset of the knowledge pages.

## Changes

1. Added intrinsic width and height to all 28 local images using their source SVG `viewBox` or PNG dimensions. This lets the browser reserve the correct aspect ratio before image download and reduces image-driven layout shifts.
2. Added `decoding="async"` to the ten Monorepo unit diagrams.
3. Expanded the Chromium desktop and WebKit mobile image policy E2E routes to all 25 pages containing images. The test verifies lazy loading, asynchronous decoding, useful alt text, intrinsic dimensions, successful image loading, and no document-level horizontal overflow.
4. Added `scripts/verify-image-intrinsic-dimensions.mjs` to enforce the image contract across every HTML page and validate local image paths.
5. Fixed a WebKit-only 7 px horizontal overflow on Monorepo unit 05. The cause was long inline code/path content inside article paragraphs. Narrow-screen article paragraphs and list items now wrap long tokens; code samples also wrap on narrow screens while remaining scrollable on desktop.

## Verification

- Static image policy: all local images across all 148 HTML pages.
- Browser E2E: Chromium desktop and WebKit mobile, 25 image-bearing routes per engine.
- The initial WebKit run exposed the unit-05 overflow; after the CSS correction, both browser engines passed.

No cloud sync, Supabase, authentication, or learner data behavior was changed.
