# NHL Intelligence release decision

## Decision

Ship two connected Home capabilities without adding a provider, backend, route, or browser-side analytical formula:

1. **Watch Next** answers “What should I know before the next game?” It presents the next relevant matchup, up to three schedule-context signals, the evidence season, freshness, and a one-action path to that exact Game Centre.
2. **Since last check** answers “What changed for the teams I follow?” It makes the existing Tracker briefing available on the compact direct-Home path and stores a bounded, device-local snapshot only after fresh data loads successfully.

The Python build owns all cross-record derivation. The browser only filters precomputed rows to the locally selected teams and formats Europe/London dates.

## Decision-oriented data truth map

| Capability | Repository evidence | Source / season | Cadence and freshness | Suitable use | Constraint |
|---|---|---|---|---|---|
| Schedule and game state | `scripts/update_tracker.py`, `tracker.games`, `tracker.daily` | Official NHL; active season | Scheduled updates plus live Cloudflare overlay; `meta.freshness` | Next game, slate, status, exact Game Centre | Future start times can change |
| Game-level schedule burden | `scripts/update_tracker.py` schedule model, `games[].schedule` | Official schedule + prior-season NHL standings | Recomputed with artifact | Rest, travel, congestion and opponent context | Context only; not a result prediction |
| Season schedule difficulty | `tracker.scheduleDifficulty` | Same model; source season is explicit | Recomputed with artifact and reconciled | Season-shape supporting evidence | Relative to the published schedule |
| Standings | `tracker.standings`, `previousSeasonStandings` | Official NHL; current and prior | Artifact cadence | Opponent baseline and season context | Do not mix a 0 GP current season with prior results |
| Game Centre summaries | `tracker.gameCentre`, compact core shard | Official NHL | Stored artifact; live enhancement where available | One-action supporting evidence | Some detailed feeds arrive near game time |
| Play-by-play and shots | `tracker.gameCentre` | Official NHL; completed/current games | Artifact/live availability varies | Detailed game evidence | Not needed for pregame schedule context |
| MoneyPuck models | `tracker.moneypuck` | Approved downloads | Manual/season-dependent status | Current analytical evidence when present | Current season is awaiting data; excluded from this release |
| Natural Stat Trick | `tracker.naturalStatTrick` | Manual CSV import | Manual status is explicit | Possession and player evidence | Current season is awaiting import; excluded |
| Official player totals | `tracker.officialPlayers` | Official NHL | Artifact cadence | Player form and leaders | Current season has no games; excluded from flagship |
| Rosters | `tracker.rosters` | Official NHL | Artifact cadence with per-team fallback status | Current roster identity | A roster listing is not game availability |
| Roster movement | `rosterChangeHistory` | Diff of official roster snapshots | Artifact cadence | Return-visit change signal | Feed can be sparse; presented as detected change only |
| Schedule changes | `scheduleRelease.recentChanges` | Diff of official schedule snapshots | Artifact cadence | Return-visit reschedule signal | Empty when nothing changed |
| Local followed teams | `site/preferences.js`, `nhl-tracked-teams` | Device-local user choice | Immediate | Personalised ordering/filtering | No cross-device sync is implied |
| Existing return-visit model | `site/app.js` `currentVisitSnapshot` / `renderSinceLastVisit` | Generated data + local snapshot | On successful load | Continuity | Previously required the full app bundle |
| Static Home artifact | `scripts/generate_build_metadata.py`, `data/home.json` | Derived from committed tracker artifact | Every build/update | Fast, offline-capable Home | Must remain compact and schema-versioned |
| Cloudflare live overlay | `functions/api`, `site/cloudflare-live.js` | Official NHL behind Access | Request-time when enabled | Live game enhancement | Static artifact remains the fallback |
| Historical archives | `data/seasons/` and manifest | Generated season snapshots | Immutable after archive | Archived-season truth | No upcoming game is a valid state |

Strongest underused capabilities are the per-game schedule evidence, the reconciled evidence-season metadata, exact Game Centre identifiers, schedule-change history, and the existing compatible return-visit model. Current-season player and expected-goal feeds are hard gaps, so player-form, lineup prediction, and predictive matchup concepts are out of scope.

## Selective benchmark patterns

| Product | Adaptable pattern | NHL Tracker fit |
|---|---|---|
| [NHL Game Previews](https://www.nhl.com/news/topic/game-previews/) | A few prioritised things to watch beat an undifferentiated stat wall. | Limit the brief to three plain-language signals. |
| [MoneyPuck methodology](https://www.moneypuck.com/about.htm) | Expose model inputs and distinguish context from probability. | Put source season and limitations beside the signals. |
| [Baseball Savant Gamefeed](https://baseballsavant.mlb.com/gamefeed?gamePk=415875) | Keep overview, evidence, and definitions in the same journey. | One disclosure and one exact Game Centre action. |
| [FotMob following](https://www.fotmob.com/en-GB/topnews/28453-how-follow-world-cup-fotmob) | Followed items rise first while a useful global default remains. | Local teams personalise; first visit uses the league slate. |
| [Formula 1 live timing](https://www.formula1.com/en/latest/article/f1-live-timing-bigger-and-better-than-ever.3wTlvar6VFvyDbm8GWnyMM) | Overview and detail coexist without forcing route changes. | Compact Home brief links directly to stored detail. |
| [Sofascore](https://corporate.sofascore.com/about) | Translate complex sports data into an immediate fan answer. | Explain rest, travel, opponent baseline, and congestion in words. |

## Concept scoring

Scores are 0–5. Weighted total uses usefulness 25%, data trust 20%, distinctiveness 15%, repeat use 10%, batch coherence 10%, maintainability 10%, and mobile/resilience 10%.

| Concept | Use | Data | Distinct | Repeat | Coherence | Maintain | Resilience | Weighted |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Watch Next schedule brief | 4.9 | 4.9 | 4.5 | 4.6 | 4.9 | 4.7 | 4.8 | **4.78** |
| Compact Since last check | 4.6 | 4.8 | 4.2 | 5.0 | 4.9 | 4.6 | 4.7 | **4.67** |
| Schedule stress alerts only | 4.3 | 4.9 | 4.1 | 4.5 | 4.5 | 4.8 | 4.8 | 4.54 |
| Daily league signal board | 4.2 | 4.6 | 4.0 | 4.0 | 4.1 | 4.6 | 4.6 | 4.31 |
| Roster movement digest | 3.8 | 3.8 | 3.8 | 4.2 | 4.4 | 4.3 | 4.4 | 4.05 |
| Historical “why unusual” | 4.0 | 2.5 | 4.6 | 3.5 | 3.8 | 3.3 | 3.5 | 3.57 |
| Player form watch | 4.5 | 1.7 | 4.2 | 4.6 | 3.9 | 3.6 | 3.4 | 3.44 |
| Predictive matchup lean | 4.3 | 1.4 | 4.3 | 4.2 | 3.7 | 2.8 | 3.0 | 3.19 |

The selected pair is more coherent than taking schedule stress as a separate feature: Watch Next subsumes that signal, while Since last check creates a reason to return. The nearest rejected alternatives are schedule stress alerts (duplicative) and a daily league signal board (less personal and less continuous). Player form and prediction fail the current data-fit gate.

## Acceptance brief

**Derivation owner:** `scripts/home_intelligence.py`, invoked by `scripts/generate_build_metadata.py`.

**Placement:** the existing Home “Next up” section becomes Watch Next; the existing hidden `#since-last-visit` panel becomes the companion. No route is added.

**Inputs:** official schedule/game rows, their canonical `schedule` evidence, `scheduleDifficulty.sourceSeason`, artifact timestamps/freshness, roster-change history, and schedule-release changes. Missing values remain absent rather than becoming zero.

**Applicable states:** upcoming/offseason-next, current live/final slate, postponed/rescheduled, no-game/offseason, stale, offline/static, first visit, returning visit, cleared/denied storage, new season, and archived season with no upcoming games.

**Limitations:** schedule burden describes logistical and prior-opponent context only. It does not include injuries, projected goalies, current form, or win probability. First-game rest is not interpreted as a deficit. Return-visit state is local to this browser.

**Demonstration cases:** hero—earliest followed-team or league game with prior-opponent evidence; contrast—travel/congestion-heavy road game; sparse—no schedule evidence; archive—no upcoming games; stale—brief remains readable but the local comparison baseline is not advanced.

**Measurable success:** one primary answer, evidence period and freshness are visible within the Home section; no more than three signals; exact Game Centre reachable in one action; first-load data stays below the existing 100 KB budget; offline cache stays below its budget; no initial-route LCP/TBT median regression over 10%; affected browser, accessibility, build, cache, and generation tests pass.

## Release validation (local only)

| Gate | Result | Evidence |
|---|---|---|
| Python generation and contracts | Pass | 63 unit tests passed, including seven focused Home-intelligence cases. |
| Frontend and data contracts | Pass | All Node contract suites passed; schema 3 Home data remained within the existing static budgets. |
| Browser behavior | Pass with recorded contention rerun | All 114 Playwright cases passed across mobile and desktop. The final two-worker run completed 112 and timed out in two unchanged deep-route visual checks; both passed immediately when rerun serially. New and affected coverage includes accessibility, offline, stale, archived, denied-storage, season rollover, meaningful return-visit changes, 200% reflow, and exact-game navigation. |
| Production-equivalent updater | Pass with non-blocking provider warning | An isolated run generated 2,688 team-game rows, a complete 32-team schedule, fresh rosters, 32 team briefs, 36 bounded upcoming continuity rows, and five roster changes. MoneyPuck's not-yet-published 2026 team summary returned 404 and was excluded through the existing optional-provider fallback. |
| Static budgets | Pass | Initial JS 20,992 / 21,000 bytes; styles 209,767 / 220,000; Home data 66,820 / 100,000; offline cache 1,784,180 / 2,100,000. |
| Lighthouse, three production-like compressed runs | Pass | Median LCP 1,693 ms versus 1,657 ms baseline (+2.2%); median TBT 84 ms versus 85 ms baseline; CLS 0; median performance 0.99; accessibility, best practices, and SEO 1.00. |
| Cloudflare build artifact | Pass | The production-URL build completed and `verify_cloudflare_build.py` passed. |
| Deployed application | Pending authenticated handoff | The private Pages URL redirects this test session to Cloudflare Access sign-in. No authentication or external settings were changed. |

No commit, push, deployment, or external-system mutation is included in this release candidate.
