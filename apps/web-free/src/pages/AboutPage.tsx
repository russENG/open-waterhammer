/**
 * 公共設計コモンズ（Open Civil Design）説明ページ
 */
export function AboutPage() {
  return (
    <div className="page-about">
      <section className="about-hero">
        <div className="about-hero-inner">
          <div className="about-badge-row">
            <span className="header-badge">OSS</span>
            <span className="about-badge-agpl">AGPL-3.0</span>
          </div>
          <h2 className="about-title">社会基盤設計コモンズ</h2>
          <p className="about-subtitle">Open Civil Design</p>
          <p className="about-tagline">
            農業土木・社会インフラの設計計算をオープンソース化し、<br />
            行政・コンサルタント・研究者・市民が共有できる知識基盤をつくる
          </p>
        </div>
      </section>

      <section className="about-section">
        <h3 className="about-section-title">なぜ計算ロジックをコモンズに置くのか</h3>
        <div className="about-card">
          <p>
            公共のインフラを設計するとき、その計算には公的な基準があります。基準そのものは公開された文書です。一方、その計算手順を実装したソフトウェアは、これまで主に商用パッケージとして流通してきました。
          </p>
          <p>
            設計の「信用」はどこから来るのでしょうか。実務の現実を見ると、ソフトウェアに支払う対価は、計算の正しさそのものよりも、「万一のときに『○○のソフトで計算した』と言える」責任所在の担保として働いてきた面があります。合理的な仕組みではありますが、信用の根拠が <strong>計算ロジックの中身</strong> ではなく <strong>どのブランドにお金を払ったか</strong> に置かれている、ということでもあります。
          </p>
          <p>
            このプロジェクトは、信用のもう一つの作り方を試しています。「対価を払ったブランド」ではなく、「<strong>ソースコードを誰でも読み、独立に検証できること</strong>」を信用の土台に置く。設計者も、行政も、研究者も、それぞれの立場から計算根拠に直接触れて、検証や改善に手を出せる。そういう道を社会に用意したいという発想です。
          </p>
          <p>
            オープンソース運動には、この発想の祖先がいます。Eric S. Raymond は <em>The Cathedral and the Bazaar</em>（1999）で、いわゆる Linus の法則 — <strong>「十分な目があれば、すべてのバグは浅い」</strong> — を示しました。少数の専門家が閉じた中で品質を保つ「大聖堂」型に対し、多数の検証者が開かれた場で並列に関わる「バザール」型のほうが、結果として誤りを早く露見させる。設計計算にも、同じことが言えるはずです。
          </p>
          <p>
            Lawrence Lessig は <em>The Future of Ideas</em>（2001）で、社会の創造性は、物理層・コード層・コンテンツ層のそれぞれにコモンズ（共有資源）が残っているかにかかっている、と論じました。設計基準に書かれた計算式は、そもそも公共財です。<strong>公共財として書かれた式の実装が、共有資源として置かれている。</strong> その状態のほうが、社会的にも技術的にも筋が通っています。
          </p>
          <p>
            AI 技術の発展は、この発想を後押ししています。設計基準に準拠した計算ロジックを実装し、検証し、ドキュメント化する作業は、これまで相応の人手と時間を要するものでした。個人の技術者が片手間に手を出せる規模ではなかった。今は違います。本プロジェクト自身、Claude をはじめとする AI の支援を受けて開発されています。AI は人の判断を置き換えるものではありませんが、個人が手の届く範囲を着実に広げます。コモンズへの貢献の敷居が下がり、より多くの目が、より深く、コードに触れられるようになる。<strong>「十分な目」を集める話であると同時に、その目を持つ人を増やす話でもあります。</strong>
          </p>
          <p>
            最後に大事な区別を一つ。このプロジェクトは <strong>信用</strong> の作り方を変えますが、<strong>設計責任</strong> の所在を変えるものではありません。計算結果を使うとき、最終的な責任は設計を行う技術者または組織に帰属します。変えたいのは、その責任を負うときに手元にある「根拠の見え方」です。閉じた実装の出力を信じるしかない状態から、根拠そのものを読んで判断できる状態へ。これが、計算ロジックをコモンズに置くことの、最も実務的な意味です。
          </p>
        </div>
      </section>

      <section className="about-section">
        <h3 className="about-section-title">なぜ AGPL-3.0 なのか</h3>
        <div className="about-card">
          <p>
            オープンソースのライセンスには多くの選択肢があります。MIT のように「自由に使ってください」と短く書く寛容型、GPL のように「派生物も同じライセンスで配布してください」と求めるコピーレフト型、そして AGPL のようにそれを <strong>ネットワーク経由の利用</strong> にまで広げる型。本プロジェクトが採用しているのは AGPL-3.0 です。なぜか。
          </p>
          <p>
            GPL と AGPL の違いは、一見すると小さく見えます。GPL は、ソフトウェアを <strong>配布</strong> するときに、ソースコードの開示を求めます。手元のバイナリを誰かに渡したら、ソースも一緒に渡す。シンプルな仕組みです。
          </p>
          <p>
            ところが、ウェブで動くソフトウェアにはこの仕組みが効きません。ユーザーはバイナリを受け取らず、ブラウザを通じてサーバー上のソフトウェアにアクセスするだけだからです。GPL のソフトウェアでも、サーバーに置いてウェブサービスとして提供する分には、ソースコード開示の義務は発生しない。「<strong>ネットワーク・ギャップ</strong>」と呼ばれるこの抜け道を埋めるのが AGPL です。AGPL のソフトウェアをネットワーク越しにユーザーへ提供したとき、サービス提供者にもソースコード開示の義務が生じます。
          </p>
          <p>
            設計計算のような分野では、このギャップは重要な意味を持ちます。計算ツールはウェブサービスとして提供しやすく、誰かが本プロジェクトのコードをフォークして、独自に手を加え、閉じたウェブサービスとして再配布する — そんな展開がごく自然に起こり得ます。GPL ではそれを止められません。AGPL であれば、その派生サービスもまたソースコードを開示することになり、コモンズの輪は閉じずに続きます。
          </p>
          <p>
            これは制約ではあります。AGPL のコードを商用サービスに組み込めば、その商用サービス側にもソースコード開示が求められる。寛容型のライセンスに比べれば、組み込みのハードルは確かに高い。けれども、本プロジェクトが守りたいのは「<strong>いま公開されている</strong>」という状態ではなく、「<strong>公開され続けている</strong>」という状態です。設計基準に書かれた計算式が公共財であるなら、その実装も公共財であり続けるべきです。AGPL-3.0 は、その「であり続ける」を制度的に支える仕組みです。
          </p>
        </div>
      </section>

      <section className="about-section">
        <h3 className="about-section-title">設計原則</h3>
        <div className="about-principles">
          <div className="about-principle-card">
            <div className="about-principle-icon">透明性</div>
            <h4>計算根拠の完全開示</h4>
            <p>
              すべての計算結果には、使用した式・パラメータ・仮定・準拠条文を明示します。
              「なぜこの値になるか」をユーザーが追跡できるようにします。
            </p>
          </div>
          <div className="about-principle-card">
            <div className="about-principle-icon">準拠性</div>
            <h4>設計基準との整合</h4>
            <p>
              「土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）」ほか、
              公的な設計基準に準拠した実装を目指します。
              逸脱がある場合は明示します。
            </p>
          </div>
          <div className="about-principle-card">
            <div className="about-principle-icon">再現性</div>
            <h4>独立検証可能</h4>
            <p>
              計算ロジックはコアパッケージ（<code>@open-waterhammer/core</code>）として分離し、
              Node.js・ブラウザ・CI テストで独立検証できます。
            </p>
          </div>
          <div className="about-principle-card">
            <div className="about-principle-icon">教育性</div>
            <h4>学習・研究利用</h4>
            <p>
              計算手法（特性曲線法・中心差分法など）の理解を助けるため、
              中間値・時系列・チャートを可視化します。
              大学・研究機関での活用を歓迎します。
            </p>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h3 className="about-section-title">対象とするインフラ領域</h3>
        <div className="about-card">
          <div className="about-scope-grid">
            <div className="about-scope-item about-scope-active">
              <span className="about-scope-status about-scope-status--active">実装済</span>
              <strong>農業用パイプライン</strong>
              <span>水撃圧計算（数値解析・経験式）</span>
            </div>
            <div className="about-scope-item about-scope-planned">
              <span className="about-scope-status about-scope-status--planned">計画中</span>
              <strong>農業用水路</strong>
              <span>開水路水理計算</span>
            </div>
            <div className="about-scope-item about-scope-planned">
              <span className="about-scope-status about-scope-status--planned">計画中</span>
              <strong>ため池・貯水施設</strong>
              <span>洪水調節・越流解析</span>
            </div>
            <div className="about-scope-item about-scope-planned">
              <span className="about-scope-status about-scope-status--planned">計画中</span>
              <strong>排水路・暗渠</strong>
              <span>管水路・不圧流計算</span>
            </div>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h3 className="about-section-title">コントリビューション</h3>
        <div className="about-card">
          <p>
            バグ報告・機能提案・コードレビューは GitHub Issues / Pull Request にてお待ちしています。
          </p>
          <div className="about-links">
            <a
              href="https://github.com/OpenCivilDesign/open-waterhammer"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              GitHub リポジトリ
            </a>
            <a
              href="https://github.com/OpenCivilDesign/open-waterhammer/blob/main/docs/contributing.md"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              コントリビューションガイド
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
