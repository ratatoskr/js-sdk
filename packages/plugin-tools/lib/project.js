// A plugin project. package.json's `"wraith"` can override its paths.

import { Validator } from "@cfworker/json-schema";
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
 * @property {number} apiVersion the version of Wraith's API it's made for. Wraith won't load it without one
 * @property {string} title
 * @property {string} summary
 * @property {string} [description] Markdown
 * @property {string} [descriptionFile] a Markdown file relative to wraith.json, instead of description. Packages get it as description
 * @property {string} [license]
 * @property {string} [author]
 * @property {string} [homepage]
 * @property {string} [repo] where its source is
 * @property {string[]} [tags] like camera, for finding it on the hub
 * @property {string} [icon] a picture in the package, like icon.png
 * @property {string[]} [images] screenshots in the package
 * @property {string} [wraith]
 * @property {{ ids?: string[], exes?: string[], builds?: string[], hashes?: string[] }} [game] left out means any game
 * @property {{ id: string, variants?: string[] }} [gameEngine] every game made with it, instead of `game`
 * @property {("x64" | "x86")[]} [arches]
 * @property {string} [provider]
 * @property {"load" | "wait" | "provided"} [clrMode]
 * @property {boolean} [autoLoad]
 * @property {boolean} [library] code for other plugins, with nothing of its own to use
 * @property {string[]} [depends]
 * @property {Record<string, string>} [devDepends] for building against ones you're working on: a name from depends to its folder or wraith.json. Left out of packages
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
    const text = readFileSync(path, "utf8");
    // These first, as they say more than the schema would
    let raw = null;
    try {
        raw = JSON.parse(text);
    } catch {}
    if (raw && (raw.kind ?? "plugin") !== "plugin") throw new Error(`${manifestFile} must say "kind": "plugin"`);
    if (raw && raw.provider !== "js") throw new Error(`${manifestFile} must say "provider": "js"`);
    const manifest = readManifest(text);
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

/**
 * wraith.json's text as it goes in a package: without devDepends, which only means something in
 * your checkout, and with descriptionFile's text as description. `dir` is wraith.json's folder. As
 * it was if there's nothing to change.
 */
export function packagedManifest(text, dir = ".") {
    const m = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (m.devDepends === undefined && m.descriptionFile === undefined) return text;
    delete m.devDepends;
    if (m.descriptionFile !== undefined) {
        if (m.description !== undefined) throw new Error(`${manifestFile} has description and descriptionFile. Keep one`);
        const file = join(dir, m.descriptionFile);
        if (!existsSync(file)) throw new Error(`${manifestFile}'s descriptionFile ${m.descriptionFile} isn't there`);
        m.description = readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
        delete m.descriptionFile;
    }
    return JSON.stringify(m, null, 2) + "\n";
}

const schema = JSON.parse(readFileSync(new URL("../schema/wraith.json", import.meta.url), "utf8"));
const validator = new Validator(schema, "2020-12", false);

/** The schema's node at a JSON pointer into a manifest, for its limits. */
function nodeAt(location) {
    let node = schema;
    for (const part of location.replace(/^#\/?/, "").split("/").filter(Boolean)) {
        const parent = node;
        node = /^\d+$/.test(part) ? node?.items : node?.properties?.[part];
        // A list's items say what they are on the list
        if (node && !node.description && parent?.items === node) node = { ...node, description: parent.description };
    }
    return node ?? {};
}

const where = (location) => {
    const parts = location.replace(/^#\/?/, "").split("/").filter(Boolean);
    return parts.length ? parts.map((p) => (/^\d+$/.test(p) ? `[${p}]` : `"${p}"`)).join(".").replaceAll(".[", "[") : "it";
};

/** One of the validator's errors, said plainly. Null for ones that only wrap others. */
function plain(m, e) {
    const at = where(e.instanceLocation);
    const node = nodeAt(e.instanceLocation);
    switch (e.keyword) {
        case "required": {
            const key = /"([^"]+)"/.exec(e.error)?.[1];
            return at === "it" ? `"${key}" is required` : `${at} needs "${key}"`;
        }
        case "false":
            return `${at} isn't a field`;
        case "anyOf":
            return e.instanceLocation === "#/game" ? `"game" needs "ids" or "exes"` : `${at} doesn't fit`;
        case "not":
            if (e.instanceLocation !== "#") return `${at} is for plugins only`;
            return m.game !== undefined && m.gameEngine !== undefined
                ? `has both "game" and "gameEngine", it's one or the other`
                : `has both "description" and "descriptionFile", it's one or the other`;
        case "type": {
            const type = /Expected "([^"]+)"/.exec(e.error)?.[1];
            return `${at} must be ${type === "integer" ? "a whole number" : type === "boolean" ? "true or false" : `a ${type ?? "different type"}`}`;
        }
        case "enum":
            return `${at} must be one of ${node.enum?.join(", ")}`;
        case "minimum":
            return `${at} must be at least ${node.minimum}`;
        case "minLength":
        case "maxLength":
            return `${at} must be ${node.minLength ?? 0}-${node.maxLength ?? "any"} characters`;
        case "minItems":
        case "maxItems":
        case "uniqueItems":
            return `${at} must be a list of ${node.minItems ?? 0}-${node.maxItems ?? "any"} different ones`;
        case "maxProperties":
            return `${at} can have up to ${node.maxProperties}`;
        case "pattern":
            return node.description ? `${at} doesn't fit. ${node.description}` : `${at} must match ${node.pattern}`;
        case "properties":
        case "items":
        case "allOf":
        case "if":
        case "then":
        case "$ref":
        case "additionalProperties":
        case "propertyNames":
            return null;
        default:
            return `${at}: ${e.error}`;
    }
}

/**
 * Checks a parsed manifest against the schema the hub uses (schemaUrl), kept in step with it by the
 * hub's `npm run sync-schema`.
 * @returns {string[]} what's wrong, empty if nothing
 */
export function validateManifest(m) {
    if (typeof m !== "object" || m === null || Array.isArray(m)) return ["it must be an object"];
    // As it'd be in the file, where a field set to undefined isn't there
    const result = validator.validate(JSON.parse(JSON.stringify(m)));
    if (result.valid) return [];
    return [...new Set(result.errors.map((e) => plain(m, e)).filter((p) => p !== null))];
}