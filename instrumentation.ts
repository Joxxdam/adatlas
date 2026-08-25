export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ ensureAutoProductionScheduler }, { getReferenceOcrStatus }] = await Promise.all([
      import("./app/lib/auto-production/scheduler.server"),
      import("./app/lib/creative-generation/referenceOcrRunner.server"),
    ]);
    ensureAutoProductionScheduler();
    await getReferenceOcrStatus({ resume: true });
  }
}
