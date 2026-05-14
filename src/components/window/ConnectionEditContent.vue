<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AuthType, ConnectionUpsert, VaultTestResult } from '@/bindings'
import { useVault } from '@/composables/useVault'
import { BUILTIN_TEMPLATES } from '@/data/connectionTemplates'
import { useConfirm } from '@/stores/confirm'

const props = defineProps<{
  connectionId?: string
  templateId?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const vault = useVault()
const { confirm } = useConfirm()

type AuthKind = AuthType['kind']

// --- フォーム状態 ---
const name = ref('')
const baseUrl = ref('')
const authKind = ref<AuthKind>('bearer')
const headerName = ref('')
const queryParam = ref('')
const basicUsername = ref('')
const allowedHostsText = ref('')
const notes = ref('')
const aiVisible = ref(false)

// secret: 既存接続では「鍵を入れ替える」を押すまで入力欄を出さない。
const hasSecret = ref(false)
const rotatingSecret = ref(false)
const secretInput = ref('')
const secretLabel = ref('Secret / API Key')
const secretHelpUrl = ref('')

const isNew = computed(() => !props.connectionId)
const saving = ref(false)
const errorMessage = ref('')
const testResult = ref<VaultTestResult | null>(null)
const testing = ref(false)
const testPath = ref('/')

const showSecretInput = computed(() => isNew.value || rotatingSecret.value)

onMounted(async () => {
  await vault.refresh()

  // テンプレートからのプリフィル。
  if (props.templateId) {
    const tpl = BUILTIN_TEMPLATES.find((t) => t.id === props.templateId)
    if (tpl) {
      name.value = tpl.name
      baseUrl.value = tpl.baseUrl
      authKind.value = tpl.authType.kind
      if (tpl.authType.kind === 'header') headerName.value = tpl.authType.name
      if (tpl.authType.kind === 'query') queryParam.value = tpl.authType.param
      allowedHostsText.value = tpl.allowedHosts.join(', ')
      testPath.value = tpl.testPath
      secretLabel.value = tpl.secretLabel
      secretHelpUrl.value = tpl.secretHelpUrl
    }
  }

  // 既存接続のロード。
  if (props.connectionId) {
    const conn = vault.connections.value.find(
      (c) => c.id === props.connectionId,
    )
    if (conn) {
      name.value = conn.name
      baseUrl.value = conn.baseUrl
      authKind.value = conn.authType.kind
      if (conn.authType.kind === 'header') headerName.value = conn.authType.name
      if (conn.authType.kind === 'query') queryParam.value = conn.authType.param
      if (conn.authType.kind === 'basic')
        basicUsername.value = conn.authType.username
      allowedHostsText.value = (conn.allowedHosts ?? []).join(', ')
      notes.value = conn.notes ?? ''
      aiVisible.value = conn.aiVisible ?? false
      hasSecret.value = (conn.slots ?? []).length > 0
      // テンプレ由来なら test path / secret help を引き継ぐ。
      const tpl = conn.templateId
        ? BUILTIN_TEMPLATES.find((t) => t.id === conn.templateId)
        : undefined
      if (tpl) {
        testPath.value = tpl.testPath
        secretLabel.value = tpl.secretLabel
        secretHelpUrl.value = tpl.secretHelpUrl
      }
    }
  }
})

function buildAuthType(): AuthType {
  switch (authKind.value) {
    case 'bearer':
      return { kind: 'bearer' }
    case 'header':
      return { kind: 'header', name: headerName.value.trim() }
    case 'query':
      return { kind: 'query', param: queryParam.value.trim() }
    case 'basic':
      return { kind: 'basic', username: basicUsername.value.trim() }
  }
}

function buildUpsert(): ConnectionUpsert {
  const allowedHosts = allowedHostsText.value
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
  return {
    id: props.connectionId ?? null,
    name: name.value.trim(),
    baseUrl: baseUrl.value.trim(),
    authType: buildAuthType(),
    allowedHosts,
    accountScope: null,
    notes: notes.value.trim() || null,
  }
}

function validateForm(): string | null {
  if (!name.value.trim()) return '名前を入力してください'
  if (!baseUrl.value.trim()) return 'URL を入力してください'
  if (authKind.value === 'header' && !headerName.value.trim())
    return 'ヘッダー名を入力してください'
  if (authKind.value === 'query' && !queryParam.value.trim())
    return 'クエリパラメータ名を入力してください'
  if (
    showSecretInput.value &&
    secretInput.value &&
    secretInput.value.length < 16
  )
    return 'secret は 16 文字以上にしてください'
  if (isNew.value && !secretInput.value) return 'secret を入力してください'
  return null
}

async function save() {
  errorMessage.value = ''
  const validationError = validateForm()
  if (validationError) {
    errorMessage.value = validationError
    return
  }
  saving.value = true
  try {
    const upsert = buildUpsert()
    let connId = props.connectionId

    if (isNew.value) {
      // 新規: メタデータ + secret を 1 トランザクションで作成。
      const conn = await vault.upsertConnectionWithSecret(
        upsert,
        'primary',
        secretInput.value,
      )
      connId = conn.id
    } else {
      // 更新: メタデータを保存。
      await vault.upsertConnection(upsert)
      // 鍵を入れ替えた場合のみ secret を更新。
      if (rotatingSecret.value && secretInput.value) {
        await vault.setSecret(connId as string, 'primary', secretInput.value)
      }
    }

    // AI 開示状態を反映 (新規・更新どちらも)。
    if (connId) {
      await vault.setAiVisible(connId, aiVisible.value)
    }

    emit('close')
  } catch (e) {
    errorMessage.value = formatError(e)
  } finally {
    saving.value = false
  }
}

async function runTest() {
  if (!props.connectionId) {
    errorMessage.value = '先に接続を保存してからテストしてください'
    return
  }
  testing.value = true
  testResult.value = null
  errorMessage.value = ''
  try {
    testResult.value = await vault.testConnection(
      props.connectionId,
      testPath.value || '/',
    )
  } catch (e) {
    errorMessage.value = formatError(e)
  } finally {
    testing.value = false
  }
}

async function remove() {
  if (!props.connectionId) return
  const ok = await confirm({
    title: '接続を削除',
    message: `「${name.value}」を削除しますか？ secret も OS キーチェーンから完全に削除されます。`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  try {
    await vault.deleteConnection(props.connectionId)
    emit('close')
  } catch (e) {
    errorMessage.value = formatError(e)
  }
}

function formatError(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const err = e as { code: string; message?: string }
    if (err.message) return `${err.code}: ${err.message}`
    return err.code
  }
  return e instanceof Error ? e.message : String(e)
}

const testResultText = computed(() => {
  const r = testResult.value
  if (!r) return ''
  if (r.ok) return `✓ 接続成功 (HTTP ${r.status})`
  if (r.status != null) return `✗ HTTP ${r.status}`
  return `✗ ${r.error ?? '失敗'}`
})
</script>

<template>
  <div :class="$style.content">
    <!-- 基本 -->
    <div :class="$style.section">
      <label :class="$style.field">
        <span :class="$style.label">名前</span>
        <input v-model="name" type="text" :class="$style.input" placeholder="GitHub PAT" />
      </label>

      <label :class="$style.field">
        <span :class="$style.label">URL</span>
        <input
          v-model="baseUrl"
          type="url"
          :class="$style.input"
          placeholder="https://api.github.com"
        />
      </label>

      <div :class="$style.field">
        <span :class="$style.label">認証方式</span>
        <div :class="$style.radioGroup">
          <label :class="$style.radio">
            <input v-model="authKind" type="radio" value="bearer" />
            <span>Authorization: Bearer &lt;secret&gt;</span>
          </label>
          <label :class="$style.radio">
            <input v-model="authKind" type="radio" value="header" />
            <span>任意ヘッダー</span>
          </label>
          <input
            v-if="authKind === 'header'"
            v-model="headerName"
            type="text"
            :class="$style.subInput"
            placeholder="ヘッダー名 (例: x-api-key)"
          />
          <label :class="$style.radio">
            <input v-model="authKind" type="radio" value="query" />
            <span>クエリパラメータ</span>
          </label>
          <input
            v-if="authKind === 'query'"
            v-model="queryParam"
            type="text"
            :class="$style.subInput"
            placeholder="パラメータ名 (例: api_key)"
          />
          <label :class="$style.radio">
            <input v-model="authKind" type="radio" value="basic" />
            <span>ベーシック認証</span>
          </label>
          <input
            v-if="authKind === 'basic'"
            v-model="basicUsername"
            type="text"
            :class="$style.subInput"
            placeholder="ユーザー名"
          />
        </div>
      </div>
    </div>

    <div :class="$style.divider" />

    <!-- シークレット -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-key" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">シークレット</span>
      </div>

      <div v-if="hasSecret && !showSecretInput" :class="$style.secretStatus">
        <span>設定済み</span>
        <button
          class="_button"
          :class="$style.rotateBtn"
          @click="rotatingSecret = true"
        >
          <i class="ti ti-refresh" />
          鍵を入れ替える
        </button>
      </div>

      <div v-if="showSecretInput" :class="$style.field">
        <span :class="$style.label">{{ secretLabel }}</span>
        <input
          v-model="secretInput"
          type="password"
          :class="$style.input"
          placeholder="16 文字以上"
          autocomplete="off"
        />
        <a
          v-if="secretHelpUrl"
          :href="secretHelpUrl"
          target="_blank"
          rel="noopener"
          :class="$style.helpLink"
        >
          発行手順を開く
        </a>
      </div>
    </div>

    <div :class="$style.divider" />

    <!-- 詳細 -->
    <details :class="$style.details">
      <summary :class="$style.summary">詳細</summary>
      <div :class="$style.section">
        <label :class="$style.field">
          <span :class="$style.label">許可するホスト (カンマ区切り)</span>
          <input
            v-model="allowedHostsText"
            type="text"
            :class="$style.input"
            placeholder="自動: baseUrl のホスト"
          />
        </label>
        <label :class="$style.field">
          <span :class="$style.label">メモ</span>
          <textarea
            v-model="notes"
            :class="$style.textarea"
            rows="2"
            placeholder="ここにシークレットを書かないでください"
          />
        </label>
        <label :class="$style.toggleRow">
          <input v-model="aiVisible" type="checkbox" />
          <span>
            <span :class="$style.toggleLabel">AI からのアクセスを許可</span>
            <span :class="$style.toggleHint">
              OFF だと AI には接続の存在自体が見えません
            </span>
          </span>
        </label>
      </div>
    </details>

    <div :class="$style.divider" />

    <!-- アクション -->
    <div :class="$style.actions">
      <button
        v-if="!isNew"
        class="_button"
        :class="$style.testBtn"
        :disabled="testing"
        @click="runTest"
      >
        <i class="ti ti-plug" />
        {{ testing ? 'テスト中...' : 'テスト' }}
      </button>
      <button
        class="_button"
        :class="$style.saveBtn"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? '保存中...' : '保存' }}
      </button>
      <button
        v-if="!isNew"
        class="_button"
        :class="$style.deleteBtn"
        @click="remove"
      >
        削除
      </button>
    </div>

    <p
      v-if="testResultText"
      :class="[$style.testResult, testResult?.ok ? $style.testOk : $style.testFail]"
    >
      {{ testResultText }}
    </p>
    <p v-if="errorMessage" :class="$style.error">{{ errorMessage }}</p>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.content {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sectionHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.sectionIcon {
  font-size: 16px;
  color: var(--nd-fgMuted);
}

.sectionTitle {
  font-weight: bold;
  font-size: 0.95em;
  color: var(--nd-fg);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 0.8em;
  color: var(--nd-fgMuted);
}

.input {
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
}

.subInput {
  margin-left: 22px;
  padding: 6px 8px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.8em;
}

.textarea {
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
  resize: vertical;
  font-family: inherit;
}

.radioGroup {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.83em;
  color: var(--nd-fg);
  cursor: pointer;
}

.secretStatus {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85em;
  color: var(--nd-fg);
}

.rotateBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.8em;
  cursor: pointer;
}

.helpLink {
  font-size: 0.78em;
  color: var(--nd-link);
}

.details {
  margin: 0;
}

.summary {
  font-size: 0.85em;
  color: var(--nd-fgMuted);
  cursor: pointer;
  padding: 4px 0;
}

.toggleRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.toggleLabel {
  display: block;
  font-size: 0.85em;
  color: var(--nd-fg);
}

.toggleHint {
  display: block;
  font-size: 0.75em;
  color: var(--nd-fgMuted);
}

.actions {
  display: flex;
  gap: 8px;
}

.testBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.85em;
  cursor: pointer;
}

.saveBtn {
  @include btn-action;
  flex: 1;
}

.deleteBtn {
  padding: 8px 12px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-love) 12%, transparent);
  color: var(--nd-love);
  font-size: 0.85em;
  cursor: pointer;
}

.divider {
  height: 1px;
  background: var(--nd-divider);
  margin: 16px 0;
}

.testResult {
  margin: 12px 0 0;
  font-size: 0.82em;
}

.testOk {
  color: var(--nd-success, var(--nd-link));
}

.testFail {
  color: var(--nd-love);
}

.error {
  margin: 12px 0 0;
  padding: 8px 12px;
  font-size: 0.8em;
  color: var(--nd-love);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  border-radius: var(--nd-radius-sm);
}
</style>
