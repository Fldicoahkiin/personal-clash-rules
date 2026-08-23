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
      label: "命中规则",
      value: result?.rule || "—",
      detail: result?.ruleSetLabel || "",
      status: result ? (result.matched ? "通过" : "未通过") : "",
      machine: true,
      state: result ? (result.matched ? "pass" : "stop") : null,
      kind: "signal",
    },
    {
      label: "策略组",
      value: policyRoute?.route || "—",
      detail: "",
      status: "",
      machine: true,
      state: null,
      kind: "switch",
    },
    {
      label: "去向",
      value: policyRoute?.target || "—",
      detail: policyRoute?.mode || "",
      status: "",
      machine: true,
      state: null,
      kind: "terminal",
    },
  ];
}
