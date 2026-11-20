// A plugin project. package.json's `"wraith"` can override its paths.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const manifestFile = "wraith.json";
export const schemaUrl = "https://hub.wraith.io/schema/v1/wraith.json";

/**
 * wraith.json, see schemaUrl.
 * @typedef {object} Manifest
 * @property {string} id
 * @property {"plugin" | "project"} kind
 * @property {string} version
 * @property {string} title
 * @property {string} summary
 * @property {string} [description]
 * @property {string} [license]
 * @property {string} [author]
 * @property {string} [homepage]
 * @property {string} [wraith]
 * @property {{ ids?: string[], exes?: string[], builds?: string[], hashes?: string[] }} [game] left out means any game
 * @property {("x64" | "x86")[]} [arches]
 * @property {string} [provider]
 * @property {boolean} [autoLoad]
 * @property {boolean} [library] code for other plugins, with nothing of its own to use
 * @property {string[]} [depends]
 */

/**
 * @typedef {object} Project
 * @property {string} root
 * @property {string} name its manifest's id
 * @property {string} manifestFile
 * @property {Manifest} manifest
 * @property {string} entry
 * @property {string} public
 * @property {string} outDir
 * @property {4 | 8} pointerSize
 */

/** @returns {Project} */
export function loadProject(root) {
    const path = join(root, manifestFile);
    if (!existsSync(path)) throw new Error(`${root} has no ${manifestFile}`);
    const manifest = readManifest(readFileSync(path, "utf8"));
    if (manifest.kind !== "plugin") throw new Error(`${manifestFile} must say "kind": "plugin"`);
    if (manifest.provider !== "js") throw new Error(`${manifestFile} must say "provider": "js"`);
    const name = manifest.id;

    let options = {};
    try {
        options = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).wraith ?? {};
    } catch {}
    const entry = options.entry ?? ["src/main.ts", "src/main.js"].find((e) => existsSync(join(root, e))) ?? "src/main.ts";
    // 32-bit only plugins get 4-byte pointers
    const pointerSize = options.pointerSize ?? (manifest.arches?.length === 1 && manifest.arches[0] === "x86" ? 4 : 8);
    return {
        root,
        name,
        manifestFile,
        manifest,
        entry,
        public: options.public ?? "public",
        outDir: options.outDir ?? "dist",
        pointerSize,
    };
}

/** Parses wraith.json's text. Throws if it isn't JSON or doesn't fit the schema. */
export function readManifest(text, file = manifestFile) {
    let manifest;
    try {
        manifest = JSON.parse(text);
    } catch (e) {
        throw new Error(`${file} isn't valid JSON: ${e.message}`);
    }
    const problems = validateManifest(manifest);
    if (problems.length) throw new Error(`${file} doesn't fit ${schemaUrl}:\n  ${problems.join("\n  ")}`);
    return manifest;
}

const idPattern = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/;
const wraithPattern = /^[0-9]+(\.[0-9]+){0,2}$/;
const gameIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.+~-]{0,127}$/;
const exePattern = /^[^<>:"/\\|?*]{1,128}\.[eE][xX][eE]$/;
const buildPattern = /^[a-z]+:[A-Za-z0-9._-]{1,128}$/;
const hashPattern = /^[0-9a-fA-F]{128}$/;
const providerPattern = /^[a-z][a-z0-9_]{0,31}$/;
const dependPattern = /^[a-z0-9][a-z0-9_-]{1,63}(@[0-9]+(\.[0-9]+){0,2})?$/;

/**
 * Checks a parsed manifest against the schema (schemaUrl).
 * @returns {string[]} what's wrong, empty if nothing
 */
export function validateManifest(m) {
    if (typeof m !== "object" || m === null || Array.isArray(m)) return ["it must be an object"];
    const problems = [];
    const known = ["$schema", "id", "kind", "version", "title", "summary", "description", "license", "author", "homepage", "wraith", "game", "arches", "provider", "autoLoad", "library", "depends"];
    for (const key of Object.keys(m)) if (!known.includes(key)) problems.push(`"${key}" isn't a field`);
    for (const key of ["id", "kind", "version", "title", "summary"]) if (m[key] === undefined) problems.push(`"${key}" is required`);

    const string = (key, { pattern, min = 0, max = Infinity } = {}) => {
        const v = m[key];
        if (v === undefined) return;
        if (typeof v !== "string") problems.push(`"${key}" must be a string`);
        else if (v.length < min || v.length > max) problems.push(`"${key}" must be ${min}-${max} characters`);
        else if (pattern && !pattern.test(v)) problems.push(`"${key}" must match ${pattern.source}`);
    };
    string("$schema");
    string("id", { pattern: idPattern });
    string("version", { pattern: versionPattern });
    string("title", { min: 1, max: 80 });
    string("summary", { min: 1, max: 200 });
    string("description", { max: 20000 });
    string("license", { max: 64 });
    string("author", { max: 64 });
    string("homepage", { pattern: /^https:\/\/[^\s]+$/, max: 256 });
    string("wraith", { pattern: wraithPattern });
    string("provider", { pattern: providerPattern });
    if (m.kind !== undefined && m.kind !== "plugin" && m.kind !== "project") problems.push(`"kind" must be "plugin" or "project"`);
    if (m.autoLoad !== undefined && typeof m.autoLoad !== "boolean") problems.push(`"autoLoad" must be true or false`);
        if (m.library !== undefined && typeof m.library !== "boolean") problems.push(`"library" must be true or false`);
    if (m.game !== undefined) {
        const g = m.game;
        if (typeof g !== "object" || g === null || Array.isArray(g)) problems.push(`"game" must be an object`);
        else {
            for (const key of Object.keys(g)) if (!["ids", "exes", "builds", "hashes"].includes(key)) problems.push(`"game"."${key}" isn't a field`);
            if (g.ids === undefined && g.exes === undefined) problems.push(`"game" needs "ids" or "exes"`);
            const list = (key, pattern, like, min) => {
                const v = g[key];
                if (v === undefined) return;
                if (!Array.isArray(v) || v.length < min || v.length > 64 || new Set(v).size !== v.length || !v.every((x) => typeof x === "string" && pattern.test(x))) {
                    problems.push(`"game"."${key}" must be a list of ${min}-64 different ones like ${like}`);
                }
            };
            list("ids", gameIdPattern, "steam-1245620", 1);
            list("exes", exePattern, "game.exe", 1);
            list("builds", buildPattern, "steam:18234455", 0);
            list("hashes", hashPattern, "an exe's SHA-512 in hex", 0);
        }
    }
    if (m.arches !== undefined) {
        const a = m.arches;
        if (!Array.isArray(a) || !a.length || new Set(a).size !== a.length || !a.every((x) => x === "x64" || x === "x86")) {
            problems.push(`"arches" must be a list of "x64" and/or "x86", each once`);
        }
    }
    if (m.depends !== undefined) {
        const d = m.depends;
        if (!Array.isArray(d) || d.length > 32 || new Set(d).size !== d.length || !d.every((x) => typeof x === "string" && dependPattern.test(x))) {
            problems.push(`"depends" must be a list of at most 32 different name or name@version`);
        }
    }
    if (m.kind === "project") {
        for (const key of ["arches", "provider", "autoLoad", "library"]) if (m[key] !== undefined) problems.push(`"${key}" is for plugins only`);
    }
    return problems;
}
