export function isRetryableReferenceCopyTransportError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /AbortError|TimeoutError|operation was aborted|timed?\s*out|timeout|unexpected status (?:404|408|409|425|429|5\d\d)|ECONNRESET|ECONNREFUSED|EPIPE|fetch failed|network/i.test(message);
}

export function isReferenceCopyTimeoutError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /AbortError|TimeoutError|operation was aborted|timed?\s*out|timeout/i.test(message);
}
