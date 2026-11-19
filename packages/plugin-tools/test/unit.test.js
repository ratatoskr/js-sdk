import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract, unzip, zip } from "../lib/zip.js";
import { loadProject, readManifest, validateManifest } from "../lib/project.js";
import { compareVersions } from "../lib/wraith.js";

test("zip round-trip", () => {
    const files = [
        { name: "kai/main.js", data: Buffer.from("export {};\n".repeat(100)) },
        { name: "kai/layouts/game.zon", data: Buffer.from(".{}") },
        { name: "kai/empty", data: Buffer.alloc(0) },
    ];
    const bytes = zip(files);
    assert.deepEqual(zip(files), bytes);
    assert.deepEqual(unzip(bytes).map((f) => [f.name, f.data.toString()]), files.map((f) => [f.name, f.data.toString()]));

    const dir = mkdtempSync(join(tmpdir(), "wraith-zip-"));
    try {
        extract(bytes, dir);
        assert.equal(readFileSync(join(dir, "kai", "layouts", "game.zon"), "utf8"), ".{}");
        assert.throws(() => extract(zip([{ name: "../outside.txt", data: Buffer.from("x") }]), dir), /outside/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("manifest fields", () => {
    const m = readManifest(JSON.stringify({
        $schema: "https://hub.wraith.io/schema/v1/wraith.json",
        id: "kai_bones",
        kind: "plugin",
        version: "1.2.0",
        title: 'Kai: "free" spending',
        summary: "One line.",
        wraith: "0.2",
        game: { ids: ["steam-3316940", "gog-1"], exes: ["kai.exe", "kai_dx12.exe"], builds: ["steam:123"] },
        arches: ["x86"],
        provider: "js",
        autoLoad: false,
        depends: ["other@1.2"],
    }));
    assert.equal(m.id, "kai_bones");
    assert.deepEqual(m.arches, ["x86"]);
    assert.equal(m.autoLoad, false);
    assert.throws(() => readManifest(".{}"), /isn't valid JSON/);
});

test("manifest problems", () => {
    const base = { id: "kai_bones", kind: "plugin", version: "1.0.0", title: "Kai", summary: "s" };
    assert.deepEqual(validateManifest(base), []);
    const problems = (extra) => validateManifest({ ...base, ...extra }).join("\n");
    assert.match(validateManifest({}).join("\n"), /"id" is required[\s\S]*"summary" is required/);
    assert.match(problems({ id: "K" }), /"id" must match/);
    assert.match(problems({ version: "1.0" }), /"version" must match/);
    assert.match(problems({ kind: "theme" }), /"kind"/);
    assert.match(problems({ auto_load: true }), /"auto_load" isn't a field/);
    assert.match(problems({ game: { builds: [] } }), /needs "ids" or "exes"/);
    assert.match(problems({ game: { exes: ["kai"] } }), /"exes"/);
    assert.match(problems({ game: { ids: [] } }), /"ids"/);
    assert.deepEqual(problems({ game: { ids: ["kai"], hashes: ["ab".repeat(64)] } }), "");
    assert.match(problems({ game: { ids: ["kai"], hashes: ["ab12"] } }), /"hashes"/);
    assert.match(problems({ games: [] }), /"games" isn't a field/);
    assert.match(problems({ arches: ["arm64"] }), /"arches"/);
    assert.match(problems({ kind: "project", provider: "js" }), /"provider" is for plugins only/);
    assert.throws(() => readManifest(JSON.stringify({ ...base, summary: "" })), /"summary" must be 1-200/);
});

test("project from wraith.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "wraith-project-"));
    try {
        assert.throws(() => loadProject(dir), /no wraith\.json/);
        const m = { id: "kai_bones", kind: "plugin", version: "1.0.0", title: "Kai", summary: "s", arches: ["x86"] };
        writeFileSync(join(dir, "wraith.json"), JSON.stringify(m));
        assert.throws(() => loadProject(dir), /"provider": "js"/);
        writeFileSync(join(dir, "wraith.json"), JSON.stringify({ ...m, provider: "js" }));
        const project = loadProject(dir);
        assert.equal(project.name, "kai_bones");
        assert.equal(project.manifestFile, "wraith.json");
        assert.equal(project.pointerSize, 4);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("version compare", () => {
    assert.equal(compareVersions("0.10.0", "0.9.1"), 1);
    assert.equal(compareVersions("1.0.0", "1.0"), 0);
    assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
});
