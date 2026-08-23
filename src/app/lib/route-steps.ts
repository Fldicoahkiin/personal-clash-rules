import type { RouteMatch } from "./rule-matcher";
import { describePolicyRoute } from "./policy-groups";

type RouteStepKind = "input" | "rule" | "result";
type RouteStepState = "pass" | "stop" | null;

export interface RouteStep {
  label: string;
  value: string;
  detail: string;
  status: string;
  machine: boolean;
  state: RouteStepState;
  kind: RouteStepKind;
}

export function createRouteSteps(result: RouteMatch | null): RouteStep[] {
  const policyRoute = result ? describePolicyRoute(result.policy) : null;
  return [
    {
      label: "输入网址",
      value: result?.hostname || "—",
      detail: "",
      status: "",
      machine: true,
      state: null,
      kind: "input",
    },
    {
      label: "命中规则",
      value: result?.rule || "—",
      detail: result?.ruleSetLabel || "",
      status: result ? (result.matched ? "通过" : "未通过") : "",
      machine: true,
      state: result ? (result.matched ? "pass" : "stop") : null,
      kind: "rule",
    },
    {
      label: "处理结果",
      value: policyRoute?.target || "—",
      detail: policyRoute?.route || "",
      status: "",
      machine: true,
      state: null,
      kind: "result",
    },
  ];
}
