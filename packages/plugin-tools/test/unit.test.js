import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract, unzip, zip } from "../lib/zip.js";
import { loadProject, packagedManifest, readManifest, validateManifest } from "../lib/project.js";
import { compareVersions } from "../lib/wraith.js";
import { outsideInputs } from "../lib/build.js";

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
        apiVersion: 1,
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
    const base = { id: "kai_bones", kind: "plugin", version: "1.0.0", apiVersion: 1, title: "Kai", summary: "s" };
    assert.deepEqual(validateManifest(base), []);
    const problems = (extra) => validateManifest({ ...base, ...extra }).join("\n");
    assert.match(validateManifest({}).join("\n"), /"id" is required[\s\S]*"summary" is required/);
    assert.match(problems({ id: "K" }), /"id" doesn't fit. Its name on the hub/);
    assert.match(problems({ version: "1.0" }), /"version" doesn't fit/);
    assert.match(problems({ apiVersion: undefined }), /"apiVersion" is required/);
    assert.match(problems({ apiVersion: 0 }), /"apiVersion" must be at least 1/);
    assert.match(problems({ apiVersion: "1" }), /"apiVersion" must be a whole number/);
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
    assert.deepEqual(problems({ library: true }), "");
    assert.match(problems({ library: "yes" }), /"library" must be true or false/);
    assert.match(problems({ kind: "project", library: true }), /"library" is for plugins only/);
    assert.deepEqual(problems({ gameEngine: { id: "unity", variants: ["IL2CPP"] } }), "");
    assert.deepEqual(problems({ repo: "https://github.com/me/kai", tags: ["camera", "quality-of-life"], icon: "icon.png", images: ["images/Menu 1.JPG"] }), "");
    assert.match(problems({ repo: "http://x" }), /"repo"/);
    assert.match(problems({ tags: ["Camera"] }), /"tags"\[0\] doesn't fit. A few words/);
    assert.match(problems({ tags: ["ui", "ui"] }), /"tags" must be a list/);
    assert.match(problems({ icon: "../icon.png" }), /"icon"/);
    assert.match(problems({ icon: "icon.gif" }), /"icon"/);
    assert.match(problems({ images: ["/a.png"] }), /"images"\[0\] doesn't fit/);
    assert.match(problems({ gameEngine: { id: "unity" }, game: { ids: ["steam-1"] } }), /both "game" and "gameEngine"/);
    assert.match(problems({ gameEngine: { id: "frostbite" } }), /"gameEngine"."id" must be one of/);
    assert.match(problems({ gameEngine: { id: "unity", variants: [] } }), /"gameEngine"."variants"/);
    assert.throws(() => readManifest(JSON.stringify({ ...base, summary: "" })), /"summary" must be 1-200/);
    assert.deepEqual(problems({ depends: ["freecam"], devDepends: { freecam: "../../libs/freecam/wraith.json" } }), "");
    assert.match(problems({ devDepends: { Freecam: "../freecam" } }), /"devDepends"/);
    assert.match(problems({ devDepends: ["../freecam"] }), /"devDepends"/);
    assert.deepEqual(problems({ descriptionFile: "docs/About.md" }), "");
    assert.match(problems({ descriptionFile: "about.txt" }), /"descriptionFile"/);
    assert.match(problems({ descriptionFile: "about.md", description: "x" }), /both "description" and "descriptionFile"/);
});

test("descriptionFile goes into packages as the description", () => {
    const dir = mkdtempSync(join(tmpdir(), "wraith-desc-"));
    try {
        writeFileSync(join(dir, "about.md"), "\uFEFF# Camera\n\nFlies.\n\n");
        const packed = JSON.parse(packagedManifest(JSON.stringify({ id: "camera", descriptionFile: "about.md" }), dir));
        assert.equal(packed.description, "# Camera\n\nFlies.");
        assert.equal(packed.descriptionFile, undefined);
        assert.throws(() => packagedManifest(JSON.stringify({ id: "camera", description: "x", descriptionFile: "about.md" }), dir), /Keep one/);
        assert.throws(() => packagedManifest(JSON.stringify({ id: "camera", descriptionFile: "gone.md" }), dir), /isn't there/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("devDepends stays out of packages", () => {
    const text = JSON.stringify({ id: "kai", depends: ["freecam"], devDepends: { freecam: "../freecam" }, future: 1 });
    const packed = JSON.parse(packagedManifest(text));
    assert.equal(packed.devDepends, undefined);
    assert.deepEqual(packed.depends, ["freecam"]);
    assert.equal(packed.future, 1);
    const plain = '{ "id": "kai" }';
    assert.equal(packagedManifest(plain), plain);
});

test("project from wraith.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "wraith-project-"));
    try {
        assert.throws(() => loadProject(dir), /no wraith\.json/);
        const m = { id: "kai_bones", kind: "plugin", version: "1.0.0", apiVersion: 1, title: "Kai", summary: "s", arches: ["x86"] };
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

test("dev watches what the typings are made from outside its folder", () => {
    const root = mkdtempSync(join(tmpdir(), "wraith-inputs-"));
    const dep = mkdtempSync(join(tmpdir(), "wraith-dep-"));
    try {
        mkdirSync(join(root, ".wraith", "types"), { recursive: true });
        const slash = (p) => p.replaceAll("\\", "/");
        const lines = [slash(join(dep)), slash(join(root, "schemas")), slash(join(root, "wraith.json")), slash(join(dep, "a.sal")), slash(join(tmpdir(), "missing-wraith.exe"))];
        writeFileSync(join(root, ".wraith", "types", "inputs.txt"), lines.join("\n") + "\n");
        assert.deepEqual(outsideInputs({ root }), [slash(dep)]);
    } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(dep, { recursive: true, force: true });
    }
});
