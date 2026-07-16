# NHL Tracker 6.6 — Round 2 audit and consolidation

## Outcome

Round 2 simplifies the analytical information architecture without removing any renderer, route, dataset, filter, comparison, game view, or saved-item capability.

The main consolidation is a single **League Analysis** family:

1. Overview — standings and division context.
2. Team Rankings — category-based league ranking.
3. Form & Trends — recent movement against season performance.
4. Power Index — the tracker’s transparent composite strength model.
5. Player Leaders — league-wide skater and goalie leaderboards.

The existing `#trends` and `#power` routes remain valid so bookmarks and direct navigation continue to work. They now carry the same analysis-family rail and return directly to any authoritative League view.

## Duplication decisions

| Repeated subject | Authoritative location | Supporting treatment |
| --- | --- | --- |
| League standings and division context | League Analysis → Overview | Home and other pages provide concise context and link back. |
| Team rankings | League Analysis → Team Rankings | Home pin opens the exact ranking view. Ranking rows still open the relevant team evidence. |
| Recent form | League Analysis → Form & Trends | Home keeps only a concise followed-team signal. |
| Composite strength | League Analysis → Power Index | Team pages retain team-specific evidence; no second league ranking table was added. |
| Player leaderboards | League Analysis → Player Leaders | Saved players show change signals, not a duplicate full leaderboard. |
| Schedule difficulty | Season → Schedule → Season shape | Home pins and contextual links open the complete schedule evidence. |
| Playoff probability | Season → Playoff path | Home keeps the route, not a duplicate forecast workspace. |

## Personal workspace changes

- Analytical charts with meaningful standalone value now have a direct star control.
- Pins open the exact page and, for League views, the exact sub-workspace.
- Default Home pins and chart pins share identifiers, preventing duplicate Home rows.
- Saved-player rows now prefer a point streak or recent five-game change signal, falling back to current pace when game history is unavailable.
- Home configuration lists default choices plus any analytical views the user has added.

## Remembered page context

Filters are stored locally and independently for Tonight, Schedule, Games, Lineups, Teams, Players, Compare, News, League, Trends, Playoffs, and the Stat Guide. Every one of those pages has a visible **Reset view** action. Global followed-team choices, theme, compact-table preference, and Home layout remain separate settings and are not affected by a page reset.

URL routes remain authoritative when present. League sub-workspaces now write `leagueView` into the URL so refresh, back/forward navigation, and direct links preserve the selected analysis view.

## Motion and accessibility review

- Round 1’s meaningful reveal and state-transition motion remains intact.
- The new analysis rail uses state and horizontal movement only when space requires it.
- Pin controls have explicit changing accessible names: “Pin … to Home” and “Unpin … from Home”.
- Reset actions are keyboard reachable and use text rather than an unexplained icon.
- Mobile analysis rails scroll horizontally without causing page-level overflow.
- Reduced-motion handling remains unchanged.
- Light mode is the visual priority; dark mode was checked for readable surfaces, controls, and hierarchy.

## Verification

- JavaScript syntax check passed.
- Whitespace/error diff check passed.
- All 15 season-rollover tests passed.
- Browser QA passed for League deep links, League-to-Trends flow, analytical pin toggling, filter persistence after reload, reset behavior, 390 px mobile layout, light mode, and dark mode.
- No browser console warnings or errors were observed during the QA path.
