# Token Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/nisarena2/token-radar-v4/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/nisarena2/token-radar-v4/reward.svg)](https://make.fun/bounty/token-radar-01)

A token-launch radar: it reads a frozen DefiLlama snapshot, works out which
protocols that record no token would be worth farming next, and writes a
dashboard that ranks them by what a launch would be worth.

## How the value is worked out

The implied value follows a size curve fitted on this snapshot's own traded
protocols: `log10(market cap) = A + B * log10(TVL)`, fitted by ordinary least
squares on the traded comps that carry a listing date. Value grows
sub-linearly with size, so one flat multiple of TVL is not used. Each
category's mean log-residual from the curve is shrunk toward zero with
4 pseudo-comps (categories with fewer than 2 traded comps get no effect).
The value is then tilted by growth (`1 + 0.5 * 7-day TVL change`, clamped
0.60–1.60) and by breadth (+3% per extra chain, at most 4).

An age factor was tested on the time split and dropped: it did not improve
out-of-sample misses, so age is shown (days with no token) but never priced.

Every implied value is a band, not a point: P25–P75 of the leave-one-out
residuals. Farm verdicts are netted to dollars on a $1,000 plan — the $1,000
slice is your share of TVL times the implied value times the community's
10% share of a launch, minus $3 gas per chain the plan actually farms
(the main chain and one more, at most 2), 0.3% protocol fees, and 4% a year
of forgone T-bill yield over a 90-day farm. FARM clears $10 net and $5 per
hands-on hour; THIN clears $0; the rest is SKIP.

## Out-of-sample checks (computed live from the snapshot, printed on run)

- Leave-one-out: the curve is refit without each traded comp in turn.
- Time split: fitted on listings before 2024, tested on listings from 2024.
- Both are reported against one flat median multiple on the same comps.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Node 22 or later, standard library only. The program writes `board.json`,
`dashboard/data.js`, copies `dashboard/` and `screenshots/` to the output
directory, and writes `dossier.json` with `buildDossier` from
`vendor/makefun-board.ts`. Run it twice and the outputs are byte-identical.

## Files

- `main.ts` — the program: fit, validation, board, farm economics, outputs.
- `vendor/makefun-board.ts` — the kit's dossier library, shipped byte for byte.
- `dashboard/` — `index.html`, `app.css`, `app.js` (the page; `data.js` is
  written beside them on every run). No network: the page renders offline.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
