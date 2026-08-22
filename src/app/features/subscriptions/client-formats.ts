import type { ClientId } from "../../lib/client-import";
import type { OutputTarget } from "./api";

export interface ClientFormat {
  target: OutputTarget;
  name: string;
  icon?: string;
  clientId?: ClientId;
}

export const primaryClientFormats: ClientFormat[] = [
  { target: "mihomo", name: "Mihomo", icon: "/client-icons/mihomo.png", clientId: "mihomo" },
  { target: "stash", name: "Stash", icon: "/client-icons/stash.png", clientId: "stash" },
  { target: "surge", name: "Surge", icon: "/client-icons/surge.png", clientId: "surge" },
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
  { target: "clash", name: "Clash" },
  { target: "v2ray", name: "V2Ray" },
  { target: "uri", name: "URI" },
  { target: "json", name: "JSON" },
];
