# NHL Tracker 6.8 — Round 4 personal analytical workspace

## Outcome

Round 4 turns analytical shortcuts into exact browser-local saved views. A saved view preserves the chart, routed page, analytical sub-workspace and every relevant page filter. Opening it restores the context before returning the user to the chart.

Existing star pins, saved players, followed teams, Home layout, remembered filters, routes and all analytical capabilities remain intact.

## Exact saved views

The chart guidance overlay now includes **Save this exact view** where a stable analytical context is available.

Each record stores:

- chart and page;
- League, Team, Player, Compare or Game sub-workspace where applicable;
- current team, metric, scope, window, player or comparison filters for that page;
- a concise human-readable filter summary;
- local save time.

Reopening a view restores the captured values, updates the page’s remembered-filter state, renders the correct workspace and moves to the chart. Repeated saves of the same chart and context update the existing record instead of creating duplicates. Up to 16 distinct contexts are retained in the browser.

## Information authority

**Workspace → Saved Views** is the authoritative management location. It provides:

- the complete saved-view list;
- exact filter summaries;
- direct open actions;
- individual removal controls;
- an explicit empty state explaining how to save a view.

Home remains concise. Its **Pinned & saved** module shows up to four exact saved views followed by ordinary pins. When an exact view corresponds to an existing pin, the exact view replaces the generic shortcut so the same analytical destination is not reported twice.

## Backward compatibility

- Existing `nhl-home-workspace-v1` pins are unchanged.
- Exact views use the separate `nhl-saved-analysis-views-v1` browser-local record.
- Existing page-filter memory remains authoritative for ordinary navigation.
- Opening an exact saved view intentionally updates that page’s remembered filters.
- Removing an exact view reveals any underlying generic pin again.

## Accessibility and responsive review

- Save, open and remove actions are keyboard-accessible buttons.
- Removal controls have view-specific accessible names.
- Successful saves provide visible confirmation in the chart overlay.
- Saved-view rows collapse from three columns to two on mobile without losing the title, context or removal action.
- The 390 px Workspace has no page-level horizontal overflow.
- Light and dark Workspace surfaces were visually checked.
- The saved-view scroll uses no animation when reduced motion is requested.

## Verification

- JavaScript syntax and diff checks passed.
- All 15 season-rollover tests passed.
- Browser QA passed for exact capture, Home rendering, generic-pin deduplication, filter restoration, URL synchronisation, Workspace management, removal and duplicate-save prevention.
- Filter state survived a full reload.
- No browser console warnings or errors were observed.
