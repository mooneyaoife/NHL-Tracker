# Site audit 6.14 — consistency, accessibility and performance

## Scope

The audit covered all 16 destinations in the live application at desktop and mobile widths, including primary and contextual navigation, charts, tables, dialogs, stored preferences, keyboard interaction, reduced motion and dark mode.

## Baseline findings

- Every destination had a visible primary heading.
- Visible charts already exposed accessible names and every visible image had an `alt` attribute.
- No destination produced page-level horizontal overflow.
- Focus indicators, a skip link and reduced-motion rules were already present.
- The remaining issues were shared-system concerns: hidden pages constructed Plotly charts during startup, three identity selectors had no accessible name, tables were not named keyboard regions, page changes were silent to assistive technology, dialog focus could escape, and hover menus supported only partial arrow-key navigation.

## Changes

### Performance

- Plot specifications for hidden pages and hidden analytical panes are now queued rather than rendered.
- Queued charts render only when their page, file, tab or details section becomes visible.
- Existing resize settling remains in place after a deferred render.
- Plotly and the application script are deferred so HTML can finish parsing first.

### Accessibility

- SPA route changes update the document title and a polite live region.
- Every page section is associated with its first visible page heading.
- Team and player selectors have explicit accessible names.
- Data-table wrappers are named, focusable regions, allowing keyboard users to reach horizontally scrollable evidence.
- Empty chart states expose their message as a status.
- Search and chart-help dialogs now contain keyboard focus until dismissed and restore focus afterward.
- Desktop hover menus support Arrow Up, Arrow Down, Home, End and Escape.

### Consistency

- All fixes are implemented through shared helpers and tokens rather than page-specific overrides.
- Existing capabilities, route state, saved preferences, chart interactions and responsive layouts are unchanged.
