import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pick, Run, Step } from '../types'

const MODELS = [
  { id: 'haiku', label: 'Haiku 4.5' },
  { id: 'sonnet', label: 'Sonnet 5.5' },
  { id: 'opus', label: 'Opus 5.5' },
  { id: 'fable', label: 'Fable 5.1' },
] as const
const EFFORTS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
  { id: 'max', label: 'Max' },
] as const

const ORANGE = '#d97757'
const PURPLE = '#a371a8'

const pick = atom({ plugin: 'model-picker', key: 'pick' } as const, {
  model: null,
  effort: null,
  isOpen: false,
} as Pick)

const run = atom({ plugin: 'model-picker', key: 'run' } as const, null as Run | null)

const PINK = '#e8588a'
const GREEN = '#4caf6a'

function span(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))

  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

function bar(done: number, total: number, width: number) {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function basename(path: unknown) {
  return String(path ?? '').split('/').pop() ?? ''
}

// A tool call in plain words, for a turn that wrote no task list.
function describe(tool: string, input: Record<string, unknown>) {
  if (typeof input.description === 'string' && input.description) return input.description
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write') return `${tool} ${basename(input.file_path)}`
  if (tool === 'Bash') return String(input.command ?? 'Run a command').slice(0, 48)

  return tool
}

function patch($: EngineInterface, change: (now: Run) => Run) {
  return update($, run, now => (now === null ? now : change(now)))
}

async function tick($: EngineInterface) {
  const now = await $.clock.now()
  await patch($, r => (r.endedAt === null ? { ...r, now } : r))
}

// Where the status line script reads the running-agent count, one file a session.

async function countAgents($: EngineInterface) {
  const agents = await $.agent.list()

  return agents.filter(a => a.status === 'pending' || a.status === 'running' || a.status === 'waiting').length
}

async function toggleProgress($: EngineInterface) {
  await update($, pick, p => ({ ...p, isProgressOff: !p.isProgressOff }))
  await update($, run, r => (r === null ? r : { ...r, isHidden: false }))
}

function toggle($: EngineInterface) {
  return update($, pick, p => ({ ...p, isOpen: !p.isOpen }))
}

// What /config holds now, so the panel opens on the real model and effort.
async function seed($: EngineInterface) {
  const rows = await $.config.list()
  const valueOf = (name: RegExp) => String(rows.find(row => name.test(row.key))?.value ?? '').toLowerCase()
  const model = MODELS.find(m => valueOf(/^model$/i).includes(m.id))?.id
  const effort = EFFORTS.find(x => valueOf(/effort/i) === x.id)?.id
  await update($, pick, p => ({ ...p, model: p.model ?? model ?? null, effort: p.effort ?? effort ?? null }))
}

export const register: Register = on => {
  let published = -1
  let watching: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    watching?.cancel()
    watching = $.clock.every(3000, async () => {
      const count = await countAgents($)
      if (count !== published) {
        published = count
        await $.fs.write(`${await $.env.get('HOME')}/.claude/statusline-agents/${await $.session.id()}`, String(count))
      }
    })
    await $.command.register({ name: 'mp', description: 'Show or hide the model and effort panel' })
    await seed($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'mp' }, async $ => {
    await toggle($)

    return {}
  })

  let ticking: { cancel: () => void } | undefined

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (text && !text.startsWith('/')) {
      const now = await $.clock.now()
      const line = text.split('\n')[0] ?? ''
      const title = line.length > 60 ? `${line.slice(0, 60)}…` : line
      await update($, run, () => ({ title, startedAt: now, now, endedAt: null, steps: [], isPlanned: false, isHidden: false }))
      ticking?.cancel()
      ticking = $.clock.every(1000, () => void tick($))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    ticking?.cancel()
    ticking = undefined
    const now = await $.clock.now()
    await patch($, r => ({
      ...r,
      now,
      endedAt: r.endedAt ?? now,
      steps: r.steps.map(step => (step.status === 'running' ? { ...step, status: 'done' as const } : step)),
    }))

    return next(e)
  })

  // The model's own task list is the plan, when it writes one.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const steps: Step[] = e.todos.map((todo, i) => ({
      id: String(i),
      label: todo.content,
      status: todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'running' : 'pending',
    }))
    await patch($, r => ({ ...r, steps, isPlanned: true }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
    if (id !== undefined) {
      const step: Step = { id, label: e.subject, status: 'pending' }
      await patch($, r => ({ ...r, steps: [...(r.isPlanned ? r.steps : []), step], isPlanned: true }))
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const status = e.status === 'completed' ? 'done' : e.status === 'in_progress' ? 'running' : e.status === 'pending' ? 'pending' : undefined
    await patch($, r => ({
      ...r,
      steps: r.steps
        .filter(step => !(step.id === e.taskId && e.status === 'deleted'))
        .map(step => (step.id === e.taskId ? { ...step, label: e.subject ?? step.label, status: status ?? step.status } : step)),
    }))

    return next(e)
  }).catch(($, e, next) => next(e))

  // With no task list, every tool call is a step.
  on('tool.call', async ($, e, next) => {
    const now = await read($, run)
    const isPlanTool = e.tool === 'TodoWrite' || e.tool === 'TaskCreate' || e.tool === 'TaskUpdate'
    if (now === null || now.endedAt !== null || now.isPlanned || isPlanTool) {
      return next(e)
    }

    const id = e.tool_use_id
    const step: Step = { id, label: describe(e.tool, e as unknown as Record<string, unknown>), status: 'running' }
    await patch($, r => ({ ...r, steps: [...r.steps, step].slice(-50) }))
    const ran = await next(e)
    await patch($, r => ({ ...r, steps: r.steps.map(one => (one.id === id ? { ...one, status: 'done' as const } : one)) }))

    return ran
  }).catch(($, e, next) => next(e))

  // Keep the panel in sync when /model or /effort is typed by hand too.
  on('command.run', async ($, e, next) => {
    const ran = await next(e)
    const value = e.args.trim().split(/\s+/)[0]?.toLowerCase()
    if ((e.command === 'model' || e.command === 'effort') && value) {
      await update($, pick, p => ({ ...p, [e.command]: value }))
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The footer's right end, on the status line's row: the button that opens the panel.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { isOpen, isProgressOff } = await read($, pick)

    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} </Text>}
        <Box backgroundColor={ORANGE}>
          <Button key="toggle" plain label={` ◆ Model & Effort ${isOpen ? '▴' : '▾'} `} onPress={() => toggle($)} />
        </Box>
        <Text> </Text>
        <Box backgroundColor={isProgressOff ? undefined : GREEN}>
          <Button
            key="progress"
            plain
            dimColor={isProgressOff === true}
            label={` ${isProgressOff ? '○' : '●'} Progress `}
            onPress={() => toggleProgress($)}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, pick)
    const turn = await read($, run)
    const hasTurn = turn !== null && !turn.isHidden && !state.isProgressOff
    if (e.props.hasSurvey || (!state.isOpen && !hasTurn)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const model = MODELS.find(m => m.id === state.model)
    const effort = EFFORTS.find(x => x.id === state.effort)

    const choose = async (command: 'model' | 'effort', value: string) => {
      const { text } = await $.command.run({ command, args: value })
      $.ui.toast(text ?? `${command} → ${value}`)
    }

    const card = () => {
      if (turn === null || !hasTurn) return null

      const isDone = turn.endedAt !== null
      const total = turn.steps.length
      const done = turn.steps.filter(step => step.status === 'done').length
      const percent = isDone ? 100 : total === 0 ? 0 : Math.round((done / total) * 100)
      const tint = isDone ? GREEN : PINK
      const room = Math.max(1, Math.min(6, e.props.maxRows - (state.isOpen ? 11 : 5)))
      const current = turn.steps.findIndex(step => step.status !== 'done')
      const from = isDone || current < 0 ? Math.max(0, total - room) : Math.max(0, Math.min(current - 1, total - room))
      const shown = turn.steps.slice(from, from + room)

      return (
        <Box flexDirection="column" borderStyle="round" borderColor={tint} paddingX={1}>
          <Box justifyContent="space-between">
            <Box columnGap={1}>
              {isDone ? <Text backgroundColor={GREEN} color="#000000" bold> ✔ All done </Text> : <Text color={PINK}>✶</Text>}
              <Text bold color={isDone ? GREEN : undefined}>{turn.title}</Text>
            </Box>
            <Box columnGap={1}>
              <Text dimColor>{isDone ? `took ${span((turn.endedAt ?? turn.now) - turn.startedAt)}` : span(turn.now - turn.startedAt)}</Text>
              {isDone && <Button key="hide" plain dimColor label="✕" onPress={() => patch($, r => ({ ...r, isHidden: true }))} />}
            </Box>
          </Box>
          <Box justifyContent="space-between">
            <Text dimColor>
              {total === 0 ? 'Thinking…' : isDone ? `${done} of ${total} steps` : `Step ${Math.min(done + 1, total)} of ${total}`}
            </Text>
            <Box columnGap={1}>
              <Text color={tint}>{bar(isDone ? 1 : done, isDone ? 1 : total, 24)}</Text>
              <Text color={tint} bold>{percent}%</Text>
            </Box>
          </Box>
          {shown.map(step => (
            <Box key={`step-${step.id}`} columnGap={2}>
              <Box width={46}>
                <Text color={step.status === 'done' ? GREEN : step.status === 'running' ? PINK : undefined} dimColor={step.status === 'pending'} wrap="truncate-end">
                  {step.status === 'done' ? '✔' : step.status === 'running' ? '●' : '○'} {step.label}
                </Text>
              </Box>
              <Text color={step.status === 'done' ? GREEN : PINK} dimColor={step.status === 'pending'}>
                {bar(step.status === 'done' ? 1 : step.status === 'running' ? 0.5 : 0, 1, 12)}
              </Text>
              <Text color={step.status === 'done' ? GREEN : step.status === 'running' ? PINK : undefined} dimColor={step.status === 'pending'} bold={step.status === 'running'}>
                {step.status === 'done' ? 'Done' : step.status === 'running' ? 'Working' : 'Next'}
              </Text>
            </Box>
          ))}
          {total > shown.length && <Text dimColor>  … {total - shown.length} more</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {state.isOpen && (
          <Box justifyContent="flex-end">
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} minWidth={62}>
              <Box justifyContent="space-between">
                <Text color={ORANGE} bold>◆ M O D E L   &   E F F O R T</Text>
                <Text dimColor>{[model?.label, effort?.label].filter(Boolean).join(' · ')}</Text>
              </Box>
              <Text> </Text>
              <Box columnGap={1}>
                <Text dimColor>MODEL   </Text>
                {MODELS.map(m => (
                  <Box key={`m-${m.id}`} backgroundColor={m.id === state.model ? ORANGE : undefined}>
                    <Button key={`model-${m.id}`} plain label={` ${m.label} `} onPress={() => choose('model', m.id)} />
                  </Box>
                ))}
              </Box>
              <Box columnGap={1}>
                <Text dimColor>EFFORT  </Text>
                {EFFORTS.map(x => (
                  <Box key={`e-${x.id}`} backgroundColor={x.id === state.effort ? PURPLE : undefined}>
                    <Button key={`effort-${x.id}`} plain label={` ${x.label} `} onPress={() => choose('effort', x.id)} />
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}
        {card()}
      </Box>
    )
  })
}
