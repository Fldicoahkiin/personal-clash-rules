import { GithubLogo } from "@phosphor-icons/react";

export function AppHeader() {
  return (
    <header className="site-header">
      <div className="header-inner page-width">
        <a className="brand" href="#top" aria-label="返回页面顶部">
          <span>Flacier Rules</span>
        </a>
        <nav aria-label="页面导航">
          <a href="#tester">测试</a>
          <a href="#subscription">订阅</a>
          <a href="#converter">转换</a>
          <a href="#policies">策略</a>
          <a href="#rules">规则</a>
        </nav>
        <a
          className="header-github"
          href="https://github.com/Fldicoahkiin/personal-clash-rules"
          target="_blank"
          rel="noreferrer"
          aria-label="打开 GitHub 仓库"
        >
          <GithubLogo aria-hidden="true" weight="fill" />
          <span>GitHub</span>
        </a>
      </div>
    </header>
  );
}
