export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ ensureAutoProductionScheduler }, { recoverPersistedGenerationJobs }, { getReferenceOcrStatus }, { ensureCodexImageSessionCleanupScheduler }] = await Promise.all([
      import("./app/lib/auto-production/scheduler.server"),
      import("./app/lib/creative-generation/jobRunner.server"),
      import("./app/lib/creative-generation/referenceOcrRunner.server"),
      import("./app/lib/creative-generation/codexImageSessionRetention.server"),
    ]);
    ensureAutoProductionScheduler();
    ensureCodexImageSessionCleanupScheduler();
    await Promise.all([recoverPersistedGenerationJobs(), getReferenceOcrStatus({ resume: true })]);
  }
}
