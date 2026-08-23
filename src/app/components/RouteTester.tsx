import { ArrowRight, TrainSimple } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";

import {
  loadPublishedRuleSets,
  matchUrl,
  type LoadedRuleSet,
  type RouteMatch,
} from "../lib/rule-matcher";
import { describePolicyRoute } from "../lib/policy-groups";

const sampleUrl = "https://api.openai.com/v1/models";

const featuredRules = [
  { name: "AI", policy: "AI" },
  { name: "Apple", policy: "APPLE" },
  { name: "Steam", policy: "STEAM" },
  { name: "Discord", policy: "DISCORD" },
  { name: "Bilibili", policy: "BILIBILI" },
  { name: "AniGamer", policy: "ANIGAMER" },
];

export function RouteTester() {
  const [input, setInput] = useState(sampleUrl);
  const [ruleSets, setRuleSets] = useState<LoadedRuleSet[]>([]);
  const [result, setResult] = useState<RouteMatch | null>(null);
  const [message, setMessage] = useState("规则加载中");
  const [resultVersion, setResultVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    void loadPublishedRuleSets(controller.signal)
      .then((loaded) => {
        setRuleSets(loaded);
        setResult(matchUrl(sampleUrl, loaded));
        setResultVersion(1);
        setMessage("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          setMessage("规则加载超时");
          return;
        }
        setMessage(error instanceof Error ? error.message : "规则加载失败");
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  function testRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ruleSets.length === 0) {
      return;
    }
    try {
      setResult(matchUrl(input, ruleSets));
      setResultVersion((current) => current + 1);
      setMessage("");
    } catch {
      setMessage("请输入网址或域名");
    }
  }

  const policyRoute = result ? describePolicyRoute(result.policy) : null;
  const steps = [
    {
      label: "输入地址",
      value: result?.hostname || "—",
      detail: "",
      machine: true,
      state: null,
      terminal: false,
    },
    {
      label: "命中规则",
      value: result?.rule || "—",
      detail: result
        ? result.matched
          ? result.ruleSetLabel
          : "默认规则"
        : "",
      machine: true,
      state: result ? (result.matched ? "pass" : "stop") : null,
      terminal: false,
    },
    {
      label: "策略组",
      value: result?.policy || "—",
      detail: policyRoute
        ? policyRoute.route.includes(" → ")
          ? `默认 ${policyRoute.route.split(" → ")[1]}`
          : "固定策略"
        : "",
      machine: true,
      state: null,
      terminal: false,
    },
    {
      label: "处理方式",
      value: policyRoute?.target || "—",
      detail: policyRoute?.mode || "",
      machine: true,
      state: null,
      terminal: true,
    },
  ];

  return (
    <section className="route-section page-width" id="tester" aria-labelledby="page-title">
      <div className="route-main">
        <div className="route-intro">
          <h1 id="page-title">网址怎么处理</h1>
          <p>命中规则、策略组、处理方式。</p>
        </div>

        <form className="route-form" onSubmit={testRoute}>
          <label htmlFor="route-url">网址</label>
          <input
            id="route-url"
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck="false"
            autoComplete="off"
          />
          <button type="submit" disabled={ruleSets.length === 0}>
            检查
            <ArrowRight aria-hidden="true" />
          </button>
        </form>

        <div className="route-result" aria-live="polite" key={resultVersion}>
          <ol className="route-steps" aria-label="网址规则处理路线">
            {steps.map((step) => (
              <li key={step.label}>
                <div className="route-step-copy">
                  <span className="route-step-label">{step.label}</span>
                  <strong
                    className={
                      [
                        "route-value",
                        step.machine ? "route-value-machine" : "",
                        step.terminal ? "route-value-terminal" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")
                    }
                  >
                    {step.value}
                  </strong>
                  {step.detail ? (
                    <small className="route-step-detail">{step.detail}</small>
                  ) : null}
                </div>
                <div className="route-track-stop">
                  {step.state ? (
                    <span
                      className={
                        step.state === "pass"
                          ? "route-signal route-signal-pass"
                          : "route-signal route-signal-stop"
                      }
                    >
                      <i aria-hidden="true" />
                      <b>{step.state === "pass" ? "通过" : "未通过"}</b>
                    </span>
                  ) : null}
                  <span
                    className={
                      step.terminal
                        ? "route-node route-node-terminal"
                        : "route-node"
                    }
                    aria-hidden="true"
                  >
                    {step.terminal ? <TrainSimple weight="fill" /> : null}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {message ? <p className="route-message">{message}</p> : null}
      </div>

      <aside className="route-index" aria-label="规则索引">
        <div className="index-block">
          <h2>常用规则</h2>
          <div className="index-head" aria-hidden="true">
            <span>规则</span>
            <span>默认</span>
          </div>
          <ul>
            {featuredRules.map((item) => {
              const route = describePolicyRoute(item.policy);
              return (
                <li key={item.name}>
                  <span>{item.name}</span>
                  <code>{route.mode}</code>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </section>
  );
}
