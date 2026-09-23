import { commands, unwrap } from '@/utils/tauriInvoke'
import { getCliIcon } from './cliIcons'

/** Raw metadata returned by the Rust backend (matches notecli::cli::CliCommandInfo). */
interface RawCliCommandInfo {
  name: string
  about: string | null
  args: {
    name: string
    help: string | null
    required: boolean
    default_value: string | null
  }[]
}

/** Enriched command metadata used by the frontend. */
export interface CliCommandMeta {
  name: string
  about: string | null
  args: {
    name: string
    help: string | null
    required: boolean
    defaultValue: string | null
  }[]
  icon: string
  /** Whether any positional argument is required */
  needsArgs: boolean
  /** Human-readable usage string */
  usage: string
}

export interface CliCommand {
  name: string
  args: string
}

/** Commands that don't make sense in the GUI palette */
const EXCLUDED_COMMANDS = new Set(['daemon', 'login', 'logout'])

let commandCache: CliCommandMeta[] | null = null

function buildUsage(raw: RawCliCommandInfo): string {
  const parts = [raw.name]
  for (const arg of raw.args) {
    if (arg.required) {
      parts.push(`<${arg.name}>`)
    } else if (arg.default_value != null) {
      parts.push(`[${arg.name}]`)
    }
  }
  return parts.join(' ')
}

function enrichCommand(raw: RawCliCommandInfo): CliCommandMeta {
  return {
    name: raw.name,
    about: raw.about,
    args: raw.args.map((a) => ({
      name: a.name,
      help: a.help,
      required: a.required,
      defaultValue: a.default_value,
    })),
    icon: getCliIcon(raw.name),
    needsArgs: raw.args.some((a) => a.required),
    usage: buildUsage(raw),
  }
}

/** Load CLI command metadata from the Rust backend. Call once at startup. */
export async function loadCliCommands(): Promise<CliCommandMeta[]> {
  const raw = unwrap(await commands.getCliCommands())
  commandCache = raw
    .filter((c) => !EXCLUDED_COMMANDS.has(c.name))
    .map(enrichCommand)
  return commandCache
}

/** Get cached commands (returns empty array if not yet loaded). */
export function getCliCommands(): CliCommandMeta[] {
  return commandCache ?? []
}

/** Get metadata for a specific command by name. */
export function getCliMeta(name: string): CliCommandMeta | undefined {
  return getCliCommands().find((c) => c.name === name)
}

/** Parse raw palette input into a CLI command (if it matches a known command). */
export function parseCliInput(input: string): CliCommand | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const spaceIdx = trimmed.indexOf(' ')
  const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)

  const commands = getCliCommands()
  if (!commands.some((c) => c.name === name)) return null
  return { name, args }
}
