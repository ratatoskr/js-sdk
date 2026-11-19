# @ratatoskr.io/plugin-tools

Builds [Wraith](https://wraith.io) plugins written in TypeScript or JavaScript. New plugins made with `npm create @ratatoskr.io/plugin` already use it.

```
wraith-plugin build    typings, type check and bundle, into dist/
wraith-plugin dev      build again on every change. Run `wraith dev add dist` once so Wraith loads it
wraith-plugin pack     build, and zip it for the Wraith Hub
wraith-plugin types    only the typings, in .wraith/types, for your editor
wraith-plugin wraith   which Wraith it builds against
```

The typings come from the Wraith it finds: `WRAITH` (its `wraith.exe` or folder), the Wraith app's install, or `PATH`. Without one, it downloads the latest release.

See [Setting up](https://docs.wraith.io/plugins/js/setup/) and [Sharing](https://docs.wraith.io/plugins/js/sharing/) in the docs.

Wraith runs on Windows, so plugins build there.

## License

MIT, see [LICENSE](LICENSE).
