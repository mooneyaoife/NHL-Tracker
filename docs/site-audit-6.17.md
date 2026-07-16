# Site audit 6.17 — cross-season matchup evidence

## Outcome

Upcoming 2026–27 games can now be compared with the complete 2025–26 statistical profile in Matchup Intelligence. The game date, venue, rest sequence, season series and official availability remain authoritative 2026–27 information.

## Behaviour

- A new **Stat evidence** selector separates the fixture season from the evidence season.
- The selector defaults to 2025–26 while the 2026–27 MoneyPuck sample is unavailable, and remembers the user's choice locally.
- 2025–26 team rankings, records, skater leaders and goalie evidence load only when requested.
- A visible evidence banner and the expandable reading guide name both seasons and explain which data belongs to each.
- Shared Game Centre URLs preserve the chosen evidence season.
- Current-season evidence remains selectable and will populate automatically as 2026–27 data arrives.

## Verification

- JavaScript syntax check passed.
- All 15 season-rollover tests passed.
- Desktop interaction confirmed for both evidence-season choices and URL state.
- Mobile 390 × 844 layout confirmed with stacked controls.
- Dark mode confirmed readable; the viewport and theme were reset after testing.
