import next from "eslint-config-next";

// `next lint` was removed in Next 16 — this is the standalone flat-config
// replacement (audit H6, Session 11). eslint-config-next 16 exports a native
// flat-config array (next + next/typescript + ignores) as its default.
const eslintConfig = [
  ...next,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "public/**",
      "next-env.d.ts",
    ],
  },
  {
    // Two rules that ship as errors in the Next 16 / React 19 config but were
    // NEVER enforced here (the lint gate was dead — audit H6). Turning them
    // into hard errors now would block all work on ~26 pre-existing hits, none
    // of which are correctness bugs:
    //   - no-unescaped-entities: cosmetic (visible text renders fine either way)
    //   - set-state-in-effect: flags the canonical reset-on-filter / load-on-mount
    //     / close-drawer-on-route patterns already used across the dashboard.
    // Kept as WARNINGS so they stay visible for burn-down (audit backlog) without
    // a red gate. Promote back to "error" once the existing hits are cleared.
    rules: {
      "react/no-unescaped-entities": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
