import { frame, imgui, input, log, memory } from "wraith";
import { ImGuiWindowFlags, KeyPhase, Player } from "schema";

let visible = true;
// A real plugin finds it, like `[Sig("48 8B 05 ?? ?? ?? ??", Rip)] static Player* instance;` in its schema
let playerAddress = 0;

input.bind({ id: "toggle", name: "Show the window", chord: { key: "f8", mods: 0 } }, (phase) => {
    if (phase === KeyPhase.pressed) visible = !visible;
});

frame.onFrame(() => {
    if (!visible) return;
    if (imgui.Begin("__TITLE__", null, ImGuiWindowFlags.AlwaysAutoResize)) {
        imgui.TextUnformatted(`Hello from ${memory.main().name}`);
        const player = playerAddress === 0 ? null : Player.at(playerAddress);
        if (player) {
            imgui.TextUnformatted(`${player.name} has ${player.health.toFixed(0)} health`);
            if (imgui.Button("Heal")) {
                player.health = 100;
                log.info(`Healed ${player.name}`);
            }
        }
    }
    imgui.End();
});
