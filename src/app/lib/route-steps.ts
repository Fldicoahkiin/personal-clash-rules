import type { RouteMatch } from "./rule-matcher";
import { describePolicyRoute } from "./policy-groups";

type RouteStepKind = "station" | "signal" | "switch" | "terminal";
type RouteSignalState = "pass" | "stop" | null;

export interface RouteStep {
  label: string;
  value: string;
  detail: string;
  status: string;
  machine: boolean;
  state: RouteSignalState;
  kind: RouteStepKind;
}

export function createRouteSteps(result: RouteMatch | null): RouteStep[] {
  const policyRoute = result ? describePolicyRoute(result.policy) : null;
  return [
    {
      label: "网址",
      value: result?.hostname || "—",
      detail: "",
      status: "",
      machine: true,
      state: null,
      kind: "station",
    },
    {
      label: "规则",
      value: result
        ? result.matched
          ? result.rule
          : "未命中具体规则"
        : "—",
      detail: result
        ? result.matched
          ? result.ruleSetLabel
          : "转入 MATCH"
        : "",
      status: result ? (result.matched ? "通过" : "未通过") : "",
      machine: true,
      state: result ? (result.matched ? "pass" : "stop") : null,
      kind: "signal",
    },
    {
      label: "策略",
      value: policyRoute?.route || "—",
      detail: result?.policy || "",
      status: "",
      machine: true,
      state: null,
      kind: "switch",
    },
    {
      label: "结果",
      value: policyRoute?.target || "—",
      detail: policyRoute?.mode || "",
      status: "",
      machine: true,
      state: null,
      kind: "terminal",
    },
  ];
}
