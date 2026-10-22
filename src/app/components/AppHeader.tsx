import { useEffect, useLayoutEffect, useRef, useState } from "react";

const sections = [
  { id: "subscription", label: "转换" },
  { id: "network", label: "网络检测" },
  { id: "tester", label: "规则测试" },
  { id: "groups", label: "分流线路" },
  { id: "converter", label: "格式转换" },
] as const;

export function AppHeader() {
  const [active, setActive] = useState<string>(sections[0].id);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // A section is current while it crosses a thin band just below the sticky header.
    const observer = new IntersectionObserver(entries => {
      const current = entries.find(entry => entry.isIntersecting);
      if (current) setActive(current.target.id);
    }, { rootMargin: "-30% 0px -65% 0px" });
    for (const { id } of sections) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    function place() {
      const link = nav!.querySelector<HTMLAnchorElement>(`a[href="#${active}"]`);
      if (!link) return;
      setIndicator({ left: link.offsetLeft, width: link.offsetWidth });
      // On narrow screens the bar scrolls sideways; keep the current item in view without moving the page.
      if (nav!.scrollWidth > nav!.clientWidth) nav!.scrollTo({ left: link.offsetLeft - (nav!.clientWidth - link.offsetWidth) / 2 });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [active]);

  return (
    <header className="site-header">
      <div className="header-inner page-width">
        <a className="brand" href="#top" aria-label="返回页面顶部">
          <img src="/brand/flacier-mark.svg" alt="" />
          <span>Flacierの订阅转换</span>
        </a>
        <nav aria-label="页面导航" ref={navRef}>
          {sections.map(section => (
            <a key={section.id} href={`#${section.id}`} aria-current={active === section.id ? "location" : undefined}>
              {section.label}
            </a>
          ))}
          <span
            className="nav-indicator"
            aria-hidden="true"
            style={indicator ? { width: indicator.width, transform: `translateX(${indicator.left}px)` } : { opacity: 0 }}
          />
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
