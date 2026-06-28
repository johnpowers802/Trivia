# RISK — World Domination

A modern, self-contained web version of the classic board game **Risk**. Inspired by
the (archived, 2015) [RISK-game](https://github.com/RISK-game) org — rebuilt as a single
no-build browser app instead of three separate repos.

## Play

No build step, no dependencies. Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 4317
# then visit http://localhost:4317
```

Pick 2–6 total players and how many are human (the rest are AI), then **Begin campaign**.

## Rules implemented

- **Full classic map** — 42 territories across 6 continents with authentic adjacencies,
  including the Alaska↔Kamchatka and Brazil↔North Africa sea links.
- **Reinforcements** — `max(3, ⌊territories / 3⌋)` plus continent-control bonuses
  (N. America 5, S. America 2, Europe 5, Africa 3, Asia 7, Australia 2).
- **Three phases per turn** — Reinforce → Attack → Fortify.
- **Dice combat** — attacker rolls up to 3, defender up to 2; highest dice compared,
  ties go to the defender.
- **Conquest** — capturing a territory prompts how many armies to advance (≥ dice rolled).
- **Fortify** — one move per turn between any two connected friendly territories.
- **Elimination & victory** — players knocked out when they lose all land; win by
  conquering all 42 territories.
- **AI opponents** — reinforce the front, press favorable attacks, feed the border on fortify.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup + layout shell |
| `styles.css` | All styling |
| `data.js`    | Continents, territories, adjacency, map positions |
| `game.js`    | Rules engine + game state (no DOM) |
| `ai.js`      | Computer-player strategy |
| `ui.js`      | SVG map rendering, interaction, turn/AI driver |

## Deploy

It's static — drop the folder on any host. For Vercel: `vercel` from this directory
(no config needed).
