import { describe, expect, it } from 'vitest'
import { isHeartbeatStepsEmpty } from './heartbeatSteps'

describe('isHeartbeatStepsEmpty (notemaid の is_effectively_empty と同じ定義)', () => {
  it('空文字 / 空行だけは空', () => {
    expect(isHeartbeatStepsEmpty('')).toBe(true)
    expect(isHeartbeatStepsEmpty('\n\n  \n')).toBe(true)
  })

  it('見出し / コメント / fence / 空のチェックリストだけなら空', () => {
    expect(
      isHeartbeatStepsEmpty(
        '# HEARTBEAT.md\n\n<!-- todo -->\n- [ ]\n- []\n-\n*\n* [ ]\n```\n```\n~~~\n~~~\n',
      ),
    ).toBe(true)
  })

  it('複数行の HTML コメントは中身ごと無視する', () => {
    expect(
      isHeartbeatStepsEmpty(
        '# 巡回\n<!--\n- 下書きを確認する\n- 通知を数える\n-->\n',
      ),
    ).toBe(true)
    // 閉じていないコメントは末尾まで無視
    expect(isHeartbeatStepsEmpty('<!-- 書きかけ\n- 通知を数える\n')).toBe(true)
  })

  it('先頭の frontmatter は無視する', () => {
    expect(
      isHeartbeatStepsEmpty(
        '---\nid: heartbeat\nmode: heartbeat\n---\n# HEARTBEAT.md\n\n<!-- todo -->\n- [ ]\n```\n```\n',
      ),
    ).toBe(true)
  })

  it('手順が 1 行でもあれば空ではない', () => {
    expect(
      isHeartbeatStepsEmpty(
        '# HEARTBEAT.md\n- check drafts older than a day\n',
      ),
    ).toBe(false)
    expect(isHeartbeatStepsEmpty('- [ ] 下書きを確認する\n')).toBe(false)
    expect(isHeartbeatStepsEmpty('```\ncheck\n```\n')).toBe(false)
    expect(isHeartbeatStepsEmpty('<!-- a -->手順<!-- b -->\n')).toBe(false)
  })
})
