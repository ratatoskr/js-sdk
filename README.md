# Wraith JS SDK

Write Wraith plugins in TypeScript or JavaScript.

Pre-release. Expect breaking changes.

## Packages

- [`@ratatoskr.io/create-plugin`](packages/create-plugin) makes a new plugin: `npm create @ratatoskr.io/plugin my-plugin`
- [`@ratatoskr.io/plugin-tools`](packages/plugin-tools) builds, type checks and packs them

Start with [Setting up](https://docs.wraith.io/plugins/js/setup/) in the docs.

## Building

You need Node 20 or newer.

```
npm install
npm test
```

The end-to-end tests need a Wraith with `wraith sdk`: set `WRAITH` to its `wraith.exe`, or build the [Wraith](https://github.com/ratatoskr/wraith) repo next to this one. Without one they skip. CI runs them against the latest release.

Want to help? See [CONTRIBUTING.md](https://github.com/ratatoskr/.github/blob/main/CONTRIBUTING.md). Found a security problem? See [SECURITY.md](https://github.com/ratatoskr/.github/blob/main/SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).