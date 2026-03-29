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
        <h3 className="about-section-title">なぜ、このプロジェクトを始めたか</h3>
        <div className="about-card">
          <p>
            農業用パイプラインや水路の設計は、農林水産省が定める「土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）」に基づいて行われます。
            しかし、その基準に準拠した計算ロジックは多くの場合、閉じたソフトウェアの中に実装されており、
            計算式・仮定・数値積分手法が外部から検証できない状態に置かれています。
          </p>
          <p>
            これは設計の透明性・再現性・教育可能性という観点から望ましくありません。
            公共インフラの設計に使われる計算は、公共の知識として誰でも読み・検証し・改善できるべきです。
          </p>
          <p>
            <strong>社会基盤設計コモンズ</strong>は、その問題意識から始まりました。
            設計基準に準拠した計算ロジックをオープンソース（AGPL-3.0）として公開し、
            ウェブブラウザ上で誰でも試算できる環境を提供します。
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
              <span>水撃圧計算（MOC・経験式）</span>
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
        <h3 className="about-section-title">ライセンスと貢献</h3>
        <div className="about-card">
          <p>
            本プロジェクトは <strong>GNU Affero General Public License v3.0 (AGPL-3.0)</strong> で公開されています。
            計算ロジックを利用したウェブサービスを構築する場合も、ソースコードの開示が求められます。
            これにより、公共インフラ設計に使われる知識が継続的にコモンズに還元される仕組みを作ります。
          </p>
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
