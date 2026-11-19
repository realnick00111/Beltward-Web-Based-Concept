# Turn Factory

> **This is a demo.** It's a small prototype showing a turn-based factory game idea. It isn't a finished game. Expect rough edges, simple graphics, and limited content and balance.

A 2D factory-builder in the browser where **the factory runs in turns but you don't**. Miners, conveyor belts and machines advance one step each turn. Building, removing and rotating are instant and free, so you can plan as long as you like between turns.

## Running it

The game is plain HTML, CSS and JavaScript with no build step or dependencies. It has to be served from a local web server, because opening `index.html` straight from disk may not load the scripts.

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

## How to play

- **Goal:** keep expanding. There are no time limits or deadlines.
- **Turns:** press **Next Turn** (Space), or switch on **Auto** (P) and pick a speed. You can keep building while Auto runs.
- **Making things:** put miners on ore, belt the ore into furnaces to make plates, and feed plates into assemblers to make gears or circuits. Deliver items to the **HQ** or a **Depot** to add them to your inventory.
- **Expanding:** the map is a 5×5 grid of regions. Click a locked region next to your territory to see its cost, then spend delivered items to unlock it. Regions farther out cost more advanced items and have more ore.

| Building  | What it does                              | Cost                        |
|-----------|-------------------------------------------|-----------------------------|
| Conveyor  | Moves 1 item one tile per turn            | 1 iron plate                |
| Miner     | Place on ore, makes 1 ore per turn        | 5 iron plates               |
| Furnace   | Ore → plate, takes 2 turns                | 6 iron plates               |
| Assembler | Plates → gear or circuit (click to switch)| 10 iron + 4 copper plates   |
| Depot     | Extra drop-off point, like the HQ         | 8 iron plates               |

Removing a building gives back its full cost.

## Controls

| Input                          | Action                          |
|--------------------------------|---------------------------------|
| Left-click / drag              | Place (dragging belts follows your path) |
| Right-click / drag             | Remove                          |
| 1–5                            | Choose a building               |
| Q / Esc                        | Select tool (inspect, change recipe) |
| X                              | Remove tool                     |
| R / Shift+R                    | Rotate                          |
| Space                          | Next turn                       |
| P                              | Toggle auto-run                 |
| WASD / arrows, middle- or Shift-drag | Pan                       |
| Mouse wheel                    | Zoom                            |
| H                              | Jump to HQ                      |

## Saving

Progress saves automatically to the browser's local storage after every change and whenever you leave or hide the page. **New game** in the sidebar wipes it.

## Files

- `index.html`: page layout and sidebar
- `style.css`: styling
- `game.js`: map generation, turn simulation, rendering, input and saving
