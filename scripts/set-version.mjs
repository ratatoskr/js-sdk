// Usage: node scripts/set-version.mjs 0.0.2
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    console.error("usage: node scripts/set-version.mjs <version>, like 1.2.3 or 1.2.3-alpha.1");
    process.exit(1);
}

const tools = "@ratatoskr.io/plugin-tools";

function update(file, change) {
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    const json = JSON.parse(text);
    change(json);
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    writeFileSync(path, JSON.stringify(json, null, 2).replaceAll("\n", eol) + eol);
    console.log(`${file}: ${version}`);
}

for (const name of ["plugin-tools", "create-plugin"]) {
    update(`packages/${name}/package.json`, (pkg) => {
        pkg.version = version;
        if (pkg.dependencies?.[tools]) pkg.dependencies[tools] = `^${version}`;
    });
}

update("package-lock.json", (lock) => {
    for (const name of ["plugin-tools", "create-plugin"]) {
        const entry = lock.packages[`packages/${name}`];
        entry.version = version;
        if (entry.dependencies?.[tools]) entry.dependencies[tools] = `^${version}`;
    }
});
