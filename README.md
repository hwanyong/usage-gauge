# usage-gauge

A Claude Code mod that draws your plan's rate-limit usage in the band directly above the prompt: the 5-hour session window and the 7-day weekly window, side by side.

![usage-gauge above the prompt](docs/screenshot.png)

Each gauge shows:

- **Current usage and maximum**: `percentUsed / 100%`, as the API reports it. The API reports a percentage only, so the maximum is always 100%.
- **Pace target**: the `│` marker and `target N%`, the share of the window that has already elapsed, `(window length - time until reset) / window length`. Usage left of the marker is under pace.
- **Reset time**: `Resets in …`, counted from the window's `resetsAt`.

The fill is `success` while usage is at or under the target, `warning` above it, and `error` from 90%.

Values come from `$.session.usage()` at session start and from `session.measure` events afterwards (each turn, and whenever a window moves a whole point). The reset countdown and the target are recomputed every 60 seconds.

## Install

At the prompt of a terminal session:

```
/plugin install usage-gauge --marketplace hwanyong/usage-gauge
```

From a shell:

```
claude plugin install usage-gauge --marketplace hwanyong/usage-gauge
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `hwanyong/usage-gauge`, then Add plugin.

## Limits

- Rate limits exist only on a Claude subscription. With an API key, Bedrock or Vertex, `rateLimits` is empty and the band is not drawn.
- The band appears after the session's first API response.
- Per-model weekly windows (such as the one `/usage` lists by model name) are not exposed to mods, so they are not shown.
- The band draws on the terminal and desktop surfaces only.

## License

MIT
