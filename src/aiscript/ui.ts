import { utils, values } from '@syuilo/aiscript'
import type { Value } from '@syuilo/aiscript/interpreter/value.js'

// --- 型定義（旧 ui-types.ts を統合） ---

export type UiComponentType =
  | 'text'
  | 'mfm'
  | 'button'
  | 'buttons'
  | 'textInput'
  | 'textarea'
  | 'numberInput'
  | 'switch'
  | 'select'
  | 'container'
  | 'folder'
  | 'postFormButton'
  | 'postForm'
  | 'spacer'

export interface UiComponent {
  id: string
  type: UiComponentType
  props: Record<string, unknown>
  children?: UiComponent[]
}

// --- 内部ヘルパー ---

let componentIdCounter = 0
function genComponentId(): string {
  return `ais-${Date.now()}-${++componentIdCounter}`
}

// valToJs 相当の変換だが、ネストした fn を '<function>' に潰さず VFn のまま残す。
// Ui:C:buttons の buttons 配列内 onClick など、props 直下以外のイベントハンドラは
// AiScriptUiRenderer の callHandler が VFn を期待するためこちらを使う。
function valToJsPreservingFn(val: Value): unknown {
  if (val.type === 'fn') return val
  if (val.type === 'arr') {
    return (val.value as Value[]).map(valToJsPreservingFn)
  }
  if (val.type === 'obj') {
    const obj: Record<string, unknown> = {}
    for (const [k, v] of val.value as Map<string, Value>) {
      obj[k] = valToJsPreservingFn(v)
    }
    return obj
  }
  return utils.valToJs(val)
}

function valueToUiComponent(val: Value): UiComponent | null {
  if (val.type !== 'obj') return null
  const obj = val.value as Map<string, Value>
  const typeVal = obj.get('type')
  const propsVal = obj.get('props')
  const idVal = obj.get('id')
  if (!typeVal || typeVal.type !== 'str') return null

  const id = idVal?.type === 'str' ? idVal.value : genComponentId()
  const props: Record<string, unknown> = {}

  let children: UiComponent[] | undefined

  if (propsVal?.type === 'obj') {
    const propsMap = propsVal.value as Map<string, Value>
    for (const [k, v] of propsMap) {
      if (k === 'children' && v.type === 'arr') {
        children = (v.value as Value[])
          .map(valueToUiComponent)
          .filter((c): c is UiComponent => c !== null)
      } else if (v.type === 'fn') {
        // Keep VFn as-is for event handlers
        props[k] = v
      } else {
        props[k] = valToJsPreservingFn(v)
      }
    }
  }

  // Also check top-level children (fallback)
  if (!children) {
    const childrenVal = obj.get('children')
    if (childrenVal?.type === 'arr') {
      children = (childrenVal.value as Value[])
        .map(valueToUiComponent)
        .filter((c): c is UiComponent => c !== null)
    }
  }

  return { id, type: typeVal.value as UiComponent['type'], props, children }
}

function _createUiConstructor(type: string): Value {
  return values.FN_NATIVE(([propsVal]) => {
    const id = genComponentId()
    const obj = new Map<string, Value>()
    obj.set('type', values.STR(type))
    obj.set('id', values.STR(id))
    if (propsVal?.type === 'obj') {
      obj.set('props', propsVal)
    } else {
      obj.set('props', values.OBJ(new Map()))
    }
    return values.OBJ(obj)
  })
}

// --- パブリック API ---

export interface UiCallbacks {
  onRender: (components: UiComponent[]) => void
}

/**
 * Ui:* API を Record<string, Value> で返す。
 * Interpreter の consts に spread して使う。
 *
 * componentRegistry は呼び出しごとにインスタンス化（グローバル共有しない）。
 */
export function createAiScriptUiLib(
  callbacks: UiCallbacks,
): Record<string, Value> {
  const consts: Record<string, Value> = {}
  const componentRegistry = new Map<string, Value>()

  // Re-render: root の children を UiComponent[] に変換して onRender
  function reRender() {
    const rootVal = consts['Ui:root']
    if (rootVal?.type !== 'obj') return
    const rootObj = rootVal.value as Map<string, Value>
    const propsVal = rootObj.get('props')
    if (propsVal?.type !== 'obj') return
    const propsMap = propsVal.value as Map<string, Value>
    const childrenVal = propsMap.get('children')
    if (childrenVal?.type !== 'arr') return
    const components = (childrenVal.value as Value[])
      .map(valueToUiComponent)
      .filter((c): c is UiComponent => c !== null)
    callbacks.onRender(components)
  }

  // コンポーネントに update メソッドを付与して登録
  function createComponentValue(
    type: string,
    id: string,
    propsVal: Value,
  ): Value {
    const obj = new Map<string, Value>()
    obj.set('type', values.STR(type))
    obj.set('id', values.STR(id))
    obj.set(
      'props',
      propsVal?.type === 'obj' ? propsVal : values.OBJ(new Map()),
    )
    obj.set(
      'update',
      values.FN_NATIVE(([newPropsVal]) => {
        if (newPropsVal?.type !== 'obj') return
        const currentProps = obj.get('props')
        if (currentProps?.type === 'obj') {
          const currentMap = currentProps.value as Map<string, Value>
          const newMap = newPropsVal.value as Map<string, Value>
          for (const [k, v] of newMap) {
            currentMap.set(k, v)
          }
        } else {
          obj.set('props', newPropsVal)
        }
        reRender()
      }),
    )
    const val = values.OBJ(obj)
    componentRegistry.set(id, val)
    return val
  }

  // --- Ui:root ---
  consts['Ui:root'] = createComponentValue(
    'container',
    genComponentId(),
    values.OBJ(new Map()),
  )

  // --- Ui:render ---
  consts['Ui:render'] = values.FN_NATIVE(([componentsVal]) => {
    if (componentsVal?.type !== 'arr') return
    // root の children を設定
    const rootVal = consts['Ui:root']
    if (rootVal?.type === 'obj') {
      const rootObj = rootVal.value as Map<string, Value>
      const propsVal = rootObj.get('props')
      if (propsVal?.type === 'obj') {
        ;(propsVal.value as Map<string, Value>).set('children', componentsVal)
      }
    }
    // 子コンポーネントをレジストリに登録
    const registerChildren = (arr: Value[]) => {
      for (const v of arr) {
        if (v.type !== 'obj') continue
        const vObj = v.value as Map<string, Value>
        const idVal = vObj.get('id')
        if (idVal?.type === 'str') {
          componentRegistry.set(idVal.value, v)
        }
        const pVal = vObj.get('props')
        if (pVal?.type === 'obj') {
          const ch = (pVal.value as Map<string, Value>).get('children')
          if (ch?.type === 'arr') registerChildren(ch.value as Value[])
        }
      }
    }
    registerChildren(componentsVal.value as Value[])
    reRender()
  })

  // --- Ui:get ---
  consts['Ui:get'] = values.FN_NATIVE(([idVal]) => {
    if (idVal?.type !== 'str') return values.NULL
    return componentRegistry.get(idVal.value) ?? values.NULL
  })

  // --- Ui:C:* constructors ---
  const uiTypes = [
    'text',
    'mfm',
    'button',
    'buttons',
    'textInput',
    'textarea',
    'numberInput',
    'switch',
    'select',
    'container',
    'folder',
    'postFormButton',
    'postForm',
    'spacer',
  ]
  for (const type of uiTypes) {
    consts[`Ui:C:${type}`] = values.FN_NATIVE(([propsVal]) => {
      const id = genComponentId()
      return createComponentValue(type, id, propsVal as Value)
    })
  }

  return consts
}
