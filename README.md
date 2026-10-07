# Claude Code Statusline

A custom statusline script for [Claude Code](https://claude.ai/code) that shows model info, context usage, cost, rate limits, and git branch — all color-coded directly in your terminal.

![screenshot](screenshot.png)

---

## What It Shows

**Line 1 — Session info**
- Active model name (e.g. `claude-opus-4-6`)
- Claude Code version (e.g. `v2.1.90`)
- Current working directory
- Current git branch (if inside a git repo), with `*` when there are uncommitted changes

**Line 2 — Usage**
- Context window progress bar (green → yellow → red as it fills)
- Context used percentage
- Total session cost in USD
- Elapsed session time
- Number of running agents (`◇ 2 agents`) — only shown when the [model-picker mod](#optional-model-picker-mod) is loaded

**Line 3 — Rate limits** *(only shown when data is available)*
- 5-hour rate limit bar + percentage + time until reset
- 7-day rate limit bar + percentage + time until reset

---

## Install

### 1. Copy the script

```bash
curl -o ~/.claude/statusline-command.sh \
  https://raw.githubusercontent.com/AliT-Hammoud/claude-statusline/main/statusline-command.sh

chmod +x ~/.claude/statusline-command.sh
```

Or clone the repo and copy manually:

```bash
git clone https://github.com/AliT-Hammoud/claude-statusline.git
cp claude-statusline/statusline-command.sh ~/.claude/statusline-command.sh
chmod +x ~/.claude/statusline-command.sh
```

### 2. Update `~/.claude/settings.json`

Add or update the `statusLine` key:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash /Users/YOUR_USERNAME/.claude/statusline-command.sh"
  }
}
```

Replace `YOUR_USERNAME` with your macOS username (run `whoami` to check).

### 3. Restart Claude Code

The statusline will appear at the bottom of your Claude Code session.

---

## Optional: model-picker mod

`plugin/model-picker` is a Claude Code mod (a plugin of function hooks) that adds what a status line script can't draw: things you click.

- **`◆ Model & Effort ▾`** — a button at the right end of the footer. It opens a panel above the prompt where you click a model (Haiku / Sonnet / Opus / Fable) or an effort level (Low → Max). A click runs `/model` or `/effort` for you. `/mp` toggles the same panel.
- **`● Progress`** — a button beside it that shows or hides the progress box.
- **Progress box** — while a prompt runs: its title, a live timer, `Step 2 of 4`, a progress bar, and one row per step (`Working` / `Next` / `Done`). It turns green with `✔ All done · took 1m 47s` when the turn ends. Steps come from the model's task list; with no task list, each tool call is a step.
- **Agent count** — every 3 seconds it writes the number of running agents to `~/.claude/statusline-agents/<session id>`, which the status line script reads for the `◇ N agents` segment.

Load it for one session:

```bash
git clone https://github.com/AliT-Hammoud/claude-statusline.git
claude --plugin-dir claude-statusline/plugin/model-picker
```

The status line script works without the mod; the agent segment just stays hidden.

---

## Requirements

- macOS (uses `date +%s` for countdown timers)
- `jq` installed — `brew install jq`
- Claude Code CLI

---

## Customization

The script uses standard ANSI colors. You can adjust thresholds in the `rate_color()` and context bar logic:

```bash
# Change warning threshold from 70% to 60%:
elif [ "$val" -ge 60 ]; then echo "$YELLOW"
```
