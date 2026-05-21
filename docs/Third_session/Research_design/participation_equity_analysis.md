# CaNaMED — Offline participation-equity analysis note

**Companion to** `study_protocol_SAP.md` (this is the §6.2 secondary outcome #4,
*participation equity*). **Status:** exploratory / secondary outcome.
**Computed OFFLINE** from the exported per-room event log — **never** shown to a
student mid-session.

---

## 1. Why offline, and why not the live dot

The live UI shows a **deliberately non-numeric** participation indicator
(`renderContrib()`): one filled dot per name once that person has done *anything*
(revealed a finding **or** written an answer). This is a **no-shame UX choice**, by
design — a visible per-person count would invite shame and keyboard-grabbing in a
"room of equals." That dot is a good **facilitator nudge** but a **weak research
instrument**: it is binary (acted / not), conflates reveals with answers, ignores
volume and timing, and is computed from transient room state.

The **research** measure is therefore built **offline, from durable data**, after
the session — putting no number on anyone's face during the workshop.

---

## 2. Data source & unit of contribution

**Source.** The append-only per-room event log (`rooms/{room}/events`,
`{kind, by, at, payload}` written by `logEvent()`), plus the `cid`-tagged group
answers / hypotheses. Each contribution carries a **`stableId`** so it is
person-attributable and survives a refresh / new tab (see SAP §9).

**Unit of contribution (pre-specified — reviewers will ask).**

> A *contribution* = one authored answer/hypothesis entry **OR** one revealed
> finding **OR** one committed decision vote, attributed to a single `stableId`.

We count contributions **per `stableId` per room**, deduplicating identical
re-saves of the same artefact.

**What it does NOT capture (limitations, stated up front):**
- **Spoken** participation — the Module B roleplay is verbal; the platform sees
  only **typed / clicked** acts. This is *platform-mediated* participation, not
  total participation. Triangulate with transcripts (SAP §11).
- **Quality** vs **quantity** of contribution.
- **Facilitator prompting** that elicited a contribution.

---

## 3. Metric choice: prefer entropy / top-share over Gini at n ≤ 4

Rooms are typically **3–4 students**. The **Gini coefficient is noisy and biased
upward at this size**: with only 3–4 contributors the set of attainable Gini
values is **coarse and discrete**, so small count changes produce large,
artefactual Gini jumps, and the metric is hard to interpret. We therefore
**prefer**, in order:

1. **Normalised Shannon entropy** of the contribution distribution — `1.0` =
   perfectly even participation, `0` = one person did everything. Bounded [0, 1]
   and stable at small n.
2. **Top-contributor share** — the fraction of all room contributions made by the
   single busiest member. High = dominated room.
3. **Silent-member count / share** — how many of the *k* members contributed
   **zero** (the most interpretable equity signal at n = 4).

Gini **may** be reported **alongside** these and **always with room size k**, but
it is **not** the headline metric at n ≤ 4.

### Formulae

For a room with members \(i = 1..k\) and contribution counts \(c_i\), total
\(N = \sum_i c_i\), shares \(p_i = c_i / N\):

- **Normalised Shannon entropy**
  \[
  H_{\text{norm}} = \frac{-\sum_{i=1}^{k} p_i \log p_i}{\log k}
  \quad(\text{define } 0\log 0 = 0;\ H_{\text{norm}} = 1 \text{ if even, } \to 0 \text{ if one dominates})
  \]
- **Top-contributor share** \( \displaystyle S_{\max} = \frac{\max_i c_i}{N} \)
- **Silent share** \( \displaystyle S_0 = \frac{|\{ i : c_i = 0 \}|}{k} \)

Members with **zero** contributions are kept in the denominator \(k\) (they are
the point of the equity measure); they contribute \(0\log 0 = 0\) to the entropy
numerator.

---

## 4. Worked tiny example

A room of **k = 4** students. Contribution counts:

| stableId | contributions \(c_i\) |
|---|---|
| s_A | 5 |
| s_B | 3 |
| s_C | 2 |
| s_D | 0 |

\(N = 10\); shares \(p = (0.5, 0.3, 0.2, 0)\).

- **Entropy numerator** \(= -(0.5\ln 0.5 + 0.3\ln 0.3 + 0.2\ln 0.2 + 0)\)
  \(= -(-0.3466 - 0.3612 - 0.3219) = 1.0297\) nats.
- \(\log k = \ln 4 = 1.3863\).
- **\(H_{\text{norm}} = 1.0297 / 1.3863 \approx 0.743\).**
- **Top share \(S_{\max} = 5/10 = 0.50\).**
- **Silent share \(S_0 = 1/4 = 0.25\)** (one of four said nothing on-platform).

**Read-out:** moderately even (0.74), one member dominates half the typed
contributions, and one member was silent on-platform — flag s_D for the
facilitator/transcript triangulation. (A Gini here would be ~0.35 but, at k = 4,
swings sharply if a single count moves — hence we lead with entropy + shares.)

---

## 5. Reproducible R sketch (from the exported JSON)

Computed **after** the session from the raw events export — never from a
UI-rounded number. Pin `scenarioId` / schema version so the room set matches.

```r
library(jsonlite)

# raw export: rooms/{room}/events  +  cid-tagged answers, each carrying stableId
ev <- fromJSON("export/events.json", simplifyDataFrame = TRUE)

# 1. Keep only the pre-specified contribution kinds (SAP §2 definition)
contrib_kinds <- c("answer", "hypothesis", "reveal", "vote")
ev <- subset(ev, kind %in% contrib_kinds & !is.na(stableId))

# 2. De-duplicate identical re-saves of the same artefact
ev <- ev[!duplicated(ev[, c("room", "stableId", "kind", "artefactId")]), ]

# 3. Per-room, per-person contribution counts
#    roster = every stableId who JOINED the room (so silent members appear as 0)
counts_by_room <- function(room_id, roster) {
  c_i <- table(factor(ev$stableId[ev$room == room_id], levels = roster))
  as.integer(c_i)                       # includes zeros for silent members
}

norm_entropy <- function(c_i) {
  k <- length(c_i); N <- sum(c_i)
  if (N == 0 || k <= 1) return(NA_real_)
  p  <- c_i / N
  pl <- ifelse(p > 0, p * log(p), 0)    # 0*log0 := 0
  (-sum(pl)) / log(k)
}
top_share    <- function(c_i) if (sum(c_i) == 0) NA_real_ else max(c_i) / sum(c_i)
silent_share <- function(c_i) mean(c_i == 0)

# 4. One equity row per room (report WITH room size k)
equity <- do.call(rbind, lapply(rooms, function(r) {
  c_i <- counts_by_room(r$id, r$roster)
  data.frame(room = r$id, k = length(c_i), N = sum(c_i),
             H_norm     = norm_entropy(c_i),
             top_share  = top_share(c_i),
             silent_share = silent_share(c_i))
}))
print(equity)   # entropy + shares lead; Gini (if reported) is secondary
```

---

## 6. Reporting

- **Secondary / exploratory** outcome (SAP §6.2 #4, §8.4) — descriptive, with
  room size k always shown; no confirmatory inference.
- Report `H_norm`, `top_share`, `silent_share` **per room**, summarised across
  rooms (median + range), and **stratified by site** (Caen / Nagoya) as an
  exploratory contrast.
- State the §2 limitations (typed/clicked acts only; quality not captured;
  facilitator effects) every time the metric is reported.
- Triangulate silent / dominant members against the transcript coding (SAP §11)
  before drawing any conclusion about an individual.
