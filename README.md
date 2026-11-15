# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Reki120/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Reki120/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot, ranks every protocol that records no token by what its launch would be worth, and hands in a dashboard with the board, a detail view per protocol and the concrete steps to farm each one.

The model, in one line: implied = TVL × categoryMultiple × growth × age × breadth × 0.80, where the category multiple is the median mcap/TVL of live tokens in the same category (else the global median), with each live ratio capped at the 90th percentile so one outlier cannot set a category — everything derived from the snapshot's own figures, no protocol name hardcoded, nothing fetched.

Eligibility follows the house's own pre-token test: of the 342 protocols that record no token, 198 pass (the 40 on the watchlist plus 158 early finds) and 144 are set aside with their reason — bridges, exchanges, liquid-staking and wrapped products of a token that already trades are not launches.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
