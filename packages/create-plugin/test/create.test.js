// End to end against a real Wraith, from WRAITH or a built ../wraith. CI sets WRAITH to the latest release.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, findWraith, isDevVersion, loadProject, pack, unzip, validateManifest } from "@ratatoskr.io/plugin-tools";

const here = dirname(fileURLToPath(import.meta.url));
const create = join(here, "..", "bin", "create-plugin.js");
const sibling = join(here, "..", "..", "..", "..", "wraith", "zig-out", "bin");
if (!process.env.WRAITH && existsSync(join(sibling, "wraith.exe"))) process.env.WRAITH = sibling;

const wraith = process.platform === "win32" ? await findWraith({ download: false }).catch(() => null) : null;
const skip = wraith ? false : "no Wraith with `wraith sdk`: set WRAITH, or build the wraith repository beside this one";

function scaffold(t, ...args) {
    const parent = mkdtempSync(join(here, ".tmp-"));
    t.after(() => rmSync(parent, { recursive: true, force: true }));
    const dir = join(parent, "plugin");
    execFileSync(process.execPath, [create, dir, "--yes", "--name", "test_plugin", "--game", "kai.exe", "--description", "Tests things.", ...args], { stdio: "pipe" });
    return dir;
}

test("wraith.json", (t) => {
    const dir = scaffold(t);
    const manifest = JSON.parse(readFileSync(join(dir, "wraith.json"), "utf8"));
    assert.deepEqual(validateManifest(manifest), []);
    assert.equal(manifest.$schema, "https://hub.wraith.io/schema/v1/wraith.json");
    assert.equal(manifest.id, "test_plugin");
    assert.equal(manifest.kind, "plugin");
    assert.equal(manifest.summary, "Tests things.");
    assert.equal(manifest.provider, "js");
    assert.deepEqual(manifest.game, { exes: ["kai.exe"] });
    if (!wraith || isDevVersion(wraith.version)) assert.equal(manifest.wraith, undefined);
    else assert.equal(manifest.wraith, wraith.version);
    assert.equal(loadProject(dir).name, "test_plugin");
});

test("TypeScript plugin builds", { skip }, async (t) => {
    const dir = scaffold(t);
    // create wrote the typings already
    assert.ok(existsSync(join(dir, ".wraith", "types", "wraith.d.ts")));
    assert.match(readFileSync(join(dir, ".wraith", "types", "wraith.d.ts"), "utf8"), /interface Player \{/);

    const project = loadProject(dir);
    await build(project, wraith);
    assert.match(readFileSync(join(dir, "dist", "main.js"), "utf8"), /Wraith\.ui\(\)\.addWindow/);
    assert.match(readFileSync(join(dir, "dist", "main.js"), "utf8"), /TestPlugin/);
    assert.ok(existsSync(join(dir, "dist", "wraith.json")));
    assert.ok(existsSync(join(dir, "dist", "schemas", "game.sal")));

    const { file } = await pack(project, wraith, { check: false });
    assert.equal(file, join(dir, "test_plugin-0.1.0.zip"));
    assert.deepEqual(unzip(readFileSync(file)).map((f) => f.name), [
        "test_plugin/main.js",
        "test_plugin/schemas/game.sal",
        "test_plugin/wraith.json",
    ]);
});

test("API mistakes fail the build", { skip }, async (t) => {
    const dir = scaffold(t);
    writeFileSync(join(dir, "src", "main.ts"), `
import * as salamander from "salamander";
const input = Wraith.input();
const p = TestPlugin.Player.at(Wraith.memory().main().base);
if (p) {
    const hp: number = p.health;
    p.target = p;
    p.target = null;
    const x: number = p.pos.x;
    // @ts-expect-error: not a field
    p.nope;
    const copy = salamander.snapshot(p);
    copy.health = 1;
    salamander.save(copy);
    void hp, x;
}
// @ts-expect-error: a chord is a key and mods
input.bind({ id: "x", name: "x", chord: "f8" }, () => {});
// @ts-expect-error: not a key
input.keyDown("nope");
`);
    const project = loadProject(dir);
    await build(project, wraith);

    writeFileSync(join(dir, "src", "main.ts"), `const health: string | undefined = TestPlugin.Player.at(0)?.health;\nexport { health };\n`);
    await assert.rejects(build(project, wraith), /Type errors/);
});

test("JavaScript plugin is checked", { skip }, async (t) => {
    const dir = scaffold(t, "--js");
    assert.ok(existsSync(join(dir, "src", "main.js")));
    const project = loadProject(dir);
    await build(project, wraith);
    writeFileSync(join(dir, "src", "main.js"), `Wraith.imgui().Button(5);\n`);
    await assert.rejects(build(project, wraith), /Type errors/);
});
