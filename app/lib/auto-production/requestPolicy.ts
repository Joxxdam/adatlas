const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostname(value: string) {
  const first = value.split(",")[0]?.trim() || "";
  if (first.startsWith("[")) return first.slice(0, first.indexOf("]") + 1).toLowerCase();
  return first.split(":")[0].toLowerCase();
}

export function isTrustedAutoProductionRequest(input: { url: string; host?: string | null; forwardedHost?: string | null; origin?: string | null; suppliedToken?: string | null; configuredToken?: string | null; mutation: boolean }) {
  const supplied = String(input.suppliedToken || "").trim();
  const configured = String(input.configuredToken || "").trim();
  if (configured && supplied && supplied === configured) return true;
  const url = new URL(input.url);
  if (!loopbackHosts.has(url.hostname.toLowerCase())) return false;
  if (!loopbackHosts.has(hostname(input.host || url.host))) return false;
  if (input.forwardedHost && !loopbackHosts.has(hostname(input.forwardedHost))) return false;
  if (input.origin) {
    try {
      if (!loopbackHosts.has(new URL(input.origin).hostname.toLowerCase())) return false;
    } catch {
      return false;
    }
  } else if (input.mutation) {
    return false;
  }
  return true;
}
