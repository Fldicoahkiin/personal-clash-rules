import type { ClientId } from "../../lib/client-import";
import type { OutputTarget } from "./api";

export interface ClientFormat {
  target: OutputTarget;
  name: string;
  icon?: string;
  clientId?: ClientId;
}

export const completeConfigFormats: ClientFormat[] = [
  {
    target: "clash-party-config",
    name: "Clash Party",
    icon: "/client-icons/clash-party.png",
    clientId: "clash-party",
  },
  {
    target: "mihomo-config",
    name: "Mihomo",
    icon: "/client-icons/mihomo.png",
    clientId: "mihomo",
  },
  {
    target: "stash-config",
    name: "Stash",
    icon: "/client-icons/stash.png",
    clientId: "stash-config",
  },
  {
    target: "surge-config",
    name: "Surge",
    icon: "/client-icons/surge.png",
    clientId: "surge-config",
  },
  {
    target: "surfboard-config",
    name: "Surfboard",
    icon: "/client-icons/surfboard.png",
    clientId: "surfboard-config",
  },
  {
    target: "loon-config",
    name: "Loon",
    icon: "/client-icons/loon.png",
    clientId: "loon-config",
  },
  {
    target: "egern-config",
    name: "Egern",
    icon: "/client-icons/egern.png",
    clientId: "egern-config",
  },
  {
    target: "sing-box-config",
    name: "sing-box",
    icon: "/client-icons/sing-box.png",
  },
];

export const nodeResourceFormats: ClientFormat[] = [
  { target: "stash", name: "Stash", icon: "/client-icons/stash.png" },
  { target: "surge", name: "Surge", icon: "/client-icons/surge.png" },
  { target: "loon", name: "Loon", icon: "/client-icons/loon.png", clientId: "loon" },
  {
    target: "quantumult-x",
    name: "Quantumult X",
    icon: "/client-icons/quantumult-x.png",
    clientId: "quantumult-x",
  },
  {
    target: "sing-box",
    name: "sing-box",
    icon: "/client-icons/sing-box.png",
    clientId: "sing-box",
  },
  {
    target: "shadowrocket",
    name: "Shadowrocket",
    icon: "/client-icons/shadowrocket.png",
    clientId: "shadowrocket",
  },
  { target: "egern", name: "Egern", icon: "/client-icons/egern.png", clientId: "egern" },
  {
    target: "surfboard",
    name: "Surfboard",
    icon: "/client-icons/surfboard.png",
    clientId: "surfboard",
  },
];

export const secondaryFormats: ClientFormat[] = [
  { target: "mihomo", name: "Mihomo 节点", icon: "/client-icons/mihomo.png" },
  { target: "clash", name: "Clash" },
  { target: "v2ray", name: "V2Ray" },
  { target: "uri", name: "URI" },
  { target: "json", name: "JSON" },
];
