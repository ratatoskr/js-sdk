// Finds Wraith. Tries WRAITH, the launcher's install and PATH, then the SDK cache or a download.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { extract } from "./zip.js";

const defaultDist = "https://dist.wraith.io/wraith";

/**
 * @typedef {object} Wraith
 * @property {string} exe
 * @property {string} version
 * @property {string} dir
 * @property {string} modsDir
 * @property {string} source
 */

/**
 * @param {{ download?: boolean, log?: (message: string) => void }} [options]
 * @returns {Promise<Wraith>}
 */
export async function findWraith(options = {}) {
    const log = options.log ?? (() => {});
    if (process.platform !== "win32") {
        throw new Error("Wraith runs on Windows: build plugins there (in CI, a windows runner)");
    }
    const tried = [];
    for (const [source, exe] of candidates()) {
        if (!exe || !existsSync(exe)) continue;
        const found = ask(exe, source);
        if (found) return found;
        tried.push(`${exe} (${source}) is too old to have \`wraith sdk\``);
    }
    if (options.download === false) {
        throw new Error(["No Wraith found: install the Wraith app, or set WRAITH to its wraith.exe", ...tried].join("\n  "));
    }
    for (const t of tried) log(t);
    const exe = await download(log);
    const found = ask(exe, "download");
    if (!found) throw new Error(`The latest Wraith (${exe}) doesn't have \`wraith sdk\``);
    return found;
}

/** [source, wraith.exe] pairs, in order. */
function* candidates() {
    const env = process.env.WRAITH;
    if (env) yield ["WRAITH", existsSync(env) && statSync(env).isDirectory() ? join(env, "wraith.exe") : env];
    const installed = wraithRoot();
    if (installed) {
        const root = join(installed, "framework");
        try {
            const folder = readFileSync(join(root, "current.txt"), "utf8").trim();
            yield ["app", join(root, folder, "wraith.exe")];
        } catch {}
    }
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
        if (dir) yield ["PATH", join(dir, "wraith.exe")];
    }
    const cache = cacheDir();
    if (existsSync(cache)) {
        const versions = readdirSync(cache).filter((v) => v.startsWith("v") && existsSync(join(cache, v, "wraith.exe")));
        versions.sort((a, b) => compareVersions(b.slice(1), a.slice(1)));
        if (versions.length) yield ["cache", join(cache, versions[0], "wraith.exe")];
    }
}

/** Null if it's too old to have `wraith sdk js info`. */
function ask(exe, source) {
    let out;
    try {
        out = execFileSync(exe, ["sdk", "js", "info"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
        return null;
    }
    try {
        const info = JSON.parse(out);
        return { exe, version: info.version, dir: info.dir, modsDir: info.mods_dir, source };
    } catch {
        return null;
    }
}

function wraithRoot() {
    if (process.env.WRAITH_ROOT) return process.env.WRAITH_ROOT;
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(local, "Wraith");
}

export function cacheDir() {
    if (process.env.WRAITH_SDK_CACHE) return process.env.WRAITH_SDK_CACHE;
    return join(wraithRoot(), "cache", "sdk");
}

async function download(log) {
    const dist = (process.env.WRAITH_DIST_URL ?? defaultDist).replace(/\/$/, "");
    const release = await (await get(`${dist}/latest.json`)).json();
    const dir = join(cacheDir(), `v${release.version}`);
    const exe = join(dir, "wraith.exe");
    if (existsSync(exe)) return exe;
    log(`Downloading Wraith ${release.version} (${release.url})`);
    const zip = Buffer.from(await (await get(release.url)).arrayBuffer());
    const sha256 = createHash("sha256").update(zip).digest("hex");
    if (sha256.toLowerCase() !== String(release.sha256).toLowerCase()) {
        throw new Error(`Wraith ${release.version}'s download is corrupt (its SHA-256 is ${sha256}, not ${release.sha256})`);
    }
    // Unpack beside it first so a half-done unpack doesn't look downloaded
    const partial = `${dir}.partial`;
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial, { recursive: true });
    try {
        extract(zip, partial);
        if (!existsSync(join(partial, "wraith.exe"))) throw new Error(`There's no wraith.exe in ${release.url}`);
        renameSync(partial, dir);
    } finally {
        rmSync(partial, { recursive: true, force: true });
    }
    return exe;
}

async function get(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response;
}

/** Returns -1, 0 or 1. */
export function compareVersions(a, b) {
    const pa = String(a).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
    }
    return 0;
}

/** Builds from main are 0.0.0. */
export const isDevVersion = (version) => compareVersions(version, "0.0.0") === 0;

/** @param {Wraith} wraith */
export function sdk(wraith, args, cwd) {
    execFileSync(wraith.exe, ["sdk", ...args], { cwd, stdio: "inherit", windowsHide: true });
}
