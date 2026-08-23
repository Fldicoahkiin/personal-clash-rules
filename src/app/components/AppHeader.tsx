export function AppHeader() {
  return (
    <header className="site-header">
      <div className="header-inner page-width">
        <a className="brand" href="#top" aria-label="返回页面顶部">
          <img src="/brand/flacier-mark.svg" alt="" />
          <span>Flacierの订阅转换</span>
        </a>
        <nav aria-label="页面导航">
          <a href="#subscription">转换</a>
          <a href="#tester">规则测试</a>
          <a href="#rules">规则集</a>
          <a href="#converter">格式转换</a>
        </nav>
        <a
          className="header-github"
          href="https://github.com/Fldicoahkiin/personal-clash-rules"
          target="_blank"
          rel="noreferrer"
          aria-label="打开 GitHub 仓库"
        >
          <img src="/brand/github-mark.svg" alt="" width="18" height="18" />
          <span>GitHub</span>
        </a>
      </div>
    </header>
  );
}
