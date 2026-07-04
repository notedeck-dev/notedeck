/**
 * E2E ハーネス (#702) — 実アプリを隔離プロファイルで起動し、外部アプリと
 * 同じ HTTP API 面 (#709) で駆動する。
 *
 * 起動フロー:
 *   1. port 19820 が空いていることを確認 (実アプリ起動中の誤操作防止)
 *   2. 一時ディレクトリを NOTEDECK_APP_DIR に指定してデバッグバイナリを spawn
 *      (チュートリアル自動起動は settings.json5 の事前配置で抑止)
 *   3. デバッグビルドは devUrl (5173) から frontend を読むため、vite が
 *      いなければ `pnpm dev` も spawn する (既に居れば再利用)
 *   4. GET /api 到達 → tokenPath からトークン取得 → /api/health の
 *      frontendReady が立つまで待つ
 *
 * teardown はプロセス SIGTERM + 一時プロファイル削除。
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_BASE = 'http://127.0.0.1:19820'
const VITE_BASE = 'http://localhost:5173'
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

export interface E2eApp {
  /** `http://127.0.0.1:19820` */
  base: string
  /** ephemeral Bearer トークン (tokenPath から取得済み) */
  token: string
  /** NOTEDECK_APP_DIR に指定した隔離プロファイル */
  profileDir: string
  get(apiPath: string): Promise<Response>
  post(apiPath: string, body?: unknown): Promise<Response>
  del(apiPath: string): Promise<Response>
  stop(): Promise<void>
}

async function reachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.status < 500
  } catch {
    return false
  }
}

async function waitFor(
  check: () => Promise<boolean>,
  what: string,
  timeoutMs: number,
  intervalMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`timed out waiting for ${what} (${timeoutMs}ms)`)
}

function terminate(proc: ChildProcess, killAfterMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve()
    const killTimer = setTimeout(() => proc.kill('SIGKILL'), killAfterMs)
    proc.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })
    proc.kill('SIGTERM')
  })
}

export async function launchApp(): Promise<E2eApp> {
  // 安全ガード: 19820 が既に応答する = ユーザーの実アプリが起動中。
  // そのまま進むとテストが実アプリを操作してしまうため即中断する。
  if (await reachable(`${API_BASE}/api`)) {
    throw new Error(
      'port 19820 is already in use — NoteDeck が起動中です。E2E は実アプリを閉じてから実行してください',
    )
  }

  const binary =
    process.env.NOTEDECK_E2E_BINARY ??
    path.join(REPO_ROOT, 'src-tauri/target/debug/notedeck')
  if (!existsSync(binary)) {
    throw new Error(
      `app binary not found: ${binary} — 先に "cargo build" (src-tauri/) を実行するか NOTEDECK_E2E_BINARY を指定してください`,
    )
  }

  // 隔離プロファイル + チュートリアル抑止
  const profileDir = await mkdtemp(path.join(tmpdir(), 'notedeck-e2e-'))
  await mkdir(path.join(profileDir, 'notedeck'), { recursive: true })
  await writeFile(
    path.join(profileDir, 'notedeck', 'settings.json5'),
    `${JSON.stringify({ 'tutorial.completed': true }, null, 2)}\n`,
  )

  // デバッグビルドは devUrl (vite) から frontend を読む。
  // 既に vite が居ればそれを再利用し、いなければ自前で起動する。
  let viteProc: ChildProcess | null = null
  if (!(await reachable(VITE_BASE))) {
    // pnpm 経由だと SIGTERM が vite 本体に届かず orphan になるため直接起動
    viteProc = spawn(path.join(REPO_ROOT, 'node_modules/.bin/vite'), [], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    })
    await waitFor(
      () => reachable(VITE_BASE),
      'vite dev server (5173)',
      60_000,
      500,
    )
  }

  const appProc = spawn(binary, [], {
    env: { ...process.env, NOTEDECK_APP_DIR: profileDir },
    stdio: 'ignore',
  })

  const cleanup = async () => {
    await terminate(appProc)
    if (viteProc) await terminate(viteProc)
    await rm(profileDir, { recursive: true, force: true })
  }

  try {
    await waitFor(
      () => reachable(`${API_BASE}/api`),
      'HTTP API (19820)',
      120_000,
    )

    const index = (await (await fetch(`${API_BASE}/api`)).json()) as {
      tokenPath: string
    }
    const token = (await readFile(index.tokenPath, 'utf8')).trim()
    const headers = { Authorization: `Bearer ${token}` }

    // frontend (WebView) が query bridge に応答するまで待つ
    await waitFor(
      async () => {
        try {
          const res = await fetch(`${API_BASE}/api/health`, { headers })
          if (!res.ok) return false
          const health = (await res.json()) as { frontendReady?: boolean }
          return health.frontendReady === true
        } catch {
          return false
        }
      },
      'frontend (WebView) readiness',
      120_000,
      2000,
    )

    return {
      base: API_BASE,
      token,
      profileDir,
      get: (apiPath) => fetch(`${API_BASE}${apiPath}`, { headers }),
      // body なしのとき Content-Type を付けない (axum の Option<Json> は
      // 「JSON ヘッダあり + 空 body」を 400 にする)
      post: (apiPath, body) =>
        fetch(`${API_BASE}${apiPath}`, {
          method: 'POST',
          ...(body === undefined
            ? { headers }
            : {
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }),
        }),
      del: (apiPath) =>
        fetch(`${API_BASE}${apiPath}`, { method: 'DELETE', headers }),
      stop: cleanup,
    }
  } catch (e) {
    await cleanup()
    throw e
  }
}
