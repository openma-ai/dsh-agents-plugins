import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { defineTool, type ToolRestriction } from '@deepseek-ai/dsh-tools'
import { parse } from 'yaml'
import { boundedName } from './adapters/utils.js'

export interface Config {
  readonly pluginName: string
  readonly pluginRoot: string
  readonly componentPath: string
  readonly provider: string
}

export interface ClaudeAgentDefinition {
  readonly source: string
  readonly name: string
  readonly description: string
  readonly persona: string
  readonly toolName: string
  readonly toolFilter?: ToolRestriction
}

export interface ClaudeAgentInspection {
  readonly agents: readonly ClaudeAgentDefinition[]
  readonly diagnostics: readonly string[]
}

const CLAUDE_TOOL_TO_DSH: Readonly<Record<string, string>> = {
  Bash: 'bash',
  BashOutput: 'job_output',
  Edit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  KillShell: 'job_kill',
  Read: 'read',
  Skill: 'skill',
  Task: 'subagent',
  TaskOutput: 'job_output',
  TodoWrite: 'todo_write',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Write: 'write',
}

const SUPPORTED_FIELDS = new Set(['name', 'description', 'tools', 'model'])

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

function posix(path: string): string {
  return path.split(sep).join('/')
}

function markdownFiles(root: string, target: string): string[] {
  const realTarget = realpathSync(target)
  if (!contained(root, realTarget)) throw new TypeError(`Claude agents component resolves outside plugin root: ${target}`)
  const stats = statSync(realTarget)
  if (stats.isFile()) return extname(realTarget).toLowerCase() === '.md' ? [realTarget] : []
  if (!stats.isDirectory()) return []
  const files: string[] = []
  for (const entry of readdirSync(realTarget, { withFileTypes: true })) {
    const path = resolve(realTarget, entry.name)
    const real = realpathSync(path)
    if (!contained(root, real)) throw new TypeError(`Claude agents entry resolves outside plugin root: ${path}`)
    if (entry.isDirectory()) files.push(...markdownFiles(root, real))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(real)
  }
  return files.sort()
}

function frontmatter(markdown: string): { readonly attributes: Readonly<Record<string, unknown>>; readonly body: string } {
  const normalized = markdown.replace(/\r\n/gu, '\n')
  if (!normalized.startsWith('---\n')) throw new TypeError('missing YAML frontmatter')
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw new TypeError('unterminated YAML frontmatter')
  const value: unknown = parse(normalized.slice(4, end))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('YAML frontmatter must be an object')
  }
  return {
    attributes: value as Readonly<Record<string, unknown>>,
    body: normalized.slice(end + 5).trim(),
  }
}

function requiredString(attributes: Readonly<Record<string, unknown>>, field: string): string {
  const value = attributes[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function declaredTools(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') {
    const names = value.split(',').map(name => name.trim()).filter(Boolean)
    if (names.length === 0) throw new TypeError('tools must name at least one Claude tool')
    return names
  }
  if (Array.isArray(value) && value.length > 0 && value.every(name => typeof name === 'string' && name.trim().length > 0)) {
    return value.map(name => (name as string).trim())
  }
  throw new TypeError('tools must be a comma-separated string or a non-empty string array')
}

function inspectFile(
  config: Config,
  root: string,
  file: string,
  diagnostics: string[],
): ClaudeAgentDefinition | undefined {
  const source = posix(relative(root, file))
  const label = `${config.pluginName}: ${source}`
  let parsed: ReturnType<typeof frontmatter>
  try {
    parsed = frontmatter(readFileSync(file, 'utf8'))
  } catch (error: unknown) {
    diagnostics.push(`${label} is not importable: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }

  let agentName: string
  let description: string
  let tools: readonly string[] | undefined
  try {
    agentName = requiredString(parsed.attributes, 'name')
    description = requiredString(parsed.attributes, 'description')
    tools = declaredTools(parsed.attributes.tools)
    if (parsed.body.length === 0) throw new TypeError('agent body must be non-empty')
  } catch (error: unknown) {
    diagnostics.push(`${label} is not importable: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }

  for (const field of Object.keys(parsed.attributes).filter(field => !SUPPORTED_FIELDS.has(field)).sort()) {
    diagnostics.push(`${label} declares Claude field ${JSON.stringify(field)}, which has no DSH imported-agent mapping and was ignored`)
  }
  const model = parsed.attributes.model
  if (model !== undefined && model !== 'inherit') {
    diagnostics.push(
      `${label} declares Claude model ${JSON.stringify(model)}, which has no exact DSH per-child model mapping; `
      + 'the DSH spawn provider model remains authoritative',
    )
  }

  const allow: string[] = []
  for (const claudeTool of tools ?? []) {
    const dshTool = CLAUDE_TOOL_TO_DSH[claudeTool]
    if (dshTool === undefined) {
      diagnostics.push(
        `${label} declares Claude tool ${JSON.stringify(claudeTool)}, which has no exact DSH tool mapping and was omitted from the child allow-list`,
      )
      continue
    }
    if (!allow.includes(dshTool)) allow.push(dshTool)
  }

  return {
    source,
    name: agentName,
    description,
    persona: parsed.body,
    toolName: boundedName(`agent-${config.pluginName}-${agentName}`, 64),
    ...tools === undefined ? {} : { toolFilter: { allow } },
  }
}

/** Inspect an explicitly imported Claude agents component without activating any capability. */
export function inspectClaudeAgents(config: Config): ClaudeAgentInspection {
  const root = realpathSync(config.pluginRoot)
  const component = resolve(root, config.componentPath)
  if (!contained(root, component)) throw new TypeError('Claude agents component escapes plugin root')
  const diagnostics: string[] = []
  const agents: ClaudeAgentDefinition[] = []
  const names = new Set<string>()
  for (const file of markdownFiles(root, component)) {
    const agent = inspectFile(config, root, file, diagnostics)
    if (agent === undefined) continue
    if (names.has(agent.toolName)) {
      diagnostics.push(`${config.pluginName}: ${agent.source} maps to duplicate DSH tool ${JSON.stringify(agent.toolName)} and was not imported`)
      continue
    }
    names.add(agent.toolName)
    agents.push(agent)
  }
  return { agents, diagnostics }
}

function outputText(output: readonly ContentBlock[]): string {
  return output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function abnormalResult(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed': return undefined
    case 'aborted': return 'Claude agent run was cancelled'
    case 'error': return 'Claude agent run failed'
    case 'max-tokens': return 'Claude agent run hit its token limit before finishing'
    case 'refusal': return 'Claude agent declined the task'
    default: return `Claude agent run ended abnormally (${String(result.stopReason)})`
  }
}

async function settle(run: SubagentRun): Promise<{ readonly runId: string; readonly output: JsonValue[] }> {
  const [execution] = await Promise.allSettled([run.result.then((result) => {
    const error = abnormalResult(result)
    if (error !== undefined) {
      const partial = outputText(result.output)
      throw new Error(partial.length === 0 ? error : `${error}\nPartial output before the run ended:\n${partial}`)
    }
    return {
      runId: String(run.id),
      output: result.output as unknown as JsonValue[],
    }
  })])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError([execution.reason, disposal.reason], 'Claude agent execution and disposal both failed')
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

export const name = 'plugin-bridge-claude-agents'
export const inject = ['tools', 'subagents']

export function apply(ctx: Context, config: Config): void {
  const inspection = inspectClaudeAgents(config)
  for (const diagnostic of inspection.diagnostics) ctx.logger.warn(diagnostic)

  let toolDisposers: (() => void)[] = []
  const unmount = (): void => {
    for (const dispose of toolDisposers.splice(0).reverse()) dispose()
  }
  const mount = (provider: SubagentProvider): void => {
    if (!provider.capabilities.persona) {
      throw new Error(`Claude agents require provider ${JSON.stringify(provider.name)} to support per-child persona`)
    }
    if (inspection.agents.some(agent => agent.toolFilter !== undefined) && !provider.capabilities.toolFilter) {
      throw new Error(`Claude agents require provider ${JSON.stringify(provider.name)} to support per-child toolFilter`)
    }
    const mounted: (() => void)[] = []
    try {
      for (const agent of inspection.agents) {
        mounted.push(ctx.tools.register(defineTool({
          name: agent.toolName,
          description: agent.description,
          parameters: {
            prompt: {
              type: 'string',
              required: true,
              description: 'The task for this specialized agent.',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                runId: { type: 'string', required: true },
                output: { type: 'array', required: true, items: { type: 'json' } },
              },
            },
            render: (_args, value) => value.output as unknown as ContentBlock[],
          },
          isConcurrencySafe: () => true,
          async execute(args, exec) {
            if (exec.agent === undefined) throw new Error('Claude agent tool requires a calling DSH agent')
            const run = await ctx.subagents.start(config.provider, {
              label: agent.name,
              prompt: [{ type: 'text', text: args.prompt }],
              parent: exec.agent,
              signal: exec.signal,
              persona: agent.persona,
              ...agent.toolFilter === undefined ? {} : { toolFilter: agent.toolFilter },
            })
            return settle(run)
          },
        })))
      }
    } catch (error: unknown) {
      for (const dispose of mounted.reverse()) dispose()
      throw error
    }
    toolDisposers = mounted
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === config.provider && toolDisposers.length === 0) mount(provider)
  })
  ctx.on('subagent/provider-removed', (providerName) => {
    if (providerName === config.provider) unmount()
  })
  const provider = ctx.subagents.getProvider(config.provider)
  if (provider === undefined) {
    ctx.logger.info(`Claude agents are waiting for explicit DSH subagent provider ${JSON.stringify(config.provider)}`)
  } else {
    mount(provider)
  }
}
