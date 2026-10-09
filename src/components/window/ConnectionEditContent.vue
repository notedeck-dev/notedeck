<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type {
  AuthType,
  ConnectionProtocol,
  ConnectionUpsert,
  TrustedPlugin,
  VaultTestResult,
} from '@/bindings'
import CollapseBox from '@/components/common/CollapseBox.vue'
import FormInput from '@/components/common/form/FormInput.vue'
import { useVault } from '@/composables/useVault'
import { BUILTIN_TEMPLATES } from '@/data/connectionTemplates'
import { i18n } from '@/i18n'
import { resolveForProfiled, usePermissionsConfig } from '@/permissions/store'
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
const advancedOpen = ref(false)
const { file: permissionsFile } = usePermissionsConfig()

// 二段 gate の状態依存 chip (#712 §6.3): vault.use が実効 OFF のクラスに
// 開示トグルを ON にしても列挙にすら出ない — dead toggle にしない受動表示
const aiVaultUseEnabled = computed(() => {
  void permissionsFile.value
  return (
    resolveForProfiled('ai.chat')['vault.use'] ||
    resolveForProfiled('ai.heartbeat')['vault.use']
  )
})
const pluginVaultUseEnabled = computed(() => {
  void permissionsFile.value
  return resolveForProfiled('plugin')['vault.use']
})
const externalVaultUseEnabled = computed(() => {
  void permissionsFile.value
  return resolveForProfiled('external')['vault.use']
})

// 開示先クラス別トグル (#712 §6.1 / #759)。「AI に見せる」「プラグインに見せる」
// 「外部アプリに見せる」は別の同意 — 片方への開示が他方に波及しない。
// trusted は開示が前提。plugin の trust はクラス一括ではなく個体単位
// (trustedPlugins) — 確認ダイアログの「今後確認なし」で積まれ、ここでは
// 一覧表示と個別取り消しのみ行う。
const exposedAi = ref(false)
const trustedAi = ref(false)
const exposedPlugin = ref(false)
const trustedPlugins = ref<TrustedPlugin[]>([])
const exposedExternal = ref(false)
const trustedExternal = ref(false)
// テンプレ由来 / AI プロバイダー接続のメタデータ。フォームには出さず、
// upsert 時に保持して上書き消失を防ぐ。
const connTemplateId = ref<string | null>(null)
const protocol = ref<ConnectionProtocol | null>(null)

const externalSource = ref<string | null>(null)

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
      connTemplateId.value = tpl.id
      protocol.value = tpl.protocol ?? null
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
      exposedAi.value = conn.exposedTo?.includes('ai') ?? false
      trustedAi.value = conn.trustedFor?.includes('ai') ?? false
      exposedPlugin.value = conn.exposedTo?.includes('plugin') ?? false
      trustedPlugins.value = [...(conn.trustedPlugins ?? [])]
      exposedExternal.value = conn.exposedTo?.includes('external') ?? false
      trustedExternal.value = conn.trustedFor?.includes('external') ?? false
      hasSecret.value = (conn.slots ?? []).length > 0
      connTemplateId.value = conn.templateId ?? null
      protocol.value = conn.protocol ?? null
      externalSource.value = conn.externalSource ?? null
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
    templateId: connTemplateId.value,
    protocol: protocol.value,
    // origin は省略 (null) で既存値を保持する。externalSource は upsert 時に
    // 無条件上書きされるため、ロード時の値をそのまま渡して消失を防ぐ。
    origin: null,
    externalSource: externalSource.value,
  }
}

// 欄ごとの誤り。保存を一度押すまでは出さず (打ち始めから赤くしない)、
// 押した後は入力に合わせてその場で消える
const fieldErrors = computed(() => {
  let secret = ''
  if (
    showSecretInput.value &&
    secretInput.value &&
    secretInput.value.length < 16
  )
    secret = i18n.ts._connectionEditContent.secretTooShort
  else if (isNew.value && !secretInput.value)
    secret = i18n.ts._connectionEditContent.secretRequired
  return {
    name: name.value.trim() ? '' : i18n.ts._connectionEditContent.nameRequired,
    baseUrl: baseUrl.value.trim()
      ? ''
      : i18n.ts._connectionEditContent.urlRequired,
    headerName:
      authKind.value === 'header' && !headerName.value.trim()
        ? i18n.ts._connectionEditContent.headerNameRequired
        : '',
    queryParam:
      authKind.value === 'query' && !queryParam.value.trim()
        ? i18n.ts._connectionEditContent.queryParamRequired
        : '',
    secret,
  }
})
const submitted = ref(false)
const shownErrors = computed(() =>
  submitted.value
    ? fieldErrors.value
    : { name: '', baseUrl: '', headerName: '', queryParam: '', secret: '' },
)
const contentRef = ref<HTMLElement | null>(null)

async function save() {
  errorMessage.value = ''
  submitted.value = true
  if (Object.values(fieldErrors.value).some(Boolean)) {
    await nextTick()
    contentRef.value
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus()
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

    // 開示先クラスを反映 (新規・更新どちらも)。信頼は開示が前提 —
    // OFF のときは必ず false に倒す (Rust 側でも開示 OFF で trust を外す)。
    if (connId) {
      await vault.setExposed(connId, 'ai', exposedAi.value)
      await vault.setTrusted(connId, 'ai', exposedAi.value && trustedAi.value)
      // plugin の trust (個体単位) は確認ダイアログ側で積まれる。開示 OFF に
      // すると Rust 側 (vault_set_exposed) が trustedPlugins をまとめて外す。
      await vault.setExposed(connId, 'plugin', exposedPlugin.value)
      await vault.setExposed(connId, 'external', exposedExternal.value)
      await vault.setTrusted(
        connId,
        'external',
        exposedExternal.value && trustedExternal.value,
      )
    }

    emit('close')
  } catch (e) {
    errorMessage.value = formatError(e)
  } finally {
    saving.value = false
  }
}

/** 信頼済みプラグイン個体の取り消し (即時反映 — save を待たない)。 */
async function revokeTrustedPlugin(pluginId: string) {
  if (!props.connectionId) return
  try {
    await vault.setTrustedPlugin(props.connectionId, pluginId, null, false)
    trustedPlugins.value = trustedPlugins.value.filter((p) => p.id !== pluginId)
  } catch (e) {
    errorMessage.value = formatError(e)
  }
}

async function runTest() {
  if (!props.connectionId) {
    errorMessage.value = i18n.ts._connectionEditContent.saveBeforeTest
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
    title: i18n.ts._connectionEditContent.deleteTitle,
    message: i18n.tsx._connectionEditContent.deleteMessage({
      name: name.value,
    }),
    okLabel: i18n.ts._common.delete,
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
  if (r.ok)
    return i18n.tsx._connectionEditContent.testSuccess({
      status: String(r.status),
    })
  if (r.status != null) return `✗ HTTP ${r.status}`
  return `✗ ${r.error ?? i18n.ts._connectionEditContent.testFailed}`
})
</script>

<template>
  <div ref="contentRef" :class="$style.content">
    <!-- 基本 -->
    <div :class="$style.section">
      <label :class="$style.field">
        <span :class="$style.label">{{ i18n.ts._connectionEditContent.name }}</span>
        <FormInput v-model="name" placeholder="GitHub PAT" :error="shownErrors.name" />
      </label>

      <label :class="$style.field">
        <span :class="$style.label">URL</span>
        <FormInput
          v-model="baseUrl"
          type="url"
          placeholder="https://api.github.com"
          :error="shownErrors.baseUrl"
        />
      </label>

      <div :class="$style.field">
        <span :class="$style.label">{{ i18n.ts._connectionEditContent.authMethod }}</span>
        <div :class="$style.radioGroup">
          <label :class="$style.radio">
            <input v-model="authKind" type="radio" value="bearer" />
            <span>Authorization: Bearer &lt;secret&gt;</span>
          </label>
          <label :class="$style.radio">
            <input v-model="authKind" type="radio" value="header" />
            <span>{{ i18n.ts._connectionEditContent.customHeader }}</span>
          </label>
          <FormInput
            v-if="authKind === 'header'"
            v-model="headerName"
            :class="$style.subInput"
            :placeholder="i18n.ts._connectionEditContent.headerNamePlaceholder"
            :aria-label="i18n.ts._connectionEditContent.customHeader"
            :error="shownErrors.headerName"
          />
          <label :class="$style.radio">
            <input v-model="authKind" type="radio" value="query" />
            <span>{{ i18n.ts._connectionEditContent.queryParam }}</span>
          </label>
          <FormInput
            v-if="authKind === 'query'"
            v-model="queryParam"
            :class="$style.subInput"
            :placeholder="i18n.ts._connectionEditContent.paramNamePlaceholder"
            :aria-label="i18n.ts._connectionEditContent.queryParam"
            :error="shownErrors.queryParam"
          />
          <label :class="$style.radio">
            <input v-model="authKind" type="radio" value="basic" />
            <span>{{ i18n.ts._connectionEditContent.basicAuth }}</span>
          </label>
          <FormInput
            v-if="authKind === 'basic'"
            v-model="basicUsername"
            :class="$style.subInput"
            :placeholder="i18n.ts._connectionEditContent.username"
            :aria-label="i18n.ts._connectionEditContent.username"
          />
        </div>
      </div>
    </div>

    <div :class="$style.divider" />

    <!-- シークレット -->
    <div :class="$style.section">
      <div :class="$style.sectionHeader">
        <i class="ti ti-key" :class="$style.sectionIcon" />
        <span :class="$style.sectionTitle">{{ i18n.ts._connectionEditContent.secret }}</span>
      </div>

      <div v-if="hasSecret && !showSecretInput" :class="$style.secretStatus">
        <span>{{ i18n.ts._connectionEditContent.secretSet }}</span>
        <button
          class="_button"
          :class="$style.rotateBtn"
          @click="rotatingSecret = true"
        >
          <i class="ti ti-refresh" />
          {{ i18n.ts._connectionEditContent.rotateSecret }}
        </button>
      </div>

      <label v-if="showSecretInput" :class="$style.field">
        <span :class="$style.label">{{ secretLabel }}</span>
        <FormInput
          v-model="secretInput"
          type="password"
          :placeholder="i18n.ts._connectionEditContent.secretPlaceholder"
          autocomplete="off"
          :error="shownErrors.secret"
        />
        <a
          v-if="secretHelpUrl"
          :href="secretHelpUrl"
          target="_blank"
          rel="noopener"
          :class="$style.helpLink"
        >
          {{ i18n.ts._connectionEditContent.openIssueGuide }}
        </a>
      </label>
    </div>

    <div :class="$style.divider" />

    <!-- 詳細 -->
    <div :class="$style.details">
      <button
        class="_button"
        :class="$style.summary"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        <i class="ti ti-chevron-down nd-chevron" :class="{ 'nd-chevron-closed': !advancedOpen }" />
        {{ i18n.ts._connectionEditContent.advanced }}
      </button>
      <CollapseBox :open="advancedOpen" keep-alive>
        <div :class="$style.section">
          <label :class="$style.field">
            <span :class="$style.label">{{ i18n.ts._connectionEditContent.allowedHosts }}</span>
            <FormInput
              v-model="allowedHostsText"
              :placeholder="i18n.ts._connectionEditContent.allowedHostsPlaceholder"
            />
          </label>
          <label :class="$style.field">
            <span :class="$style.label">{{ i18n.ts._connectionEditContent.notes }}</span>
            <FormInput
              v-model="notes"
              multiline
              rows="2"
              :placeholder="i18n.ts._connectionEditContent.notesPlaceholder"
            />
          </label>
          <label :class="$style.toggleRow">
            <input v-model="exposedAi" type="checkbox" />
            <span>
              <span :class="$style.toggleLabel">{{ i18n.ts._connectionEditContent.exposeAi }}</span>
              <span :class="$style.toggleHint">
                {{ i18n.ts._connectionEditContent.exposeAiHint }}
              </span>
            </span>
          </label>
          <div v-if="exposedAi && !aiVaultUseEnabled" :class="$style.gateChip">
            <i class="ti ti-info-circle" />
            {{ i18n.ts._connectionEditContent.aiVaultUseDisabled }}
          </div>
          <label :class="[$style.toggleRow, $style.toggleSub, !exposedAi && $style.toggleDisabled]">
            <input v-model="trustedAi" type="checkbox" :disabled="!exposedAi" />
            <span>
              <span :class="$style.toggleLabel">{{ i18n.ts._connectionEditContent.trustAi }}</span>
              <span :class="$style.toggleHint">
                {{ i18n.ts._connectionEditContent.trustAiHint }}
              </span>
            </span>
          </label>
          <label :class="$style.toggleRow">
            <input v-model="exposedPlugin" type="checkbox" />
            <span>
              <span :class="$style.toggleLabel">{{ i18n.ts._connectionEditContent.exposePlugin }}</span>
              <span :class="$style.toggleHint">
                {{ i18n.ts._connectionEditContent.exposePluginHint }}
              </span>
            </span>
          </label>
          <div v-if="exposedPlugin && !pluginVaultUseEnabled" :class="$style.gateChip">
            <i class="ti ti-info-circle" />
            {{ i18n.ts._connectionEditContent.pluginVaultUseDisabled }}
          </div>
          <div
            v-if="exposedPlugin && trustedPlugins.length > 0"
            :class="$style.trustedPluginList"
          >
            <span :class="$style.toggleHint">
              {{ i18n.ts._connectionEditContent.trustedPlugins }}
            </span>
            <div
              v-for="tp in trustedPlugins"
              :key="tp.id"
              :class="$style.trustedPluginRow"
            >
              <i class="ti ti-puzzle" />
              <span :class="$style.trustedPluginName">{{ tp.name || tp.id }}</span>
              <button
                class="_button"
                :class="$style.revokeBtn"
                :title="i18n.ts._connectionEditContent.revokeTrust"
                @click="revokeTrustedPlugin(tp.id)"
              >
                <i class="ti ti-x" />
              </button>
            </div>
          </div>
          <label :class="$style.toggleRow">
            <input v-model="exposedExternal" type="checkbox" />
            <span>
              <span :class="$style.toggleLabel">{{ i18n.ts._connectionEditContent.exposeExternal }}</span>
              <span :class="$style.toggleHint">
                {{ i18n.ts._connectionEditContent.exposeExternalHint }}
              </span>
            </span>
          </label>
          <div v-if="exposedExternal && !externalVaultUseEnabled" :class="$style.gateChip">
            <i class="ti ti-info-circle" />
            {{ i18n.ts._connectionEditContent.externalVaultUseDisabled }}
          </div>
          <label :class="[$style.toggleRow, $style.toggleSub, !exposedExternal && $style.toggleDisabled]">
            <input v-model="trustedExternal" type="checkbox" :disabled="!exposedExternal" />
            <span>
              <span :class="$style.toggleLabel">{{ i18n.ts._connectionEditContent.trustExternal }}</span>
              <span :class="$style.toggleHint">
                {{ i18n.ts._connectionEditContent.trustExternalHint }}
              </span>
            </span>
          </label>
        </div>
      </CollapseBox>
    </div>

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
        {{ testing ? i18n.ts._connectionEditContent.testing : i18n.ts._connectionEditContent.test }}
      </button>
      <button
        class="_button"
        :class="$style.saveBtn"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? i18n.ts._common.saving : i18n.ts._common.save }}
      </button>
      <button
        v-if="!isNew"
        class="_button"
        :class="$style.deleteBtn"
        @click="remove"
      >
        {{ i18n.ts._common.delete }}
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
  // 詳細トグルを開くと窓の max-height を超えることがある — 超過分をスクロール
  // に流す (PermissionsContent と同じパターン)
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
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
  font-weight: var(--nd-weight-bold);
  font-size: var(--nd-font-body);
  color: var(--nd-fg);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: var(--nd-font-sm);
  color: var(--nd-fgMuted);
}

.subInput {
  margin-left: 22px;

  input {
    padding: 6px 8px;
    font-size: var(--nd-font-sm);
  }
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
  font-size: var(--nd-font-sm);
  color: var(--nd-fg);
  cursor: pointer;
}

.secretStatus {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--nd-font-md);
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
  font-size: var(--nd-font-sm);
  cursor: pointer;
}

.helpLink {
  font-size: var(--nd-font-xs);
  color: var(--nd-link);
}

.details {
  margin: 0;
}

.summary {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  font-size: var(--nd-font-md);
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

// 「AI からのアクセスを許可」の下にぶら下がるサブトグル。階層を視覚的に示す。
.toggleSub {
  margin-top: 8px;
  padding-left: 22px;
}

// 信頼済みプラグイン個体の一覧 (開示トグルの下にぶら下がる)
.trustedPluginList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  padding-left: 22px;
}

.trustedPluginRow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--nd-font-sm);
  color: var(--nd-fg);

  i {
    color: var(--nd-fgMuted);
  }
}

.trustedPluginName {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.revokeBtn {
  @include nd-interactive;
  display: flex;
  align-items: center;
  padding: 2px 4px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fgMuted);
  cursor: pointer;

  &:hover {
    color: var(--nd-love);
  }
}

.toggleDisabled {
  cursor: default;
  opacity: 0.45;
}

// 二段 gate の受動表示 chip (#712 §6.3)
.gateChip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 6px;
  font-size: var(--nd-font-sm);
  color: var(--nd-fg);
  opacity: 0.65;

  i {
    flex-shrink: 0;
  }
}

.toggleLabel {
  display: block;
  font-size: var(--nd-font-md);
  color: var(--nd-fg);
}

.toggleHint {
  display: block;
  font-size: var(--nd-font-xs);
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
  font-size: var(--nd-font-md);
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
  font-size: var(--nd-font-md);
  cursor: pointer;
}

.divider {
  height: 1px;
  background: var(--nd-divider);
  margin: 16px 0;
}

.testResult {
  margin: 12px 0 0;
  font-size: var(--nd-font-sm);
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
  font-size: var(--nd-font-sm);
  color: var(--nd-love);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  border-radius: var(--nd-radius-sm);
}
</style>
