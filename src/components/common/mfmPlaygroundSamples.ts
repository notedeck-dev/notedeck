// MFM プレイグラウンド (Dev Dashboard の MFM プレビュー #977 / MFM エディタカラム) に
// 載せるサンプル。UI 文言ではなく MFM のデータなので辞書には置かない
// (scripts/i18n-lint.ts の EXEMPT_FILES)。中身は自作。他人の投稿は入れない

export interface MfmPlaygroundSample {
  id: 'basic' | 'syntax' | 'functions' | 'animations' | 'art' | 'edge'
  text: string
}

const BASIC = `**太字** <i>斜体</i> ~~打ち消し~~ <small>小さく</small>
> 引用 **引用の中の太字**
<center>中央寄せ</center>
@syuilo @ai@misskey.io #Misskey #ミスキー
https://misskey-hub.net/ja/docs/ [リンク **太字**](https://example.com)
:misskey: :ai_yay: 👍 🍮
\`inline code\` \\(E = mc^2\\)
\`\`\`js
const hello = "world";
\`\`\`
misskey 検索

$[tada tada] $[jelly jelly] $[twitch twitch] $[shake shake] $[jump jump] $[bounce bounce]
$[spin spin] $[spin.left spin.left] $[spin.x spin.x] $[spin.y,speed=0.5s spin.y]
$[flip flip] $[flip.v flip.v] $[flip.h,v flip.h,v]
$[x2 x2] $[x3 x3] $[x4 x4]
$[font.serif serif] $[font.monospace monospace] $[font.cursive cursive]
$[blur blur] $[rainbow rainbow] $[sparkle sparkle]
$[rotate.deg=30 rotate] $[position.x=1,y=0.5 position] $[scale.x=2,y=1 scale]
$[fg.color=f80 fg] $[bg.color=8cf bg] $[border.style=dashed,color=f0f,radius=8,width=2 border]
$[ruby 漢字 かんじ] $[ruby $[fg.color=f00 赤] あか]
$[unixtime 1700000000]
$[clickable.ev=hello クリックできる]
$[unknown 未知の関数]
<plain>**plain** :misskey:</plain>`

const SYNTAX = `<plain>**plain** :misskey: @ai #tag $[x2 a]</plain>
**太字** __太字__ <b>太字</b> *斜体* _斜体_ <i>斜体</i> ~~打ち消し~~ <s>打ち消し</s> <small>小さく</small>
**太字の中の<i>斜体</i>と~~打ち消し~~と\`code\`と:misskey:**
> 引用 **太字** @ai https://example.com
> > 入れ子の引用
<center>中央 **太字** :misskey:</center>
@ai @syuilo @ai@misskey.io @user@例え.jp @user@xn--r8jz45g.jp
#Misskey #ミスキー #tag_123 #tag(括弧) #絵文字👍
https://misskey-hub.net/ja/docs/?a=1&b=2#top https://例え.jp/パス <https://example.com/a(b)c> https://example.com/p(paren)
[リンク](https://example.com) [**太字**と:misskey:](https://example.com/a) ?[サイレント](https://example.com/s) [@ai #tag](https://example.com)
:misskey: :nonexistent_emoji: :misskey::misskey:
👍 ☺ ☺️ © ©️ 1️⃣ 🇯🇵 👍🏽 👨‍👩‍👧‍👦 🏳️‍🌈
\`inline code\` \`<b>タグ</b>\` \`\` \` \`\`
\\(E = mc^2\\) \\(\\frac{1}{2}\\)
\\[\\sum_{i=1}^n i\\]
\`\`\`js
const a = "hello"; // コメント
\`\`\`
\`\`\`aiscript
let x = "hello"
<: \`{x} world\`
\`\`\`
\`\`\`unknownlang
plain text
\`\`\`
\`\`\`
言語なし	タブ	区切り
\`\`\`
misskey 検索
mfm Search
ミスキー [検索]
example [Search]`

const FUNCTIONS = `$[tada tada] $[tada.speed=2s,delay=0.5s 遅延] $[jelly jelly] $[jelly.speed=0.5s 速い]
$[twitch twitch] $[shake shake] $[jump jump] $[bounce bounce]
$[spin spin] $[spin.left 左] $[spin.alternate 往復] $[spin.x 縦] $[spin.y 横] $[spin.x,left,speed=3s 組み合わせ]
$[flip 左右] $[flip.v 上下] $[flip.h,v 両方]
$[x2 x2] $[x3 x3] $[x4 x4] $[x2 $[x2 二重]] $[x4 $[x4 $[x4 三重]]] $[x4 :misskey:]
$[scale.x=2,y=1 横 2 倍] $[scale.x=0.5,y=3 縦 3 倍] $[scale.x=10,y=10 上限] $[scale.x=-1 反転] $[scale 指定なし]
$[position.x=1,y=0.5 移動] $[position.x=-2 左] $[position 指定なし]
$[rotate 指定なし] $[rotate.deg=30 30 度] $[rotate.deg=-45 負]
$[fg.color=f00 3 桁] $[fg.color=f80a 4 桁] $[fg.color=ff8800 6 桁] $[fg.color=red 不正] $[fg 未指定]
$[bg.color=8cf 3 桁] $[bg.color=ffcc00 6 桁] $[bg 未指定]
$[font.serif serif] $[font.monospace mono] $[font.cursive cursive] $[font.fantasy fantasy] $[font.emoji emoji] $[font.math math] $[font 未指定]
$[blur ぼかし] $[rainbow 虹] $[rainbow.speed=3s 遅い虹] $[sparkle キラキラ]
$[border 指定なし] $[border.style=dashed,color=f0f,radius=8,width=2 破線] $[border.style=dotted 点線] $[border.style=double,width=4 二重] $[border.style=groove,width=4 groove] $[border.style=ridge,width=4 ridge] $[border.style=inset,width=4 inset] $[border.style=outset,width=4 outset] $[border.style=hidden 非表示] $[border.style=invalid 不正] $[border.radius=99,noclip $[x2 はみ出し]]
$[ruby 漢字 かんじ] $[ruby $[fg.color=f00 赤] あか] $[ruby **太字** ふとじ]
$[unixtime 1700000000] $[unixtime 0] $[unixtime 9999999999] $[unixtime abc]
$[clickable.ev=hello クリック] $[clickable ev 未指定]
$[unknown 未知の関数] $[tada.speed=abc 不正な時間] $[x2.foo=bar 未知の引数]
$[x2 $[fg.color=f00 $[spin $[border.radius=4 入れ子]]]]`

// 動きのある fn を speed / delay の組み合わせごとに並べる。位相をずらした列は
// delay が効いていないと全部同時に動くのでひと目で分かる
const ANIMATIONS = `$[spin 🍣] $[spin.speed=0.5s 🍣] $[spin.speed=3s 🍣] $[spin.left 🍣] $[spin.alternate 🍣] $[spin.x 🍣] $[spin.y 🍣] $[spin.x,left 🍣] $[spin.y,alternate 🍣]
$[shake 🍣] $[shake.speed=2s 🍣] $[twitch 🍣] $[twitch.speed=2s 🍣]
$[jump 🍣] $[jump.speed=2s 🍣] $[bounce 🍣] $[bounce.speed=2s 🍣]
$[tada 🍣] $[tada.speed=3s 🍣] $[jelly 🍣] $[jelly.speed=3s 🍣]
$[rainbow 虹] $[rainbow $[fg.color=0f0 緑から]] $[rainbow 🍣] $[sparkle キラキラ] $[sparkle $[x2 🍣]]
$[jump.delay=0s 🍣]$[jump.delay=-0.15s 🍣]$[jump.delay=-0.3s 🍣]$[jump.delay=-0.45s 🍣]$[jump.delay=-0.6s 🍣]
$[spin.speed=2s,delay=0s 🍣]$[spin.speed=2s,delay=-0.5s 🍣]$[spin.speed=2s,delay=-1s 🍣]$[spin.speed=2s,delay=-1.5s 🍣]
$[x3 $[spin $[tada $[jelly 🍣]]]] $[x2 $[shake $[rainbow 二重]]] $[scale.x=2,y=2 $[bounce 🍣]]
$[blur ホバーで見える] $[blur $[spin 🍣]]`

// 本家のアートと同じ道具 (position / scale / rotate / bg / border / 負の scale /
// 大きな position) だけで組んだ自作の絵。本家で同じに見えるかを見る
const ART = `<center>
$[position.y=2.2 $[scale.x=9,y=3 $[bg.color=2a4 $[border.width=0,radius=3 　]]]]
$[position.x=-3,y=-1 $[scale.x=1.6,y=1.6 $[fg.color=fc0 $[spin.speed=8s ☀️]]]]
$[position.x=2,y=-0.5 $[scale.x=3,y=1 $[bg.color=fff $[border.width=0,radius=12 　]]]]
$[position.y=0.5 $[scale.x=-2,y=2 $[fg.color=840 🌳]]]
$[position.y=0.5 $[scale.x=2,y=2 $[fg.color=840 🌳]]]
$[position.y=1.6 $[jump.speed=1.5s $[scale.x=1.5,y=1.5 🚶]]]
$[position.x=-1000 $[spin.speed=6s $[position.x=1000 $[fg.color=f00 ✈️]]]]

$[position.y=1 $[bg.color=222 $[fg.color=fff $[border.width=0,radius=4 $[scale.x=1.2,y=1.2 **こんにちは**]]]]]
</center>`

const EDGE = `長い URL https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
長い単語 Pneumonoultramicroscopicsilicovolcanoconiosis_Pneumonoultramicroscopicsilicovolcanoconiosis
	タブ字下げ  連続空白  末尾空白


<script>alert(1)</script> &amp; &lt;b&gt;
[javascript](javascript:alert(1)) javascript:alert(1) ftp://example.com/file
なななな ナナ なんなん 나나 morning everyone
<plain>なな</plain> \`なな\` [なな](https://example.com) > なな
**@ai #tag https://example.com :misskey: 👍**
$[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg $[fg 深い]]]]]]]]]]]]]]]]]]]]]]]]]
$[position.x=99999 遠く] $[scale.x=99 広く] $[unixtime 99999999999999999]`

export const MFM_PLAYGROUND_SAMPLES: readonly MfmPlaygroundSample[] = [
  { id: 'basic', text: BASIC },
  { id: 'syntax', text: SYNTAX },
  { id: 'functions', text: FUNCTIONS },
  { id: 'animations', text: ANIMATIONS },
  { id: 'art', text: ART },
  { id: 'edge', text: EDGE },
]

/** 関数一覧タブ: 本家 mfm-renderer が描く 24 種の fn を 1 行ずつ */
export const MFM_PLAYGROUND_FUNCTION_ROWS: readonly string[] = [
  '$[tada text]',
  '$[jelly text]',
  '$[twitch text]',
  '$[shake text]',
  '$[spin text]',
  '$[spin.left,speed=3s text]',
  '$[spin.x,alternate text]',
  '$[jump text]',
  '$[bounce text]',
  '$[flip text]',
  '$[flip.v text]',
  '$[x2 text]',
  '$[x3 text]',
  '$[x4 text]',
  '$[font.serif text]',
  '$[font.monospace text]',
  '$[blur text]',
  '$[rainbow text]',
  '$[sparkle text]',
  '$[rotate.deg=30 text]',
  '$[position.x=1,y=-0.5 text]',
  '$[scale.x=2,y=1.5 text]',
  '$[fg.color=f80 text]',
  '$[bg.color=8cf text]',
  '$[border.style=dashed,color=f0f,radius=8,width=2 text]',
  '$[ruby text ruby]',
  '$[unixtime 1700000000]',
  '$[clickable.ev=hello text]',
]
