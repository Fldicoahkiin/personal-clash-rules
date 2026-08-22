import { App } from "./App";
import { SubscriptionConsole } from "./features/subscriptions/SubscriptionConsole";

export function Root() {
  if (window.location.pathname === "/manage" || window.location.pathname.startsWith("/manage/")) {
    return <SubscriptionConsole />;
  }
  return <App />;
}
