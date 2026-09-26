// i18nDictionary.test.ts の自己検査用。3 行目と 6 行目だけが違反
declare const i18n: { ts: { a: string }; tsx: { b: () => string } }
export const LABEL = i18n.ts.a
export const ok = () => i18n.ts.a
export class Holder {
  field = i18n.tsx.b()
  method() {
    return i18n.ts.a
  }
}
