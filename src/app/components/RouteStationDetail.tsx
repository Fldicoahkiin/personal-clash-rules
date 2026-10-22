import { ArrowUpRight, Play } from "@phosphor-icons/react";
import { useState } from "react";

import { followsGlobalReason, groupNotes } from "../lib/group-notes";
import { exitPath, policyOptions } from "../lib/policy-groups";
import { exampleHosts, findOverlaps, useRuleFiles, type RuleFile, type RuleSetInfo } from "../lib/rule-files";
import { stationFamily, stationPositions, stationTitle, type RouteStation, type StationRule } from "../lib/route-stations";

// Partially read files show only their beginning in the expanded list.
const partialRuleLimit = 200;

function ruleText(rule: StationRule): string {
  return rule.value ? `${rule.type},${rule.value}` : rule.type;
}

function RuleList({ file }: { file: RuleFile }) {
  const [open, setOpen] = useState(false);
  let remaining = file.complete ? Infinity : partialRuleLimit;
  return (
    <details className="station-rule-list" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{file.complete ? `全部 ${file.count} 条规则` : `开头 ${Math.min(file.count, partialRuleLimit)} 条规则`}</summary>
      {/* Large lists render only while open. */}
      {open ? (
        <div className="station-rule-body">
          {file.header.length ? <p className="station-rule-header">{file.header.join("\n")}</p> : null}
          {file.sections.map((section, index) => {
            if (remaining <= 0) return null;
            const rules = section.rules.slice(0, remaining);
            remaining -= rules.length;
            return (
              <div key={index}>
                {section.title ? <p className="station-rule-section">{section.title}</p> : null}
                <ol>{rules.map(rule => <li key={rule}><code>{rule}</code></li>)}</ol>
              </div>
            );
          })}
          {file.complete ? null : <p className="station-rule-header">文件较大，页面只读取开头；完整内容请打开原文件。</p>}
        </div>
      ) : null}
    </details>
  );
}

function RuleFileBlock({ label, path, file, onTest }: {
  label: string;
  path: string;
  file: RuleFile | undefined;
  onTest: (host: string) => void;
}) {
  const examples = file ? exampleHosts(file) : [];
  return (
    <article className="station-file">
      <header>
        <strong>{label}</strong>
        <a href={path} target="_blank" rel="noreferrer">
          {path.slice(1)}
          <ArrowUpRight aria-hidden="true" />
        </a>
      </header>
      {file ? (
        <>
          <p className="station-file-stats">
            {file.complete ? `${file.count} 条` : "文件较大，只读取了开头"}
            {file.types.map(([type, count]) => <span key={type}>{type} {file.complete ? count : ""}</span>)}
          </p>
          {examples.length ? (
            <div className="station-examples" aria-label="示例域名">
              {examples.map(host => (
                <button type="button" key={host} onClick={() => onTest(host)} title={`在规则测试中测试 ${host}`}>
                  <Play aria-hidden="true" weight="fill" />
                  {host}
                </button>
              ))}
            </div>
          ) : null}
          <RuleList file={file} />
        </>
      ) : null}
    </article>
  );
}

export function RouteStationDetail({ station, manifest, onTest, onSelect }: {
  station: RouteStation;
  manifest: ReadonlyMap<string, RuleSetInfo> | null;
  onTest: (host: string) => void;
  onSelect: (station: RouteStation) => void;
}) {
  const note = groupNotes[station.policy];
  const exit = exitPath(station.policy);
  const options = policyOptions(station.policy);
  const family = stationFamily(station);
  const providers = station.rules.flatMap(rule => rule.provider ? [rule.provider] : []);
  const inline = station.rules.filter(rule => !rule.provider);
  const later = family.filter(item => item.first > station.last)
    .flatMap(item => item.rules.flatMap(rule => rule.provider ? [{ station: item, path: rule.provider.path }] : []));
  const { files, error, loading } = useRuleFiles([...providers.map(provider => provider.path), ...later.map(item => item.path)]);
  const laterFiles = later.flatMap(item => files.get(item.path) ?? []);
  const overlaps = providers.flatMap(provider => {
    const file = files.get(provider.path);
    return file ? findOverlaps(file, laterFiles) : [];
  });

  return (
    <div className="station-detail">
      <header className="station-detail-head">
        <p>{stationPositions(station)}</p>
        <h3>{stationTitle(station)}</h3>
        <p className="station-detail-purpose">{note.purpose}</p>
      </header>

      {family.length > 1 ? (
        <ol className="station-family" aria-label="同类规则的匹配顺序">
          {family.map(item => (
            <li key={item.id}>
              <button type="button" aria-current={item === station ? "step" : undefined} onClick={() => onSelect(item)}>
                <span>{item.first}</span>
                {stationTitle(item)}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <dl className="station-facts">
        <div>
          <dt>默认出口</dt>
          <dd>
            <span className="station-exit-path">
              {exit.names.map((name, index) => <span key={`${index}-${name}`}>{name}</span>)}
            </span>
            <span className="station-exit-mode" data-direct={exit.direct || undefined}>{exit.direct ? "直连" : "代理"}</span>
            <p>{note.defaultReason ?? followsGlobalReason}</p>
          </dd>
        </div>
        {note.orderNote || overlaps.length ? (
          <div>
            <dt>匹配顺序</dt>
            <dd>
              {note.orderNote ? <p>{note.orderNote}</p> : null}
              {overlaps.length ? (
                <ul className="station-overlaps">
                  {overlaps.map(overlap => {
                    const target = later.find(item => item.path === overlap.path)?.station;
                    return (
                      <li key={overlap.rule}>
                        <code>{overlap.rule}</code> 也会被后面{target ? `「${stationTitle(target)}」` : ""}的 <code>{overlap.coveredBy}</code> 命中，所以排在它前面。
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </dd>
          </div>
        ) : null}
        {options.length ? (
          <div>
            <dt>可选出口</dt>
            <dd className="station-options">
              {options.map((option, index) => <span key={option} data-default={index === 0 || undefined}>{option}</span>)}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="station-rules">
        <h4>规则</h4>
        {error ? <p className="station-error" role="alert">{error}</p> : null}
        {loading ? <p className="station-loading">正在读取规则文件</p> : null}
        {providers.map(provider => (
          <RuleFileBlock
            key={provider.path}
            label={manifest?.get(provider.id)?.label ?? provider.id}
            path={provider.path}
            file={files.get(provider.path)}
            onTest={onTest}
          />
        ))}
        {inline.length ? (
          <article className="station-file">
            <header><strong>配置内规则</strong><span>{inline.length} 条</span></header>
            <ol className="station-inline-rules">
              {inline.map(rule => <li key={rule.position}><span>{rule.position}</span><code>{ruleText(rule)}</code></li>)}
            </ol>
          </article>
        ) : null}
      </div>
    </div>
  );
}
