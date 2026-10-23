import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";

import { routeSections, sectionAt, sectionExit } from "../lib/route-sections";
import type { StationMatch } from "../lib/route-stations";

const stepMs = 70;
const idleNote = "移到一组上看它管什么，点组名查看这组的每一条规则。";

// One packet walks the trunk to the matched section, the sections it passes dim, then the leader fills.
export function RouteOverview({ match, pending, rootRef, onOpenSection }: {
  match: StationMatch | null;
  /** Changes when a test starts; the root shows it is waiting until the next match arrives. */
  pending: number | null;
  rootRef: RefObject<HTMLSpanElement | null>;
  onOpenSection: (position: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [walk, setWalk] = useState<{ step: number; arrived: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const treeRef = useRef<HTMLOListElement>(null);
  const target = match ? routeSections.indexOf(sectionAt(match.position)!) : -1;

  useEffect(() => {
    if (pending === null) return;
    setBusy(true);
    // A failed rule load never produces a match; stop waiting rather than blink forever.
    const timer = window.setTimeout(() => setBusy(false), 15000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    setBusy(false);
    if (target < 0) {
      setWalk(null);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setWalk({ step: target, arrived: true });
      return;
    }
    let step = 0;
    setWalk({ step: 0, arrived: false });
    const timer = window.setInterval(() => {
      step += 1;
      if (step > target) {
        window.clearInterval(timer);
        setWalk({ step: target, arrived: true });
      } else setWalk({ step, arrived: false });
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [match, target]);

  // The packet and the coloured trunk follow the row centres, which depend on wrapping.
  const [trunk, setTrunk] = useState<{ top: number; bottom: number; centers: number[] }>({ top: 0, bottom: 0, centers: [] });
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const measure = () => {
      const rows = [...tree.querySelectorAll<HTMLElement>(":scope > li")];
      const centers = rows.map(row => row.offsetTop + row.offsetHeight / 2);
      // Beside the root the trunk starts at the first row; with the root stacked above it starts at the top.
      const root = rootRef.current?.getBoundingClientRect();
      const stacked = root !== undefined && root.bottom <= tree.getBoundingClientRect().top + 1;
      setTrunk({ top: stacked ? 0 : centers[0] ?? 0, bottom: tree.offsetHeight - (centers.at(-1) ?? 0), centers });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tree);
    return () => observer.disconnect();
  }, [rootRef]);

  const packetAt = walk ? trunk.centers[walk.step] : undefined;
  const note = hovered === null ? idleNote : `${routeSections[hovered].name}：${routeSections[hovered].note}`;

  return (
    <div className="overview" aria-labelledby="overview-title">
      <header className="overview-head">
        <h2 id="overview-title">分流</h2>
        <span>从上到下逐条匹配，命中即停</span>
      </header>
      <div className="overview-body">
        <span className="overview-root" data-busy={busy || undefined} ref={rootRef}>
          <span className="overview-in" aria-hidden="true">=&gt;</span>
          <span className="overview-node"><b aria-hidden="true">[</b> 请求 <b aria-hidden="true">]</b></span>
        </span>
        <ol
          className="overview-tree"
          ref={treeRef}
          aria-label="规则分组，按匹配顺序"
          style={{ "--trunk-top": `${trunk.top}px`, "--trunk-bottom": `${trunk.bottom}px` } as CSSProperties}
          onPointerLeave={() => setHovered(null)}
        >
          <span
            className="overview-path"
            aria-hidden="true"
            style={{ height: packetAt === undefined ? 0 : Math.max(0, packetAt - trunk.top) }}
          />
          <span
            className="overview-packet"
            aria-hidden="true"
            data-arrived={walk?.arrived || undefined}
            style={{ top: packetAt ?? 0, opacity: walk && !walk.arrived ? 1 : 0 }}
          />
          {routeSections.map((section, index) => {
            const state = walk?.arrived && index === target ? "hit" : walk && index < walk.step ? "passed" : undefined;
            const exit = sectionExit(section);
            return (
              <li
                key={section.id}
                data-state={state}
                aria-current={state === "hit" ? "step" : undefined}
                onPointerEnter={() => setHovered(index)}
              >
                <span className="overview-modes">
                  {section.modes.map(mode => <span key={mode} className="badge" data-mode={mode}>{mode}</span>)}
                </span>
                <button type="button" className="overview-name" onClick={() => onOpenSection(section.first)} onFocus={() => setHovered(index)}>
                  {section.name}
                </button>
                <span className="overview-range">{section.first === section.last ? `#${section.first}` : `#${section.first}-${section.last}`}</span>
                <span className="overview-leader" aria-hidden="true" data-direct={!exit || undefined}>
                  <span>{state === "hit" ? "=".repeat(120) : (exit ? "- " : ". ").repeat(60)}</span>
                </span>
                <span className="overview-exit">{exit}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="overview-note">{note}</p>
    </div>
  );
}
