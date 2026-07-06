import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";

countries.registerLocale(en);

/**
 * Resolve a country code returned by GSC (which uses ISO-3166-1 alpha-3,
 * lowercase — "ind", "usa", "phl") to its English display name ("India",
 * "United States of America", "Philippines").
 *
 * Falls back to the original uppercased code if the package doesn't recognise
 * it (e.g. GSC's special "zzz" = unknown).
 */
export function countryName(code: string | null | undefined): string {
  if (!code) return "—";
  const up = code.toUpperCase();
  const name = countries.getName(up, "en", { select: "official" });
  return name || up;
}
