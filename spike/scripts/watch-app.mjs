import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, relative, resolve } from "node:path";

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = resolve(spikeRoot, process.env.PICORUBY_APP || "lib/app.rb");
const appDirectory = dirname(appSource);
const appFilename = basename(appSource);
const appLabel = relative(spikeRoot, appSource) || appFilename;
const withWrangler = process.argv.includes("--with-wrangler");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let pending = false;
let building = false;
let stopping = false;
let timer;
let worker;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${signal || code}`));
      }
    });
  });
}

async function buildApp() {
  if (building) {
    pending = true;
    return;
  }

  building = true;
  try {
    await run(npm, ["run", "build:app"], { cwd: spikeRoot });
    console.log(`[picoruby] ${appLabel} built as app.bin`);
    return true;
  } catch (error) {
    console.error(`[picoruby] ${appLabel} build failed: ${error.message}`);
    return false;
  } finally {
    building = false;
    if (pending) {
      pending = false;
      void buildApp();
    }
  }
}

function scheduleBuild() {
  clearTimeout(timer);
  timer = setTimeout(() => void buildApp(), 100);
}

function startWrangler() {
  worker = spawn(npm, ["exec", "--", "wrangler", "dev"], {
    cwd: spikeRoot,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    stdio: "inherit",
  });
  worker.on("error", (error) => {
    console.error(`[wrangler] failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  worker.on("exit", (code) => {
    if (!stopping) process.exit(code || 1);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  watcher.close();
  if (worker) worker.kill(signal);
}

if (!(await buildApp())) process.exit(1);
const watcher = watch(appDirectory, { recursive: false }, (_event, filename) => {
  if (filename && filename.toString() === appFilename) scheduleBuild();
});

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

console.log(`[picoruby] watching ${appSource}`);
if (withWrangler) startWrangler();
