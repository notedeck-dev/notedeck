/**
 * Self-XSS 対策メッセージ (#994)。
 *
 * devtools はリリース版でも開けるままにする方針なので、「サポートです。この
 * 文字列をコンソールに貼り付けてください」という誘導への警告をコンソール自身
 * に出す。文面と配色は Misskey 本家の完全再現
 * (packages/frontend/src/boot/common.ts + locales/ja-JP.yml の
 * _selfXssPrevention)。本家 WebUI を見慣れたユーザーが同じ警告として認識できる
 * ことを優先している。
 */
export function printSelfXssWarning(): void {
  console.log(
    '%c警告',
    'color: #f00; background-color: #ff0; font-size: 36px; padding: 4px;',
  )
  console.log(
    '%c「この画面に何か貼り付けろ」はすべて詐欺です。',
    'color: #f00; font-weight: 900; font-family: "Hiragino Sans W9", "Hiragino Kaku Gothic ProN", sans-serif; font-size: 24px;',
  )
  console.log(
    '%cここに何かを貼り付けると、悪意のあるユーザーにアカウントを乗っ取られたり、個人情報を盗まれたりする可能性があります。',
    'font-size: 16px; font-weight: 700;',
  )
  console.log(
    '%c貼り付けようとしているものが何なのかを正確に理解していない場合は、%c今すぐ作業を中止してこのウィンドウを閉じてください。',
    'font-size: 16px;',
    'font-size: 20px; font-weight: 700; color: #f00;',
  )
  console.log(
    '詳しくはこちらをご確認ください。 https://misskey-hub.net/docs/for-users/resources/self-xss/',
  )
}
