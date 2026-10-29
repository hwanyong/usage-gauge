import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-gauge', key: 'limits' } as const, [])
const now = atom({ plugin: 'usage-gauge', key: 'now' } as const, 0)

const HOUR = 3600 * 1000
const WINDOWS: Record<string, { label: string; span: string; ms: number }> = {
  five_hour: { label: 'Session', span: '5-hour window', ms: 5 * HOUR },
  seven_day: { label: 'Weekly', span: '7-day window', ms: 7 * 24 * HOUR },
}
const TICK_MS = 60 * 1000
const COMMAND = 'usage-gauge'
// The newest reading of every session, in this plugin's store, so each session draws the same values.
const STORE_KEY = 'limits'

const isLimit = (value: unknown): value is Limit => {
  if (typeof value != 'object' || value == null) return false
  const limit = value as Record<string, unknown>
  return typeof limit.kind == 'string' && typeof limit.percentUsed == 'number'
    && (limit.resetsAt == undefined || typeof limit.resetsAt == 'string')
}

// A new window starts at or after the old one resets, so readings of two windows lie a whole window apart.
const isSameWindow = (a: Limit, b: Limit) => {
  const window = WINDOWS[a.kind]
  if (!window || !a.resetsAt || !b.resetsAt) return a.resetsAt == b.resetsAt
  return Math.abs(Date.parse(a.resetsAt) - Date.parse(b.resetsAt)) < window.ms
}

// The newer of two readings of one kind: the later window, or within one window the higher use, as use only grows there.
const newer = (a: Limit, b: Limit) => {
  if (isSameWindow(a, b)) return b.percentUsed > a.percentUsed ? b : a
  return Date.parse(b.resetsAt ?? '') > Date.parse(a.resetsAt ?? '') ? b : a
}

const merge = (...readings: Limit[][]) => {
  const byKind = new Map<string, Limit>()
  for (const limit of readings.flat()) {
    const known = byKind.get(limit.kind)
    byKind.set(limit.kind, known ? newer(known, limit) : limit)
  }
  return [...byKind.values()]
}

// Merges this session's reading into the shared one and draws the result.
const sync = async ($: EngineInterface, own: Limit[]) => {
  const stored = await $.store.get(STORE_KEY)
  const shared = Array.isArray(stored) ? stored.filter(isLimit) : []
  const merged = merge(shared, own)
  if (JSON.stringify(merged) != JSON.stringify(shared)) await $.store.set(STORE_KEY, merged)
  await update($, limits, () => merged)
  const stamp = await $.clock.now()
  await update($, now, () => stamp)
  return merged
}

const isExpired = (limit: Limit, nowMs: number) =>
  limit.resetsAt != undefined && Date.parse(limit.resetsAt) <= nowMs

// Share of the window already elapsed, 0 to 100: the linear pace target.
const targetPercent = (limit: Limit, nowMs: number) => {
  const window = WINDOWS[limit.kind]
  if (!window || !limit.resetsAt) return undefined
  const left = Date.parse(limit.resetsAt) - nowMs
  return Math.min(100, Math.max(0, ((window.ms - left) / window.ms) * 100))
}

const resetsIn = (resetsAt: string | undefined, nowMs: number) => {
  if (!resetsAt) return ''
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - nowMs) / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `Resets in ${days}d ${hours}h`
  if (hours > 0) return `Resets in ${hours}h ${minutes % 60}m`
  return `Resets in ${minutes}m`
}

const usedColor = (used: number, target: number | undefined): Color => {
  if (used >= 90) return 'error'
  if (target != undefined && used > target) return 'warning'
  return 'success'
}

// Cells of the bar, consecutive cells of one kind merged into a run.
const barRuns = (width: number, used: number, target: number | undefined) => {
  const filled = Math.round((Math.min(used, 100) / 100) * width)
  const marker = target == undefined ? -1 : Math.min(width - 1, Math.floor((target / 100) * width))
  const runs: { kind: 'used' | 'free' | 'target'; text: string }[] = []
  for (let i = 0; i < width; i += 1) {
    const kind = i == marker ? 'target' : i < filled ? 'used' : 'free'
    const char = kind == 'target' ? '│' : kind == 'used' ? '█' : '░'
    const last = runs[runs.length - 1]
    if (last && last.kind == kind) last.text += char
    else runs.push({ kind, text: char })
  }
  return runs
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Re-read the rate-limit gauges above the prompt',
      argumentHint: 'refresh',
      immediate: true,
    })
    await sync($, (await $.session.usage()).rateLimits)
    $.clock.every(TICK_MS, async () => {
      await sync($, (await $.session.usage()).rateLimits)
    })
    return result
  })

  // Every measurement carries the whole reading; written each time so a state emptied since is filled again.
  on('session.measure', async ($, e, next) => {
    await sync($, e.rateLimits)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const args = e.args.trim()
    if (args != 'refresh') return { text: `Usage: /${COMMAND} refresh` }
    const merged = await sync($, (await $.session.usage()).rateLimits)
    const nowMs = await $.clock.now()
    const lines = merged.flatMap(limit => {
      const window = WINDOWS[limit.kind]
      if (!window) return []
      if (isExpired(limit, nowMs)) return [`${window.label}: reset, waiting for the next response`]
      return [`${window.label}: ${limit.percentUsed}% · ${resetsIn(limit.resetsAt, nowMs)}`]
    })
    if (lines.length == 0) return { text: 'No rate-limit reading yet.' }
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = (await read($, limits)).flatMap(limit => {
      const window = WINDOWS[limit.kind]
      return window ? [{ limit, window }] : []
    })
    if (e.props.hasSurvey || shown.length == 0) return next(e)

    const nowMs = (await read($, now)) || (await $.clock.now())
    const { Box, Text } = $.ui.resolve(e)
    const gap = 3
    const columnWidth = Math.floor((e.props.bodyColumns - gap * (shown.length - 1)) / shown.length)

    return (
      <Box flexDirection="row" columnGap={gap}>
        {shown.map(({ limit, window }) => {
          if (isExpired(limit, nowMs)) {
            return (
              <Box key={limit.kind} flexDirection="column" width={columnWidth}>
                <Box flexDirection="row" justifyContent="space-between">
                  <Text bold>{window.label} <Text dimColor>{window.span}</Text></Text>
                  <Text dimColor bold>-% / 100%</Text>
                </Box>
                <Text color="subtle">{'░'.repeat(columnWidth)}</Text>
                <Text dimColor>Reset · waiting for the next response</Text>
              </Box>
            )
          }
          const target = targetPercent(limit, nowMs)
          const color = usedColor(limit.percentUsed, target)
          const targetText = target == undefined ? '' : ` · target ${Math.round(target)}%`
          return (
            <Box key={limit.kind} flexDirection="column" width={columnWidth}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold>{window.label} <Text dimColor>{window.span}</Text></Text>
                <Text color={color} bold>{limit.percentUsed}% / 100%</Text>
              </Box>
              <Text>
                {barRuns(columnWidth, limit.percentUsed, target).map((run, index) => (
                  <Text
                    key={`${run.kind}-${index}`}
                    color={run.kind == 'used' ? color : run.kind == 'target' ? 'text' : 'subtle'}
                    bold={run.kind == 'target'}
                  >
                    {run.text}
                  </Text>
                ))}
              </Text>
              <Text dimColor>{resetsIn(limit.resetsAt, nowMs)}{targetText}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
