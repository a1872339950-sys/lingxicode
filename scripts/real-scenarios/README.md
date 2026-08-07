# Real Scenarios

This folder contains small end-to-end checks for project behavior. They are for AI agents first: after changing code, run the verification that matches the changed area instead of asking the user to discover regressions manually.

Use:

```bash
npm run verify:changed
npm run test:real
npm run test:real -- change-session
```

How selection works:

- `verify:changed` runs syntax checks and then selects real scenarios based on changed file paths.
- `test:real` runs all real scenarios unless a case id or tag is provided.
- Each scenario must create its own temporary workspace and clean it up.
- A scenario should verify observable behavior, such as files on disk, IPC-facing module results, or persisted state.

When adding a scenario, export:

```js
module.exports = {
  id: 'area.behavior',
  title: 'Readable behavior title',
  tags: ['area', 'behavior'],
  changedFilePatterns: [/^path\/to\/file\.js$/],
  async run(ctx) {
    // create real inputs, call project modules, assert real outputs
  }
}
```
