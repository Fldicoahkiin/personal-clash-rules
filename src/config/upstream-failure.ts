export type UpstreamFailure = {
  status: number;
  challenge: boolean;
  cloudflare: boolean;
  responseType: "html" | "json" | "other";
  rayId?: string;
  redirects: number;
  checkedAt: string;
};
