import { spawn } from "node:child_process";

function nowInKorea() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utc + 9 * 60 * 60_000);
}

function nextNineAmKorea() {
  const now = nowInKorea();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function runCrawler() {
  const child = spawn(process.execPath, ["scripts/watchlist-crawler.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  child.on("close", schedule);
}

function schedule() {
  const next = nextNineAmKorea();
  const delay = next.getTime() - nowInKorea().getTime();
  console.log(`Next watchlist crawl: ${next.toISOString()} Asia/Seoul`);
  setTimeout(runCrawler, delay);
}

schedule();
