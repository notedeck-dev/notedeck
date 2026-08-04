<template>
  <!-- Hub features セクション: 中央見出し + acrylic カードグリッド -->
  <section id="features" class="hub-section w-secondary">
    <div class="section-head" data-fade>
      <h2 class="section-title"><b class="u-line">機能</b></h2>
    </div>
    <div class="cards-grid" data-fade>
      <div class="card acrylic">
        <span class="chip">デッキ UI</span>
        <h3>自由に並べる、自分だけのレイアウト</h3>
        <p>
          ホーム・ローカル・通知・検索・リスト・アンテナ・チャンネル・チャット —
          あらゆるカラムを横に並べて一覧。幅はドラッグで自由に調整、並びは「プロファイル」として保存してワンクリックで切り替え。
        </p>
        <ul class="card-list">
          <li>16 種類以上のカラムタイプ</li>
          <li>複数アカウントの通知・検索を統合表示</li>
          <li>カラムをポップアウトして別ウィンドウ化</li>
          <li>PiP（常に手前の小窓）でマルチモニター活用</li>
        </ul>
      </div>
      <div class="card acrylic">
        <span class="chip">オフラインでも</span>
        <h3>流れたノートも、ここに残る</h3>
        <p>
          タイムラインに流れてきたノートは自動でローカル SQLite
          に蓄積。サーバーからノートが消えても、連合が切れても、手元のデータは残り続けます。
        </p>
        <ul class="card-list">
          <li>全文検索で過去のノートを一瞬で発見</li>
          <li>オフラインモード切り替えでバッテリー節約</li>
          <li>DB ファイルのコピーで丸ごとバックアップ</li>
          <li>サーバーが消えても投稿は手元に残る</li>
        </ul>
      </div>
      <div class="card acrylic">
        <span class="chip">あんしん</span>
        <h3>ログイン情報は、OS が守る</h3>
        <p>
          アカウントの鍵になるトークンは、ブラウザ内保存ではなく OS のキーチェーン（macOS
          Keychain / Windows
          資格情報マネージャーなど）に暗号化して保管。アプリの中に平文で置かない設計です。
        </p>
        <ul class="card-list">
          <li>OS のキーチェーンで暗号化保管</li>
          <li>使い終わったトークンはメモリからも消去</li>
          <li>ローカル API は外部サイトからのアクセスを遮断</li>
          <li>
            対策の詳細は
            <a href="https://github.com/notedeck-dev/notedeck/blob/main/SECURITY.md">SECURITY</a>
            で公開
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
