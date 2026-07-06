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
  // Session 11 audit H6 follow-up: the ~26 pre-existing hits for
  // react/no-unescaped-entities and react-hooks/set-state-in-effect have been
  // burned down (escaped / annotated with justified per-line disables), so both
  // rules run at their eslint-config-next default severity (error) again — no
  // override needed. New accidental misuse is now a hard failure.
];

export default eslintConfig;
