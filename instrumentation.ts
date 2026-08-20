export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureAutoProductionScheduler } = await import("./app/lib/auto-production/scheduler.server");
    ensureAutoProductionScheduler();
  }
}
