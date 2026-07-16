# NHL Tracker 6.11 — Season as a guided file

## Outcome

The authoritative Season experience now presents one question at a time instead of expanding Calendar, Season Shape and Publication Status into a single 5,500-pixel document.

The Season rail moves through five connected states:

1. Calendar — when games happen, in UK time.
2. Season Shape — workload, density and opponent difficulty.
3. Form — recent movement in its authoritative League Analysis workspace.
4. Playoff Path — current outlook in its authoritative forecast workspace.
5. Publication — the separate next-season schedule monitor.

## Simplification without loss

- Calendar filters, month selection, game links and subscriptions remain intact.
- Season Shape retains all four summary values, both primary charts, dates worth circling and demanding stretches.
- The detailed difficulty timeline, rest heatmap and key 10-game windows remain available inside an explicit deeper-roadmap file.
- Publication status, team completeness, opening dates and detected changes remain intact.
- Form and Playoff Path are linked rather than copied into Schedule.
- Only one Schedule chapter is rendered visibly at a time; no renderer, dataset or route was removed.

## Remembered and shareable state

- The selected Schedule chapter is remembered in the browser.
- `scheduleChapter` is written into the route, so reloading or sharing the URL restores the same chapter.
- Calendar team and month route parameters continue to work alongside the chapter state.
- On phones, the active chapter is automatically centred in the horizontal rail.

## Meaningful movement

Choosing a chapter changes the complete evidence surface and the selected-file label. The rail moves to keep the active state visible on smaller screens. Chapter changes use a short entrance transition, removed under `prefers-reduced-motion`.

## Responsive and theme review

- The desktop Season landing height is reduced from roughly 5,502px to 1,562px with Calendar selected.
- Publication is a compact isolated file rather than the end of an unrelated long scroll.
- The phone rail scrolls horizontally with no page-level overflow.
- Calendar controls stack cleanly on phones while keeping both team and month selectors.
- Light mode remains the visual priority; dark mode preserves chapter state, borders and readable controls.

## Verification

- JavaScript syntax and diff checks passed.
- All 15 season-rollover tests passed.
- Browser QA covered Calendar, Season Shape, deeper-roadmap expansion, Form routing, Playoff Path routing, Publication, remembered state, URL restoration, mobile rail positioning and dark mode.
- No horizontal overflow was observed at 390px or 1536px.
