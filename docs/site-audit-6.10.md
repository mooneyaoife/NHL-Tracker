# NHL Tracker 6.10 — Tonight as a navigable game story

## Outcome

Tonight now extends the approved Home visual system into the authoritative NHL slate without copying Home's featured-game treatment.

The page follows a deliberate sequence:

1. Orient with the date, scope and compact slate counts.
2. Move through every game on a time-ordered slate rail.
3. Read the followed game with its evidence already open.
4. Open deeper matchup evidence only for other games that need investigation.
5. Continue into the existing complete Game Centre.

## Simplification without loss

- All official games remain available.
- All existing matchup values remain available: recent form, expected-goals share, goalie workload lead and scoring leader.
- Followed-team filtering, route state and remembered filter state remain intact.
- Every game retains its Game Centre route.
- Repeated analytical blocks are collapsed for non-followed games rather than removed.
- The followed game remains expanded because it is the user's highest-context game.

## Meaningful movement

The slate rail represents each game as a state. Selecting one:

- moves the rail marker to that game's position;
- updates pressed state for keyboard and assistive-technology users;
- moves to the matching game card;
- briefly marks the destination so the movement is easy to follow.

Reduced-motion preferences replace smooth movement and remove the focus animation.

## Responsive and theme review

- Large screens feature the followed game across the full page and arrange its matchup and analytical evidence side by side.
- Other games use a compact two-column library.
- On phones, the slate rail becomes a horizontally scrollable sequence while the page itself retains zero horizontal overflow.
- The four summary values stay in one compact phone row so the first game appears sooner.
- Light mode remains the visual priority; dark mode preserves readable borders, state and controls.

## Verification

- JavaScript syntax and diff checks passed.
- All 15 season-rollover tests passed.
- Browser QA covered slate movement, evidence expansion, followed-team filtering, filter persistence, Game Centre routing, mobile layout, light mode and dark mode.
- No page-level horizontal overflow was observed at 390px or 1536px.
