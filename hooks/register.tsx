import { atom, read, update } from 'claude-code'
import type { Color, Register } from 'claude-code'

import type { Limit } from '../types'

const limits = atom({ plugin: 'usage-gauge', key: 'limits' } as const, [])
const now = atom({ plugin: 'usage-gauge', key: 'now' } as const, 0)

const HOUR = 3600 * 1000
const WINDOWS: Record<string, { label: string; span: string; ms: number }> = {
  five_hour: { label: 'Session', span: '5-hour window', ms: 5 * HOUR },
  seven_day: { label: 'Weekly', span: '7-day window', ms: 7 * 24 * HOUR },
}
const TICK_MS = 60 * 1000

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
    const usage = await $.session.usage()
    await update($, limits, () => usage.rateLimits)
    const stamp = await $.clock.now()
    await update($, now, () => stamp)
    $.clock.every(TICK_MS, async () => {
      const tick = await $.clock.now()
      await update($, now, () => tick)
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limits, () => e.rateLimits)
    return next(e)
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
