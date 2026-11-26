// Builds a plugin project into dist/, the folder Wraith loads.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import * as esbuild from "esbuild";
import { compareVersions, isDevVersion, sdk } from "./wraith.js";
import { packagedManifest } from "./project.js";
import { zip } from "./zip.js";

export const typesDir = ".wraith/types";
/** The game's types, which Wraith reads from the plugin's folder as the `schema` module. */
export const schemasDir = "schemas";


/**
 * @param {import("./project.js").Project} project
 * @param {import("./wraith.js").Wraith} wraith
 */
export function types(project, wraith) {
    rmSync(join(project.root, typesDir), { recursive: true, force: true });
    // It reads schemas/ itself
    sdk(wraith, ["js", "types", "--out", typesDir, "--pointer-size", String(project.pointerSize)], project.root);
}

/** False if there's no TypeScript. Throws on type errors. */
export function check(project) {
    let tsc;
    try {
        const require = createRequire(join(project.root, "package.json"));
        const pkgPath = require.resolve("typescript/package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsc;
        tsc = join(pkgPath, "..", bin);
    } catch {
        return false;
    }
    try {
        execFileSync(process.execPath, [tsc, "--noEmit", "-p", project.root], { cwd: project.root, stdio: "inherit" });
    } catch {
        throw new Error("Type errors (above)");
    }
    return true;
}

function bundleOptions(project) {
    return {
        absWorkingDir: project.root,
        entryPoints: [project.entry],
        outfile: join(project.outDir, "main.js"),
        bundle: true,
        format: "esm",
        // quickjs-ng runs ES2023. No Node or DOM
        platform: "neutral",
        target: "es2023",
        mainFields: ["module", "main"],
        // Wraith gives these
        external: ["salamander", "wraith"],
        logLevel: "warning",
    };
}

function copyFiles(project) {
    const out = join(project.root, project.outDir);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, project.manifestFile), packagedManifest(readFileSync(join(project.root, project.manifestFile), "utf8"), project.root));
    const schemas = join(project.root, schemasDir);
    if (existsSync(schemas)) {
        cpSync(schemas, join(out, schemasDir), { recursive: true, filter: (src) => statSync(src).isDirectory() || src.endsWith(".sal") });
    }
    const pub = join(project.root, project.public);
    if (existsSync(pub)) cpSync(pub, out, { recursive: true });
    // The pictures it names for the hub, from where they are in the project
    const { icon, images = [] } = project.manifest;
    for (const path of icon ? [icon, ...images] : images) {
        const from = join(project.root, path);
        if (!existsSync(from)) throw new Error(`${project.manifestFile} names ${path}, but it's not there`);
        mkdirSync(dirname(join(out, path)), { recursive: true });
        cpSync(from, join(out, path));
    }
}

/**
 * @param {import("./project.js").Project} project
 * @param {import("./wraith.js").Wraith} wraith
 * @param {{ check?: boolean, log?: (message: string) => void }} [options]
 */
export async function build(project, wraith, options = {}) {
    const log = options.log ?? (() => {});
    warnIfTooOld(project, wraith, log);
    types(project, wraith);
    if (options.check !== false && !check(project)) log("No TypeScript in the project: not type-checked");
    rmSync(join(project.root, project.outDir), { recursive: true, force: true });
    await esbuild.build(bundleOptions(project));
    copyFiles(project);
    log(`Built ${project.name} in ${project.outDir}`);
}

function warnIfTooOld(project, wraith, log) {
    const needs = project.manifest.wraith;
    if (needs && !isDevVersion(wraith.version) && compareVersions(wraith.version, needs) < 0) {
        log(`Warning: ${project.manifestFile} says it needs Wraith ${needs}, but this is ${wraith.version} (${wraith.exe}): it won't load it`);
    }
    const api = project.manifest.apiVersion;
    if (wraith.apiVersion != null && api > wraith.apiVersion) {
        log(`Warning: ${project.manifestFile}'s apiVersion is ${api}, but this Wraith's API is ${wraith.apiVersion} (${wraith.exe}): it won't load it`);
    } else if (wraith.minApiVersion != null && api < wraith.minApiVersion) {
        log(`Warning: ${project.manifestFile}'s apiVersion is ${api}, older than this Wraith loads (${wraith.minApiVersion}): update it for API ${wraith.apiVersion}`);
    }
}

/** Skips type checks, the editor and `build` do that. */
export async function dev(project, wraith, { log = () => {} } = {}) {
    warnIfTooOld(project, wraith, log);
    types(project, wraith);
    const out = join(project.root, project.outDir);
    rmSync(out, { recursive: true, force: true });
    copyFiles(project);
    let first = true;
    const ctx = await esbuild.context({
        ...bundleOptions(project),
        plugins: [{
            name: "wraith-install",
            setup(b) {
                b.onEnd((result) => {
                    if (result.errors.length) return;
                    log(first ? `Built in ${out}. If Wraith doesn't load it yet: wraith dev add ${out}, then Rescan in the overlay's Plugins window. Reload it there after each change` : `Rebuilt ${new Date().toLocaleTimeString()}`);
                    first = false;
                });
            },
        }],
    });
    await ctx.watch();

    let timer;
    const changed = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            try {
                types(project, wraith);
                copyFiles(project);
                log(`Updated ${new Date().toLocaleTimeString()}`);
            } catch (e) {
                log(e.message);
            }
        }, 100);
    };
    const watchers = [watch(join(project.root, project.manifestFile), changed)];
    for (const dir of [schemasDir, project.public]) {
        if (existsSync(join(project.root, dir))) watchers.push(watch(join(project.root, dir), { recursive: true }, changed));
    }
    return {
        async stop() {
            clearTimeout(timer);
            for (const w of watchers) w.close();
            await ctx.dispose();
        },
    };
}

/**
 * Files go in one folder named after the plugin.
 * @returns {{ file: string, sha256: string }}
 */
export async function pack(project, wraith, options = {}) {
    await build(project, wraith, options);
    const out = join(project.root, project.outDir);
    const entries = files(out).map((path) => ({ name: `${project.name}/${relative(out, path).replaceAll("\\", "/")}`, data: readFileSync(path) }));
    const bytes = zip(entries);
    const file = join(project.root, `${project.name}-${project.manifest.version}.zip`);
    writeFileSync(file, bytes);
    return { file, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function files(dir) {
    return readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}
