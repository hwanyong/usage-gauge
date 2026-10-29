# usage-gauge: Claude Code session and weekly usage-limit gauge

usage-gauge is a Claude Code plugin (a mod) that keeps your Claude subscription's rate-limit usage visible in the band directly above the prompt. It draws two gauges side by side: the **5-hour session window** and the **7-day weekly window**. Each one shows the percentage used, a pace target and the time until the window resets, so you can see whether you will run out before the reset without running `/usage`.

![Two usage-limit gauges above the Claude Code prompt. Left: "Session 5-hour window", 9% / 100% in green, "Resets in 18m · target 94%". Right: "Weekly 7-day window", 21% / 100% in yellow, "Resets in 6d 3h · target 12%". A white vertical marker on each bar shows the pace target.](docs/screenshot.png)

The screenshot shows both fill colors:

| Gauge | Usage | Target | Fill | Why |
|---|---|---|---|---|
| Session (5-hour window) | 9% | 94% | green (`success`) | Usage is under the target |
| Weekly (7-day window) | 21% | 12% | yellow (`warning`) | Usage is above the target |

## Features

- **Session and weekly usage side by side.** The 5-hour and 7-day rate-limit windows, as `percentUsed / 100%`.
- **Pace target.** A `│` marker on the bar and `target N%` below it: the share of the window that has already elapsed. Usage left of the marker is under pace.
- **Reset countdown.** `Resets in 6d 3h`, `Resets in 2h 15m` or `Resets in 18m`, counted from the window's `resetsAt`.
- **Color by pace.** Green at or under the target, yellow above it, red from 90%.
- **Shared across sessions.** Every open Claude Code session draws the newest reading any session has received.
- **No extra API requests.** The gauges use the values Claude Code already receives with each response.
- **`/usage-gauge refresh`.** Re-reads and prints the values on demand.

## Install

Requirements: Claude Code signed in with a Claude subscription. With an API key, Amazon Bedrock or Google Vertex AI there are no rate-limit windows to draw (see [Limitations](#limitations)).

### Terminal session

At the Claude Code prompt:

```
/plugin install usage-gauge --marketplace hwanyong/usage-gauge
```

### Shell

```
claude plugin install usage-gauge --marketplace hwanyong/usage-gauge
```

`--marketplace` adds the `hwanyong/usage-gauge` marketplace first if it is not added yet. To add the marketplace and install the plugin as two steps:

```
claude plugin marketplace add hwanyong/usage-gauge
claude plugin install usage-gauge@usage-gauge
```

Add `--scope project` to install it for the current project only. The default scope is `user`.

### Desktop app

Click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hwanyong/usage-gauge`, then **Add plugin**.

### Check, update, uninstall

```
claude plugin list
claude plugin update usage-gauge@usage-gauge
claude plugin uninstall usage-gauge@usage-gauge
```

`claude plugin update` applies after Claude Code restarts.

## Usage

The band appears by itself once any session has a reading. There is nothing to configure.

### Reading a gauge

| Element | Example | Meaning |
|---|---|---|
| Title | `Session 5-hour window` | Which rate-limit window the gauge shows |
| Usage | `9% / 100%` | `percentUsed` as the API reports it. The API reports a percentage only, so the maximum is always 100% |
| Bar | `█` used · `░` free · `│` target | Usage and the pace target on one scale |
| Reset | `Resets in 18m` | Time until `resetsAt` |
| Target | `target 94%` | `(window length - time until reset) / window length` |

| Fill color | Condition |
|---|---|
| green (`success`) | usage at or under the target |
| yellow (`warning`) | usage above the target |
| red (`error`) | usage at 90% or more |

When a window's `resetsAt` has passed and no session has read the new window yet, the gauge shows `-% / 100%` and `Reset · waiting for the next response`.

### Command

| Command | Output |
|---|---|
| `/usage-gauge refresh` | Reads the values again at once, merges them with the other sessions' readings and prints one line per window, for example `Session: 9% · Resets in 18m` |

It sends no API request: the values change only when some session receives a response. Before the first reading it prints `No rate-limit reading yet.`

## How it works

1. Each session reads the rate limits the API reported on its own last response: `$.session.usage()` at session start and every 60 seconds, and each `session.measure` event (each turn, and whenever a window moves a whole point).
2. The session merges its reading with the one in the plugin's store and writes the result back. For each window the newer reading wins: the one with the later `resetsAt`, or within one window the higher `percentUsed`.
3. Every session draws the merged reading in the `AbovePrompt` band. The reset countdown and the target are recomputed every 60 seconds.

## FAQ

### How do I see my Claude Code usage limits all the time?

Install usage-gauge. The built-in `/usage` command prints usage when you run it; usage-gauge keeps the session and weekly usage above the prompt for the whole session.

### What are the 5-hour session limit and the weekly limit?

They are the two rate-limit windows of a Claude subscription. Usage in the session window resets 5 hours after the window starts, and usage in the weekly window resets 7 days after it starts. For each window the API reports `percentUsed` and `resetsAt`, and usage-gauge draws both.

### What does "target" mean?

The target is the share of the window that has already elapsed. If your usage stays at or below the target, using Claude at the same rate reaches 100% no earlier than the reset. In the screenshot the weekly gauge is at 21% with 12% of the week gone, so usage is above the pace target.

### Does usage-gauge send API requests?

No. It reads the values that Claude Code already received with each response, and `/usage-gauge refresh` also sends no request.

### Why does the gauge show `-% / 100%`?

The window has reset and no session has received a response since. The gauge fills in again after the next response in any session.

### Why does the gauge not appear?

- You are signed in with an API key, Amazon Bedrock or Google Vertex AI, so `rateLimits` is empty.
- No session has a reading yet. The gauge appears after the first API response.
- A survey is shown above the prompt. The gauge returns when it closes.
- You are on a surface other than the terminal or the desktop app.

## Limitations

- Rate limits exist only on a Claude subscription. With an API key, Bedrock or Vertex, `rateLimits` is empty and the band is not drawn.
- The band appears once any session has a reading: at once when an earlier session stored one, otherwise after this session's first API response.
- Per-model weekly windows (such as the one `/usage` lists by model name) are not exposed to mods, so they are not shown.
- The band draws on the terminal and desktop surfaces only.

## License

[MIT](LICENSE)
