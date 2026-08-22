import { ArrowRight } from "@phosphor-icons/react";
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
      label: "网址",
      value: result?.hostname || "—",
      detail: "输入地址",
      machine: true,
      state: null,
    },
    {
      label: result
        ? result.matched
          ? "规则已命中"
          : "规则未命中"
        : "规则",
      value: result?.rule || "—",
      detail: result
        ? result.matched
          ? result.ruleSetLabel
          : "使用默认规则"
        : "",
      machine: true,
      state: result ? (result.matched ? "pass" : "stop") : null,
    },
    {
      label: "策略组",
      value: result?.policy || "—",
      detail: policyRoute
        ? policyRoute.route.includes(" → ")
          ? `默认 ${policyRoute.route.split(" → ")[1]}`
          : "固定路线"
        : "",
      machine: true,
      state: null,
    },
    {
      label: "最终路线",
      value: policyRoute
        ? `${policyRoute.target} · ${policyRoute.mode}`
        : "—",
      detail: "",
      machine: true,
      state: null,
    },
  ];

  return (
    <section className="route-section page-width" id="tester" aria-labelledby="page-title">
      <div className="route-main">
        <div className="route-intro">
          <h1 id="page-title">网址规则测试</h1>
          <p>输入网址，查看规则、策略组和最终路线。</p>
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
          <ol className="route-steps">
            {steps.map((step) => (
              <li key={step.label}>
                <span
                  className={
                    step.state
                      ? `route-step-label route-step-label-${step.state}`
                      : "route-step-label"
                  }
                >
                  {step.state ? (
                    <span className="route-signal-light" aria-hidden="true" />
                  ) : null}
                  {step.label}
                </span>
                <span
                  className={
                    step.state
                      ? `route-node route-node-${step.state}`
                      : "route-node"
                  }
                  aria-hidden="true"
                />
                <strong
                  className={
                    step.machine
                      ? "route-value route-value-machine"
                      : "route-value"
                  }
                >
                  {step.value}
                </strong>
                {step.detail ? (
                  <small className="route-step-detail">{step.detail}</small>
                ) : null}
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
