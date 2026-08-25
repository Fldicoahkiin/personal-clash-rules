import {
  ArrowUpRight,
  Broadcast,
  CloudCheck,
  GlobeHemisphereWest,
  ShieldCheck,
} from "@phosphor-icons/react";

const checks = [
  {
    description: "DNS 服务器",
    href: "https://browserleaks.com/dns",
    icon: ShieldCheck,
    name: "DNS 泄漏",
  },
  {
    description: "浏览器本地地址",
    href: "https://browserleaks.com/webrtc",
    icon: Broadcast,
    name: "WebRTC",
  },
  {
    description: "IPv4 / IPv6",
    href: "https://test-ipv6.com/",
    icon: GlobeHemisphereWest,
    name: "IPv6",
  },
  {
    description: "DoH / DoT 连接",
    href: "https://1.1.1.1/help",
    icon: CloudCheck,
    name: "Cloudflare",
  },
] as const;

export function NetworkChecks() {
  return (
    <section className="network-checks page-width" id="network" aria-labelledby="network-title">
      <header className="plain-heading">
        <h2 id="network-title">网络检测</h2>
        <p>连接代理后打开检测页。</p>
      </header>
      <ul>
        {checks.map((check) => {
          const Icon = check.icon;
          return (
            <li key={check.href}>
              <a href={check.href} target="_blank" rel="noreferrer">
                <Icon aria-hidden="true" />
                <span>
                  <strong>{check.name}</strong>
                  <small>{check.description}</small>
                </span>
                <ArrowUpRight aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
