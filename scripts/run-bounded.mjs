import { spawn } from "node:child_process";

const [timeoutValue, killAfterValue, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeoutValue);
const killAfterMs = Number(killAfterValue);

if (!command || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(killAfterMs) || killAfterMs <= 0) {
  console.error("Usage: node scripts/run-bounded.mjs <timeout-ms> <kill-after-ms> <command> [...args]");
  process.exit(64);
}

const child = spawn(command, args, { stdio: "inherit", env: process.env });
let timedOut = false;
let forceKillTimer;

const timeoutTimer = setTimeout(() => {
  timedOut = true;
  console.error(`Command exceeded ${timeoutMs} ms; requesting termination.`);
  child.kill("SIGTERM");
  forceKillTimer = setTimeout(() => child.kill("SIGKILL"), killAfterMs);
}, timeoutMs);

child.on("error", (error) => {
  clearTimeout(timeoutTimer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  console.error(error.message);
  process.exit(69);
});

child.on("exit", (code, signal) => {
  clearTimeout(timeoutTimer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (timedOut) process.exit(124);
  if (signal) {
    console.error(`Command terminated by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
