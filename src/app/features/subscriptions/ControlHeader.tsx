import { ArrowLeft, GithubLogo, SignOut } from "@phosphor-icons/react";
import type { FC } from "react";

type ControlHeaderProps = {
  onExit?: () => void;
};

export const ControlHeader: FC<ControlHeaderProps> = ({ onExit }) => {
  return (
    <header className="control-header">
      <a className="control-brand" href="/">
        <img src="/brand/flacier-mark.svg" alt="" />
        <span>订阅转换</span>
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
        {onExit ? (
          <button type="button" onClick={onExit}>
            <SignOut aria-hidden="true" />
            退出
          </button>
        ) : null}
      </nav>
    </header>
  );
};
