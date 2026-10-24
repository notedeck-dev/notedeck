#!/usr/bin/env node
// winget-pkgs への PR から、PackageVersion と同じ DisplayVersion を落とす (release.yml の
// winget ジョブ)。
//
//   PR_URL=https://github.com/microsoft/winget-pkgs/pull/N GITHUB_TOKEN=... \
//     node scripts/winget-drop-display-version.mjs
//
// DRY_RUN=1 なら読むだけで書き込まない (直した後の中身を表示する)
//
// winget-pkgs のメンテナーから「DisplayVersion と PackageVersion が同じなら DisplayVersion は
// 消すべき」と毎回指摘される。マニフェストは winget-releaser の Komac が組み、NSIS の
// インストーラーが書くレジストリ値から AppsAndFeaturesEntries に DisplayVersion を入れる。
// Komac にも同じ値を消す処理はあるが、新しい版を locale に書き込む前に比べるので
// (前の版と比べて) 消し損ねる。Komac の解析はそのまま使い、PR を作った直後に fork 側の
// PR ブランチで installer マニフェストを直す。Komac の書式はそのまま残す。

import { fileURLToPath } from 'node:url'

const UPSTREAM = 'microsoft/winget-pkgs'

const ENTRIES_HEADER = /^\s*AppsAndFeaturesEntries:\s*$/

/** `DisplayVersion: <version>` (値の引用符は問わない) の行を落とす。違う値は残す */
export function dropDisplayVersion(text, version) {
  const lines = text.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = /^(\s*)(- )?DisplayVersion: (['"]?)(.*)\3\s*$/.exec(line)
    if (!m || m[4] !== version) {
      out.push(line)
      continue
    }
    const [, indent, dash] = m
    // エントリーの 2 つ目以降の項目: 行ごと落とす
    if (!dash) continue
    // エントリーの先頭の項目: 次の項目を先頭に繰り上げる
    const itemIndent = `${indent}  `
    const next = lines[i + 1]
    if (next?.startsWith(itemIndent) && /^\S/.test(next.slice(itemIndent.length))) {
      out.push(`${indent}- ${next.slice(itemIndent.length)}`)
      i++
      continue
    }
    // DisplayVersion だけのエントリー: エントリーごと消し、一覧が空になったら見出しも消す
    const firstItem = ENTRIES_HEADER.test(out[out.length - 1] ?? '')
    if (firstItem && !next?.startsWith(`${indent}- `)) out.pop()
  }
  return out.join('\n')
}

async function main() {
  const { PR_URL, GITHUB_TOKEN, DRY_RUN } = process.env
  const number = /\/pull\/(\d+)/.exec(PR_URL ?? '')?.[1]
  if (!number || !GITHUB_TOKEN) {
    throw new Error('PR_URL (a winget-pkgs pull request) and GITHUB_TOKEN are required')
  }
  const api = async (path, init = {}) => {
    const res = await fetch(`https://api.github.com/${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`)
    }
    return res.json()
  }
  const pr = await api(`repos/${UPSTREAM}/pulls/${number}`)
  const fork = pr.head.repo.full_name
  const branch = pr.head.ref
  const files = await api(`repos/${UPSTREAM}/pulls/${number}/files`)
  for (const { filename } of files) {
    if (!filename.endsWith('.installer.yaml')) continue
    const path = filename.split('/').map(encodeURIComponent).join('/')
    // PR を作った時点の commit を読む (書き込みはブランチの先頭に積む)
    const file = await api(`repos/${fork}/contents/${path}?ref=${pr.head.sha}`)
    const text = Buffer.from(file.content, 'base64').toString('utf8')
    const version = /^PackageVersion:\s*['"]?([^'"\s]+)/m.exec(text)?.[1]
    const fixed = version ? dropDisplayVersion(text, version) : text
    if (fixed === text) {
      console.log(`${filename}: no DisplayVersion equal to PackageVersion`)
      continue
    }
    if (DRY_RUN) {
      console.log(`${filename}: would remove DisplayVersion ${version}\n${fixed}`)
      continue
    }
    await api(`repos/${fork}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Remove DisplayVersion equal to PackageVersion',
        content: Buffer.from(fixed, 'utf8').toString('base64'),
        sha: file.sha,
        branch,
      }),
    })
    console.log(`${filename}: removed DisplayVersion ${version}`)
  }
}

// Windows のランナーではドライブ文字の大小が揃わないことがあるので、大小を無視して比べる
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    process.argv[1].toLowerCase()
if (isMain) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
