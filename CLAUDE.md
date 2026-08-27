# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NSW Topology (`gabrielnsw-nswtopology-panel`) is a **Grafana panel plugin**: a drag-and-drop network topology map rendered with `@xyflow/react`, driven by live Grafana data (Zabbix via the `grafana-zabbix` data source, or any time-series source with host/field labels). All panel state — nodes, connections, styling — is persisted inside the Grafana dashboard JSON via `options`/`onOptionsChange`, not in any external store.

Scaffolded with `@grafana/create-plugin`. The `.config/` directory (webpack, jest, tsconfig, eslint base) is auto-generated — **never edit files inside `.config/`**. To extend any of those tools, edit the root-level file that wraps it instead (`webpack.config.ts` extension goes through `.config/bundler`, but ESLint/Prettier/TS overrides belong in the root `eslint.config.mjs` / `.prettierrc.js` / `tsconfig.json`, per `.config/README.md`).

## Commands

```bash
npm run dev        # webpack watch build (development)
npm run build      # production build -> dist/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint --cache .
npm run lint:fix   # eslint --fix + prettier --write
npm run sign       # npx @grafana/sign-plugin@latest
```

There is no test script wired up in `package.json` even though a Jest config exists at `.config/jest.config.js` and there are currently no test files under `src/`. To run Jest ad hoc: `npx jest -c ./.config/jest.config.js`.

To see the plugin running, build it into a Grafana instance's plugin directory (or use the dev docker-compose setup referenced in `.config/docker-compose-base.yaml`) — there's no standalone dev server for a panel plugin.

Any change to `src/plugin.json` (plugin id/type/dependencies) requires restarting the Grafana server to take effect.

## Architecture

**Data flow is one-directional and stateless-in-React:** Grafana calls `TopologyPanel` with `(options, data, onOptionsChange)` every refresh. `options` (typed as `TopologyOptions` in [types.ts](src/types.ts)) holds *everything* the user configured — node positions/styles, connections, colors, general/appearance/interaction settings. `data.series` holds the live query results. Nothing is held in component state except transient UI (modals open, search query, zoom toggle); all durable edits go through `onOptionsChange` so Grafana saves them into the dashboard JSON.

```
module.ts (PanelPlugin option schema)
        |
TopologyPanel.tsx   — top-level state owner; wraps everything in <ReactFlowProvider>
        |                merges options with DEFAULT_* constants, exposes update* callbacks
        |
   +----+----------------------------+
   |                                 |
CanvasRenderer.tsx              TopologySidebar.tsx
(the real engine — computes      (add node / center / zoom / search / backup buttons)
 node+edge state each render)
   |
   +-- parseDataFrames()      (data/parser.ts)   raw DataFrame[] -> hosts/fields map
   +-- getUtilization*()      (engine/weathermap.ts) traffic % -> color/thickness
   +-- getTrafficHistory()    (data/trafficHistory.ts) sparkline series for edge hover
   +-- evaluateCustomMetric() (data/parser.ts)    regex-matches a CustomMetric to a field value
   |
   +-- xyflow node/edge components: TopologyNode.tsx, WeathermapEdge.tsx, FloatingConnectionLine.tsx
   +-- editor modals: NodeFormModal, ConnFormModal, CustomMetricList, BackupModal, DeleteConfirmation
```

Key points for making changes safely:

- **`CanvasRenderer.tsx` is the hub.** It re-derives `initialNodes`/`initialEdges` from `nodeConfigs`/`connections`/`hosts` on every relevant change via `useMemo`, then pushes them into xyflow's own `useNodesState`/`useEdgesState` (`rfNodes`/`rfEdges`) with a `queueMicrotask` sync effect. If you add a new per-node or per-edge visual property, it almost always needs threading through: `NodeConfig`/`ConnectionConfig` in [types.ts](src/types.ts) → a default in [constants.ts](src/constants.ts) → the `initialNodes`/`initialEdges` mapping in CanvasRenderer → the corresponding node/edge component's `data` prop.
- **Metrics are looked up by field name, not by fixed schema.** [parser.ts](src/data/parser.ts) turns Grafana `DataFrame`s into a `hosts: Record<hostName, ZabbixHost>` map keyed by inferred host name and item/field name (`host.items[fieldName]`). "Legacy" metrics (`cpuMetric`, `memoryMetric`, `lossMetric`, `responseTimeMetric` on `NodeConfig`) are simple exact-field lookups; `CustomMetric` entries support regex field matching (`evaluateCustomMetric`) plus aggregation (mean/sum/max/min/lastNotNull) when multiple fields match — this is what lets one config work across differently-labeled data sources.
- **Weathermap coloring** (`engine/weathermap.ts`) is purely a function of `(current traffic value, configured capacity in Mb)` → percent → threshold color/thickness (`WEATHERMAP_THRESHOLDS` in constants.ts). Node online/offline/alert coloring is separate, computed in `CanvasRenderer` (`getNodeStatus`, `getNodeAlertColor`) from `pingField`/legacy metrics/custom metric thresholds.
- **Backward compatibility matters.** `MetricConfig` (legacy per-metric field) is kept alongside `CustomMetric` (newer, regex-capable) specifically for old dashboard JSON compat — don't remove/rename fields on `NodeConfig`/`ConnectionConfig` without considering existing saved dashboards. `BackupModal.tsx` also handles importing v1-format backups.
- **Panel options schema** (the Grafana options-panel UI: General/Appearance/Colors/Interaction categories) is defined declaratively in [module.ts](src/module.ts) via the `PanelPlugin` builder — per-node/per-connection config (nodes array, connections array) is *not* exposed there; it's edited through the canvas UI (right-click / context menu / modals) instead.
- **Styling** uses inline style objects and the shared token constants in [styles/tokens.ts](src/styles/tokens.ts) (`COLORS`, `RADIUS`, `BLUR`, `FONT`) rather than CSS modules/emotion classes, aside from a few animation keyframes injected via `<style>` tags in `CanvasRenderer`.
- Grafana named colors (e.g. `"dark-green"`) vs raw hex/rgb are normalized through `resolveGrafanaColor()` in [constants.ts](src/constants.ts) — always pass color config through it before using it as a CSS color.
