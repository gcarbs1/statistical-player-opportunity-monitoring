# Statistical Player Opportunity Monitoring

## Summary

Collects round-level playing time from Transfermarkt for 16 domestic leagues between 2019 and 2026 and monitors competitive opportunity among players aged 16–23. The results are available in `index.html`:

- **Minutes.** One observation per player and match, normalized against every player observed in the same league round.
- **Opportunity signal.** Age-adjusted residuals accumulated with EWMA and CUSUM across each player's career.
- **Early watch.** A player's first and only watch begins when two observations in a rolling window of up to three eligible selection decisions have age-adjusted opportunity residuals of at least +0.75 and accumulated minutes are positive.
- **Explorer.** Ranking, trajectories, and watch events per player.

The EWMA and watch window remain continuous across club or league changes. Injured and absent states pause the monitor and are not converted into zero-minute decisions.

## Structure

- `notebooks/00-data_collection.ipynb`: collects teams, rosters, profiles, and match minutes, with HTTP cache and resumable checkpoints.
- `notebooks/01-data_processing.ipynb`: builds player–match and player–round observations and the round-level references.
- `notebooks/02-opportunity_signals.ipynb`: calculates the opportunity signal and early watches, exports the tables, the static figures, and the website dataset.
- `data/raw/`: source tables, HTTP cache, and collection checkpoints, excluded from version control.
- `data/processed/`: normalized observations, trajectories, and analytical outputs, excluded from version control.
- `index.html` and `assets/`: static website and the dataset it reads.
- `viz/`: static figures produced by notebook 02.

## Setup

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Run the notebooks in order, then serve the page locally:

```bash
python3 -m http.server 8000
```

## Outputs

| file | content |
| --- | --- |
| `data/raw/player_matches.parquet` | one player per match and row, with participation state and minutes |
| `data/raw/collection_runs.parquet` | one row per collection run, with selected players, refreshes, and errors |
| `data/processed/age_16_23_player_round.parquet` | player–round observations aged 16–23 |
| `data/processed/age_16_23_opportunity_signals.parquet` | round-level decisions with residuals and monitoring statistics |
| `data/processed/player_opportunity_summary.parquet` | one row per player, with ranking fields |
| `data/processed/opportunity_watch_events.parquet` | first career watch of each player |
| `assets/player_opportunity_explorer.json` | compact dataset read by `index.html` |
| `viz/` | watches by age, exposure until the watch, watches by position, and recurrence |
