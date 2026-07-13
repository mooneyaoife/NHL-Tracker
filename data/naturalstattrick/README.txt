NATURAL STAT TRICK TEAM DATA

This folder stores the manually downloaded Natural Stat Trick team export.

Current export settings:
- Season: 2025-2026
- Season type: Regular Season
- Situation: 5v5 Score & Venue Adjusted
- Score: All Scores
- Rate: Counts
- Team: All Teams
- Export button: CSV (All)

To replace the data later:
1. Download a new CSV (All) file using the same settings.
2. Replace team_20252026_regular_5v5_sva.csv with the new file.
3. Run: python3 scripts/update_tracker.py --refresh-nst-only

Source: https://www.naturalstattrick.com/teamtable.php
