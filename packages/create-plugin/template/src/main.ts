// Wraith's areas are functions on the Wraith global, and this plugin's own types, from schemas/, are on
// __NAMESPACE__, its id in PascalCase.
const { Player } = __NAMESPACE__;

// A real plugin finds it, like `[Sig("48 8B 05 ?? ?? ?? ??", Rip)] static Player* instance;` in its schema
let playerAddress = 0;

// Wraith draws the window, with a close button, Esc and an entry under the plugin's button on the bar
const window = Wraith.ui().addWindow({ title: "__TITLE__", menu: "__TITLE__", flags: Wraith.ImGuiWindowFlags.AlwaysAutoResize }, () => {
    const imgui = Wraith.imgui();
    imgui.TextUnformatted(`Hello from ${Wraith.memory().main().name}`);
    const player = playerAddress === 0 ? null : Player.at(playerAddress);
    if (player) {
        imgui.TextUnformatted(`${player.name} has ${player.health.toFixed(0)} health`);
        if (imgui.Button("Heal")) {
            player.health = 100;
            Wraith.log().info(`Healed ${player.name}`);
        }
    }
});
window.setOpen(true);

Wraith.input().bind({ id: "toggle", name: "Show the window", chord: { key: "f8", mods: 0 } }, (phase) => {
    if (phase === Wraith.Keybind.Phase.pressed) window.setOpen(!window.isOpen());
});