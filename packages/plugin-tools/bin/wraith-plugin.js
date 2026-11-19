#!/usr/bin/env node
// `wraith-plugin` builds a JS or TS Wraith plugin.

import { findWraith } from "../lib/wraith.js";
import { loadProject } from "../lib/project.js";
import { build, dev, pack, types } from "../lib/build.js";

const usage = `Usage: wraith-plugin <command>
Commands:
  build [--no-check]   typings, type check and bundle, into dist/
  dev                  build into dist/, and again on every change. Run
                       \`wraith dev add dist\` once so Wraith loads it from there
  pack [--no-check]    build, and zip it for the Wraith Hub (<name>-<version>.zip)
  types                only the typings (.wraith/types): for the editor
  wraith               which Wraith it builds against

Wraith is found from WRAITH (its wraith.exe, or folder), the Wraith app's install, or
PATH, else the latest release is downloaded (WRAITH_DIST_URL).`;

const log = (message) => console.error(message);

async function main(argv) {
    const [command, ...rest] = argv;
    const flag = (name) => rest.includes(name);
    if (!command || command === "help" || command === "--help") {
        console.log(usage);
        return 0;
    }
    if (!["build", "dev", "pack", "types", "wraith"].includes(command)) {
        console.error(usage);
        return 1;
    }
    const wraith = await findWraith({ log });
    if (command === "wraith") {
        console.log(`Wraith ${wraith.version}: ${wraith.exe} (from ${wraith.source})\nMods folder: ${wraith.modsDir}`);
        return 0;
    }
    const project = loadProject(process.cwd());
    switch (command) {
        case "types":
            types(project, wraith);
            break;
        case "build":
            await build(project, wraith, { check: !flag("--no-check"), log });
            break;
        case "pack": {
            const { file, sha256 } = await pack(project, wraith, { check: !flag("--no-check"), log });
            console.log(`${file}\nsha256: ${sha256}\n\nFor the registry (plugins/${project.name}.json), once it's uploaded:\n` +
                JSON.stringify({ versions: [{ url: "<where it's uploaded>", sha256 }] }, null, 2));
            break;
        }
        case "dev": {
            const session = await dev(project, wraith, { log });
            const stop = async () => {
                await session.stop();
                process.exit(0);
            };
            process.on("SIGINT", stop);
            process.on("SIGTERM", stop);
            return null;
        }
    }
    return 0;
}

main(process.argv.slice(2)).then(
    (code) => {
        if (code !== null) process.exitCode = code;
    },
    (e) => {
        console.error(e.message);
        process.exitCode = 1;
    },
);
