#!/usr/bin/env node
// `npm create @ratatoskr.io/plugin [folder]` makes a new Wraith plugin.

import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findWraith, isDevVersion, loadProject, manifestFile, schemaUrl, types, validateManifest } from "@ratatoskr.io/plugin-tools";

const here = dirname(fileURLToPath(import.meta.url));
const template = join(here, "..", "template");
const toolsVersion = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).dependencies["@ratatoskr.io/plugin-tools"];

const usage = `Usage: npm create @ratatoskr.io/plugin [folder] -- [options]
Options:
  --name <name>       the plugin's name: its folder once installed (a-z, 0-9, _ and -)
  --title <title>     what it's called
  --summary <text>    one line about it (--description works too)
  --author <author>
  --game <exe or id>  the game it's for: its exe (game.exe), or its ID (wraith games identify)
  --js                JavaScript, not TypeScript
  --yes               take the defaults for anything not given
  --tools <spec>      the @ratatoskr.io/plugin-tools to depend on (default ${toolsVersion})`;

const namePattern = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function parseArgs(argv) {
    const options = {};
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--js" || a === "--yes" || a === "--help") options[a.slice(2)] = true;
        else if (a.startsWith("--")) options[a.slice(2)] = argv[++i];
        else rest.push(a);
    }
    return { options, folder: rest[0] };
}

async function ask(options, folder) {
    const interactive = !options.yes && process.stdin.isTTY;
    const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
    const question = async (text, fallback, check = () => true) => {
        if (!rl) return fallback;
        for (;;) {
            const answer = (await rl.question(`${text}${fallback ? ` (${fallback})` : ""}: `)).trim() || fallback;
            if (check(answer)) return answer;
        }
    };
    try {
        const dir = folder ?? (await question("Folder", "my-plugin", (a) => !!a));
        const name = options.name ?? (await question("Name (its folder once installed)", toName(basename(resolve(dir))), (a) => namePattern.test(a)));
        const title = options.title ?? (await question("Title", toTitle(name)));
        const summary = options.summary ?? options.description ?? (await question("Summary (one line)", `${title}, a Wraith plugin`));
        const author = options.author ?? (await question("Author", ""));
        const game = options.game ?? (await question("Game (its exe, or ID from `wraith games identify`; empty: any)", ""));
        const js = options.js ?? (rl ? /^j/i.test(await question("TypeScript or JavaScript", "TypeScript")) : false);
        return { dir: resolve(dir), name, title, summary, author, game, js };
    } finally {
        rl?.close();
    }
}

const toName = (s) => {
    const name = s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|-+$/g, "").slice(0, 64);
    return namePattern.test(name) ? name : "my-plugin";
};
const toTitle = (name) => name.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function manifest({ name, title, summary, author, game }, wraithVersion, apiVersion) {
    const m = { $schema: schemaUrl, id: name, kind: "plugin", version: "0.1.0", apiVersion, title, summary };
    if (author) m.author = author;
    if (wraithVersion) m.wraith = wraithVersion;
    if (game) m.game = { [/\.exe$/i.test(game) ? "exes" : "ids"]: [game] };
    m.provider = "js";
    return JSON.stringify(m, null, 2) + "\n";
}

async function main(argv) {
    const { options, folder } = parseArgs(argv);
    if (options.help) {
        console.log(usage);
        return 0;
    }
    if (options.name && !namePattern.test(options.name)) {
        console.error(`"${options.name}" can't be a plugin's name: 2-64 of a-z, 0-9, _ and -, starting with a letter or digit`);
        return 1;
    }
    const answers = await ask(options, folder);
    const { dir, name, title, js } = answers;
    if (existsSync(dir) && readdirSync(dir).length) {
        console.error(`${dir} isn't empty`);
        return 1;
    }

    // A released Wraith's version is the plugin's starting minimum
    let wraith = null;
    try {
        wraith = await findWraith({ download: false });
    } catch {}
    const minimum = wraith && !isDevVersion(wraith.version) && /^[0-9]+(\.[0-9]+){0,2}$/.test(wraith.version) ? wraith.version : null;
    // The API it's made for is the one this Wraith has, else the newest these tools know
    const manifestText = manifest(answers, minimum, wraith?.apiVersion ?? 1);
    const problems = validateManifest(JSON.parse(manifestText));
    if (problems.length) {
        console.error(`Can't make its ${manifestFile}:\n  ${problems.join("\n  ")}`);
        return 1;
    }

    cpSync(template, dir, { recursive: true });
    renameSync(join(dir, "_gitignore"), join(dir, ".gitignore"));
    const ext = js ? "js" : "ts";
    if (js) {
        const main = readFileSync(join(dir, "src", "main.ts"), "utf8");
        writeFileSync(join(dir, "src", "main.js"), `// @ts-check (against .wraith/types: see tsconfig.json)\n${main}`);
        rmSync(join(dir, "src", "main.ts"));
    }
    for (const file of [join("src", `main.${ext}`), "README.md", join("schemas", "game.sal")]) {
        const path = join(dir, file);
        writeFileSync(path, readFileSync(path, "utf8").replaceAll("__TITLE__", title).replaceAll("__NAME__", name).replaceAll("__NAMESPACE__", namespaceOf(name)).replaceAll("__EXT__", ext).replaceAll("__LANGUAGE__", js ? "JavaScript" : "TypeScript"));
    }
    writeFileSync(join(dir, manifestFile), manifestText);
    writeFileSync(join(dir, "package.json"), JSON.stringify({
        name,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
            build: "wraith-plugin build",
            dev: "wraith-plugin dev",
            pack: "wraith-plugin pack",
            types: "wraith-plugin types",
        },
        devDependencies: {
            "@ratatoskr.io/plugin-tools": options.tools ?? toolsVersion,
            typescript: "^7.0.2",
        },
    }, null, 2) + "\n");

    const where = relative(process.cwd(), dir) || ".";
    console.log(`\nMade ${title} in ${where}.`);
    if (wraith) {
        try {
            types(loadProject(dir), wraith);
            console.log(`Typings from Wraith ${wraith.version} (${wraith.exe}) are in .wraith/types.`);
        } catch (e) {
            console.log(`Couldn't write the typings yet (${e.message}): \`npm run types\` will.`);
        }
    } else {
        console.log("No Wraith found here: the first build downloads the latest (or install the Wraith app).");
    }
    console.log(`\nNext:\n  cd ${where}\n  npm install\n  npm run dev`);
    return 0;
}

/** The namespace Wraith puts a plugin's own schemas in: its id in PascalCase, like `TrailsHorizon`. */
function namespaceOf(id) {
    const ns = id.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
    if (!ns) return "Plugin";
    return /^[0-9]/.test(ns) ? `_${ns}` : ns;
}

main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e) => {
        console.error(e.message);
        process.exitCode = 1;
    },
);
