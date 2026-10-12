import type { UpstreamFailure } from "../config/upstream-failure";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly upstream?: UpstreamFailure,
  ) {
    super(message);
  }
}
