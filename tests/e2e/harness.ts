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
import { DatabaseSync } from 'node:sqlite'
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

export interface SeedAccount {
  /** accounts.id (notecli は UUID を使う。E2E は固定値でよい) */
  id: string
  /** `127.0.0.1:{port}` — モックサーバーの host */
  host: string
  token: string
  userId: string
  username: string
}

export interface LaunchOptions {
  /** アプリ起動時に追加する環境変数 (NOTECLI_INSECURE_HOSTS 等) */
  env?: Record<string, string>
  /** 起動前に notecli.db へアカウントを seed する (モックサーバー接続用) */
  seedAccount?: SeedAccount
}

/**
 * アプリ初回起動前に notecli.db を作ってアカウントを差し込む。
 * DDL は notecli migrations/V1__initial_schema.sql の accounts 抜粋
 * (V1 は IF NOT EXISTS なので、起動時の refinery migration は既存テーブルを
 * そのまま採用し行を保持する)。token は DB 平文 fallback 経路で読まれる。
 */
function seedAccountDb(profileDir: string, account: SeedAccount): void {
  const db = new DatabaseSync(path.join(profileDir, 'notecli.db'))
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    token TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    software TEXT NOT NULL,
    UNIQUE(host, user_id)
  )`)
  db.prepare(
    `INSERT INTO accounts (id, host, token, user_id, username, display_name, avatar_url, software)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'misskey')`,
  ).run(
    account.id,
    account.host,
    account.token,
    account.userId,
    account.username,
    account.username,
  )
  db.close()
}

async function reachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.status < 500
  } catch {
    return false
  }
}

export async function waitFor(
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

/**
 * attach モード (Android 実機/エミュレータ向け):
 * `NOTEDECK_E2E_ATTACH=1` のとき、アプリを spawn せず既に起動している
 * インスタンス (adb forward tcp:19820 tcp:19820 経由) に接続する。
 * トークンはデバイス内ファイルを読めないため `NOTEDECK_E2E_TOKEN` で渡す。
 * stop() は何もしない (デバイス側アプリは殺さない)。
 */
async function attachApp(): Promise<E2eApp> {
  const token = process.env.NOTEDECK_E2E_TOKEN
  if (!token) {
    throw new Error(
      'NOTEDECK_E2E_ATTACH=1 には NOTEDECK_E2E_TOKEN が必要です (デバイスの api-token の中身)',
    )
  }
  await waitFor(
    () => reachable(`${API_BASE}/api`),
    'attached HTTP API (19820)',
    30_000,
  )
  const headers = { Authorization: `Bearer ${token}` }
  return {
    base: API_BASE,
    token,
    profileDir: '',
    get: (apiPath) => fetch(`${API_BASE}${apiPath}`, { headers }),
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
    stop: async () => {
      // attach モードではデバイス側アプリを殺さない
    },
  }
}

export const isAttachMode = process.env.NOTEDECK_E2E_ATTACH === '1'

export async function launchApp(options: LaunchOptions = {}): Promise<E2eApp> {
  if (isAttachMode) {
    return attachApp()
  }

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
  if (options.seedAccount) {
    seedAccountDb(profileDir, options.seedAccount)
  }

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

  // NOTEDECK_E2E_VERBOSE=1 でアプリの stdout/stderr をテスト出力へ流す。
  // 起動失敗 (WebKit の EGL/DMABUF クラッシュ等) は 19820 タイムアウトとして
  // しか観測できず、死因がログに残らないため CI では常時有効にする
  const verbose = process.env.NOTEDECK_E2E_VERBOSE === '1'
  const appProc = spawn(binary, [], {
    env: { ...process.env, NOTEDECK_APP_DIR: profileDir, ...options.env },
    stdio: verbose ? ['ignore', 'inherit', 'inherit'] : 'ignore',
  })
  appProc.once('exit', (code, signal) => {
    if (verbose) {
      console.error(`[e2e] app process exited: code=${code} signal=${signal}`)
    }
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
