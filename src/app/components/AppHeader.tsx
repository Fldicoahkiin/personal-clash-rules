import { useEffect, useLayoutEffect, useRef, useState } from "react";

const sections = [
  { id: "subscription", label: "转换" },
  { id: "network", label: "网络检测" },
  { id: "tester", label: "规则测试" },
  { id: "groups", label: "分流线路" },
  { id: "converter", label: "格式转换" },
] as const;

type Theme = "light" | "dark";
const darkQuery = "(prefers-color-scheme: dark)";

// The saved choice is applied before paint by /theme.js; without one the page follows the system.
function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia(darkQuery).matches ? "dark" : "light";
}

export function AppHeader() {
  const [active, setActive] = useState<string>(sections[0].id);
  const [theme, setTheme] = useState<Theme>(currentTheme);
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

  useEffect(() => {
    const query = window.matchMedia(darkQuery);
    const follow = () => setTheme(currentTheme());
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  function switchTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private windows can refuse storage; the choice then lasts for this page only.
    }
    setTheme(next);
  }

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
          {/* The slanted の tile from /brand/flacier-mark.svg, inlined so its colours follow the theme. */}
          <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
            <path className="brand-mark-tile" d="M7.18 2H47L40.82 46H1Z" />
            <path className="brand-mark-glyph" transform="translate(9.21 35.75) scale(0.03679 -0.03679)" d="M779 408Q779 321 745.5 236.5Q712 152 641.0 82.0Q570 12 455 -34L419 51Q512 90 569.5 146.5Q627 203 654.0 272.0Q681 341 681 416Q681 496 642.0 556.0Q603 616 517 632Q504 556 488.0 471.5Q472 387 449.0 307.0Q426 227 393.5 162.0Q361 97 316.0 58.5Q271 20 211 20Q155 20 120.0 50.5Q85 81 68.5 131.0Q52 181 52 241Q52 311 69.5 380.5Q87 450 121.0 512.5Q155 575 205.0 623.0Q255 671 320.5 699.0Q386 727 467 727Q554 727 613.5 701.0Q673 675 709.5 630.5Q746 586 762.5 528.5Q779 471 779 408ZM148 241Q150 179 167.5 150.5Q185 122 213 122Q244 122 270.5 151.0Q297 180 319.0 231.0Q341 282 359.5 347.5Q378 413 394.0 487.0Q410 561 423 636Q361 627 309.5 589.0Q258 551 221.5 494.5Q185 438 165.5 372.0Q146 306 148 241Z" />
          </svg>
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
        <div className="header-tools">
        <button type="button" className="header-theme" onClick={switchTheme} aria-label={theme === "dark" ? "切换到浅色" : "切换到深色"}>
          {theme === "dark" ? "浅色" : "深色"}
        </button>
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
      </div>
    </header>
  );
}
