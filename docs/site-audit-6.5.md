# NHL Tracker site audit — round one

This audit protects capability while the interface is simplified. A surface may disappear from a secondary page only after its complete function has an authoritative home and the secondary location has a contextual route to it.

## Authoritative information architecture

| Primary area | Authoritative capability | Existing routes retained |
| --- | --- | --- |
| Home | Tonight briefing, season orientation, saved-player signals, pinned analytical shortcuts | `#dashboard` |
| Tonight | League slate, selected game, matchup intelligence, game library, lineups | `#tonight`, `#games`, `#availability` |
| Season | Calendar, season shape, schedule publication, form, projections and playoff path | `#schedule`, `#trends`, `#playoffs` |
| Explore | Team, player, league, ranking, comparison and news workspaces | `#teams`, `#players`, `#league`, `#power`, `#compare`, `#news` |
| Workspace | Saved items, tracked teams, display preferences, Stat Guide and data status | `#watchlist`, `#guide`, `#status` |

## Duplication decisions

| Evidence | Previous duplication | Authoritative home | Home treatment |
| --- | --- | --- | --- |
| Record and points | Home cards, Team Overview, League, Playoffs | Team Overview and League standings | Season File summary only |
| Recent form | Home, Team Trends, Trends Centre | Trends Centre; team-specific detail in Team Trends | Five-game glance with route to Trends |
| Expected-goals process | Home map, Team Performance, Trends, Power | Team Performance and League Rankings | Performance-map gateway |
| Division race | Home and League | League | Removed from visible Home; route supplied |
| Recent results | Home and Game Library | Game Library | Removed from visible Home; route supplied |
| Team leaders | Home, Players and League Leaders | League Leaders and Players | Replaced by saved-player signals |
| Playoff probability | Season File and Playoffs | Playoffs | Season File state and pinned shortcut |
| Schedule difficulty | Schedule and matchup pages | Season Shape | Contextual references only elsewhere |

## Functional inventory

- 16 routed pages remain addressable through their existing hashes.
- Game Centre retains selected game, matchup intelligence and game library panes.
- Teams retain Overview, Performance, Special Teams, Trends and Games.
- Players retain Overview, Impact, League Explorer and Goalies.
- League retains Overview, Team Rankings and Player Leaders.
- News retains Latest, Transactions, Cap Centre, Insider Wire and Rosters.
- Search continues to index pages, teams, players, games, statistics and news.
- Tracked teams, saved players, theme, compact mode, route state and scroll state remain browser-local.
- Round one adds browser-local Home module order, visibility and pinned analytics.
- Every existing chart receives an optional contextual interaction overlay; the Stat Guide remains the full reference.

## Motion rules

- Automatic entrance motion is applied once when a meaningful section becomes visible.
- User-controlled transitions drive Season File state changes, navigation, filters and workspace editing.
- Charts never wait for decorative animation before becoming usable.
- `prefers-reduced-motion` removes entrance and state-transition animation.

## Deferred to round two

- Consolidate overlapping League, Trends and Power analytical renderers into fewer workspaces.
- Remember the last filter state independently for every analytical page.
- Add pin actions directly to authoritative charts and views.
- Expand saved-player Home signals from season totals to change detection.
- Complete chart-specific interaction copy for every specialised Plotly view.
