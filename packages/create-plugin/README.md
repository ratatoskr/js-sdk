# @ratatoskr.io/create-plugin

Makes a new [Wraith](https://wraith.io) plugin in TypeScript or JavaScript.

```
npm create @ratatoskr.io/plugin my-plugin
cd my-plugin
npm install
npm run dev
```

It asks for a title, summary, author and the game it's for, then writes `wraith.json`, a starting `src/main.ts` and a schema. Pass `--help` for the options, like `--js` or `--game <exe or id>`.

If Wraith's installed, the plugin starts out with typings from it, and with its version as the minimum it needs. See [Setting up](https://docs.wraith.io/plugins/js/setup/) for the rest.

Wraith runs on Windows, so plugins build there.

## License

MIT, see [LICENSE](LICENSE).
