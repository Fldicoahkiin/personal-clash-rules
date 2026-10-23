import { ArrowUpRight, CaretRight, Check, DownloadSimple } from "@phosphor-icons/react";
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { exitPath } from "../lib/policy-groups";
import { plainName } from "../lib/route-sections";
import { useRuleManifest, type RuleSetInfo } from "../lib/rule-files";
import { routeStations, stationAt, stationPositions, stationTitle, type RouteStation, type StationMatch } from "../lib/route-stations";
import { RouteStationDetail } from "./RouteStationDetail";

const widePanelQuery = "(min-width: 1100px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(widePanelQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const inlineRuleLabels: Record<string, string> = {
  "PROCESS-NAME": "进程",
  "PROCESS-NAME-REGEX": "进程",
  DOMAIN: "域名",
  "DOMAIN-SUFFIX": "域名",
  GEOIP: "GEOIP",
  MATCH: "其余所有流量",
};

function stationSummary(station: RouteStation, manifest: ReadonlyMap<string, RuleSetInfo> | null): string {
  const parts = new Map<string, number>();
  for (const rule of station.rules) {
    const label = rule.provider
      ? manifest?.get(rule.provider.id)?.label ?? rule.provider.id
      : rule.type === "GEOIP" ? `GEOIP ${rule.value}` : inlineRuleLabels[rule.type] ?? rule.type;
    parts.set(label, (parts.get(label) ?? 0) + 1);
  }
  const summary = [...parts].map(([label, count]) => count > 1 ? `${label} ${count}` : label).join("、");
  // "📥 Apple 下载" over "Apple 下载" says nothing new.
  return summary === stationTitle(station).replace(/^[^\p{L}\p{N}]+/u, "") ? "" : summary;
}

function stationState(station: RouteStation, match: StationMatch | null): "passed" | "hit" | "uncertain" | undefined {
  if (!match) return undefined;
  if (station.last < match.position) return "passed";
  if (station.first <= match.position) return match.uncertain ? "uncertain" : "hit";
  return undefined;
}

export function RouteMap({ match, focus, onTest }: {
  match: StationMatch | null;
  focus: { position: number; id: number } | null;
  onTest: (host: string) => void;
}) {
  const manifest = useRuleManifest();
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(widePanelQuery).matches, () => false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const selected = routeStations.find(station => station.id === selectedId) ?? null;

  useEffect(() => {
    const station = focus ? stationAt(focus.position) : undefined;
    if (!station) return;
    setSelectedId(station.id);
    window.requestAnimationFrame(() => document.getElementById(station.id)?.scrollIntoView({ block: "center" }));
  }, [focus]);

  function select(station: RouteStation) {
    // Narrow screens open details in place, so a second tap closes them.
    setSelectedId(current => (!wide && current === station.id ? null : station.id));
  }

  function moveSelection(event: KeyboardEvent<HTMLOListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".route-map-stop-button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = Math.min(buttons.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
    buttons[next].focus();
    if (wide) setSelectedId(routeStations[next].id);
  }

  const detail = (station: RouteStation) => (
    <RouteStationDetail
      key={station.id}
      station={station}
      manifest={manifest}
      onTest={onTest}
      onSelect={item => {
        setSelectedId(item.id);
        if (!wide) window.requestAnimationFrame(() => document.getElementById(item.id)?.scrollIntoView({ block: "start" }));
      }}
    />
  );

  return (
    <section className="route-map page-width" id="groups" aria-labelledby="groups-title">
      <header className="plain-heading route-map-heading">
        <div>
          <h2 id="groups-title">分流线路</h2>
          <p>Flacier 规则按从上到下的顺序匹配，命中第一条即停止。</p>
        </div>
        <div className="route-map-actions">
          <a className="button button-primary" href="/overrides/clash-party.yaml" download="flacier-clash-party.yaml">
            <DownloadSimple aria-hidden="true" />
            Mihomo 覆写
          </a>
          <a className="button button-secondary" href="/rules/manifest.yaml" target="_blank" rel="noreferrer">
            规则目录
            <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
      </header>

      <div className="route-map-body" data-tested={match ? "" : undefined}>
        <ol className="route-map-list" ref={listRef} onKeyDown={moveSelection} aria-label="规则匹配顺序">
          {routeStations.map((station, index) => {
            const exit = exitPath(station.policy);
            const state = stationState(station, match);
            const isSelected = station === selected;
            const summary = stationSummary(station, manifest);
            return (
              <li
                key={station.id}
                id={station.id}
                className="route-map-station"
                data-state={state}
                data-direct={exit.direct || undefined}
                data-selected={isSelected || undefined}
                style={{ "--station-index": index } as CSSProperties}
              >
                <button
                  className="route-map-stop-button"
                  type="button"
                  aria-expanded={isSelected}
                  aria-controls={wide ? "route-map-panel" : `${station.id}-detail`}
                  onClick={() => select(station)}
                >
                  <span className="route-map-position">{station.first === station.last ? station.first : `${station.first}–${station.last}`}</span>
                  <span className="route-map-stop" aria-hidden="true">{state === "hit" ? <Check weight="bold" /> : null}</span>
                  <span className="badge" data-mode={exit.direct ? "直连" : "代理"}>{exit.direct ? "直连" : "代理"}</span>
                  <span className="route-map-name">
                    <strong>{plainName(stationTitle(station))}</strong>
                    {summary ? <small>{summary}</small> : null}
                  </span>
                  <span className="route-map-exit">{exit.names.slice(1).map(plainName).join(" → ") || plainName(exit.names[0])}</span>
                  <CaretRight className="route-map-caret" aria-hidden="true" />
                </button>
                {!wide && isSelected ? (
                  <div className="route-map-inline" id={`${station.id}-detail`}>
                    <div>{detail(station)}</div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        {wide ? (
          <aside className="route-map-panel" id="route-map-panel" aria-live="polite">
            {selected ? detail(selected) : (
              <div className="route-map-guide">
                <h3>怎么读这条线路</h3>
                <p>流量从第 1 条规则开始向下匹配，命中就停止，不再看后面的规则。所以同一个域名出现在两组时，排在前面的那组生效。</p>
                <ul>
                  <li><span className="badge" data-mode="直连">直连</span>默认直连，实心圆点</li>
                  <li><span className="badge" data-mode="代理">代理</span>默认走代理，空心圆点</li>
                </ul>
                <p>选择左侧任意一站，查看用途、默认出口、全部规则和示例域名；示例可以直接送进规则测试。键盘上用 ↑ ↓ 切换。</p>
                <p className="route-map-guide-count">共 {routeStations.length} 站、{routeStations.at(-1)!.last} 条规则，{stationPositions(routeStations.at(-1)!)}兜底。</p>
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
