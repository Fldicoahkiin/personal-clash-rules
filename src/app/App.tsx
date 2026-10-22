import { useState } from "react";
import type { RuleSelection } from "../config/rule-templates";

import { AppHeader } from "./components/AppHeader";
import { ConverterWorkspace } from "./components/ConverterWorkspace";
import { NetworkChecks } from "./components/NetworkChecks";
import { RouteMap } from "./components/RouteMap";
import { RouteTester } from "./components/RouteTester";
import { SubscriptionImport } from "./components/SubscriptionImport";
import { SiteVersion } from "./components/BuildDetails";
import type { BuildInfo } from "../config/build-info";
import type { StationMatch } from "./lib/route-stations";

declare const __BUILD_INFO__: BuildInfo;

export function App() {
  const [ruleSelection, setRuleSelection] = useState<RuleSelection>({ preset: "flacier", url: "" });
  const [testRequest, setTestRequest] = useState<{ host: string; id: number } | null>(null);
  const [match, setMatch] = useState<StationMatch | null>(null);
  const [focus, setFocus] = useState<{ position: number; id: number } | null>(null);
  return (
    <div className="app-shell" id="top">
      <AppHeader />
      <main>
        <SubscriptionImport onRuleSelectionChange={setRuleSelection} />
        <NetworkChecks />
        <RouteTester
          selection={ruleSelection}
          request={testRequest}
          onMatch={setMatch}
          onShowStation={position => setFocus({ position, id: Date.now() })}
        />
        <RouteMap
          match={match}
          focus={focus}
          onTest={host => {
            setTestRequest({ host, id: Date.now() });
            document.getElementById("tester")?.scrollIntoView({ block: "start" });
          }}
        />
        <ConverterWorkspace />
      </main>

      <footer className="site-footer page-width">
        <p>Flacierの订阅转换 · AGPL-3.0</p>
        <a
          href="https://github.com/Fldicoahkiin/personal-clash-rules"
          target="_blank"
          rel="noreferrer"
        >
          <img src="/brand/github-mark.svg" alt="" width="16" height="16" />
          GitHub
        </a>
        <SiteVersion build={__BUILD_INFO__} />
      </footer>
    </div>
  );
}
