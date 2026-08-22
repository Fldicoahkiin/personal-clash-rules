import { ArrowLeft, GithubLogo } from "@phosphor-icons/react";

export function ControlHeader() {
  return (
    <header className="control-header">
      <a className="control-brand" href="/">
        <img src="/brand/flacier-mark.svg" alt="" />
        <span>Flacierの订阅转换</span>
      </a>
      <nav aria-label="管理页导航">
        <a href="/">
          <ArrowLeft aria-hidden="true" />
          规则页面
        </a>
        <a
          href="https://github.com/Fldicoahkiin/personal-clash-rules"
          target="_blank"
          rel="noreferrer"
        >
          <GithubLogo aria-hidden="true" weight="fill" />
          GitHub
        </a>
      </nav>
    </header>
  );
}
