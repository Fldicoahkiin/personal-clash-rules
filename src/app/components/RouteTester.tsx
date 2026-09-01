import { ArrowRight, Check } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";

import {
  loadPublishedRuleSets,
  matchUrl,
  type LoadedRuleSet,
  type RouteMatch,
} from "../lib/rule-matcher";
import { describePolicyRoute } from "../lib/policy-groups";
import { createRouteSteps } from "../lib/route-steps";

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

  const steps = createRouteSteps(result);

  return (
    <section className="route-section page-width" id="tester" aria-labelledby="tester-title">
      <div className="route-main">
        <div className="route-intro">
          <h2 id="tester-title">规则测试</h2>
          <p>输入网址，查看命中的规则和最终去向。</p>
        </div>

        <form className="route-form" onSubmit={testRoute}>
          <label htmlFor="route-url">测试网址</label>
          <input
            id="route-url"
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck="false"
            autoComplete="off"
          />
          <button type="submit" disabled={ruleSets.length === 0}>
            测试
            <ArrowRight aria-hidden="true" />
          </button>
        </form>

        <div className="route-result" aria-live="polite" key={resultVersion}>
          <span className="route-line" aria-hidden="true" />
          <ol className="route-steps" aria-label="规则处理过程">
            {steps.map((step) => {
              const [ruleType, ruleValue] =
                step.kind === "rule" ? step.value.split(",", 2) : ["", ""];

              return (
                <li
                  className={`route-step route-step-${step.kind}`}
                  key={step.label}
                >
                  <div className="route-step-copy">
                    <span className="route-step-label">{step.label}</span>
                    <div className="route-step-body">
                      <strong
                        className={
                          [
                            "route-value",
                            step.machine ? "route-value-machine" : "",
                            step.kind === "rule" ? "route-value-rule" : "",
                            step.kind === "result" ? "route-value-result" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")
                        }
                        aria-label={step.value}
                      >
                        {ruleValue ? (
                          <>
                            <span>{ruleType},</span>
                            <span>{ruleValue}</span>
                          </>
                        ) : (
                          step.value
                        )}
                      </strong>
                      {step.detail || (step.kind === "rule" && step.state) ? (
                        <span className="route-step-meta">
                          {step.detail ? (
                            <small className="route-step-detail">{step.detail}</small>
                          ) : null}
                          {step.kind === "rule" && step.state ? (
                            <small
                              className={
                                step.state === "matched"
                                  ? "route-status route-status-matched"
                                  : "route-status route-status-default"
                              }
                            >
                              {step.status}
                            </small>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="route-marker-row">
                    <span
                      className={[
                        "route-marker",
                        step.state ? `route-marker-${step.state}` : "",
                      ].filter(Boolean).join(" ")}
                      aria-label={step.kind === "rule" ? `规则${step.status}` : undefined}
                      aria-hidden={step.kind !== "rule"}
                    >
                      {step.kind === "rule" && step.state === "matched" ? (
                        <Check aria-hidden="true" />
                      ) : null}
                    </span>
                  </div>
                </li>
              );
            })}
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
