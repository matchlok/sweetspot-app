import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categorize, pad7 } from "../src/categorize";

/**
 * Golden check against the Muse export: categorize() must reproduce every
 * category the Python script stored. The export is private and gitignored, so
 * this skips where it isn't present.
 */
const path = new URL("../../../data/private/strava-db-export.json", import.meta.url);
const have = existsSync(path);

describe.skipIf(!have)("categorize() vs Muse export", () => {
  it("reproduces all stored categories", () => {
    const tables = JSON.parse(readFileSync(path, "utf8")).tables;
    const cat = new Map<number, string>(
      tables.activities.map((a: any) => [a.id, a.category]),
    );
    const rows = tables.activity_zones.filter((z: any) => z.source === "heartrate");
    const mismatches: unknown[] = [];
    let checked = 0;
    for (const z of rows) {
      const stored = cat.get(z.activity_id);
      if (!stored || stored === "unknown") continue;
      const got = categorize("heartrate", pad7([z.z1, z.z2, z.z3, z.z4, z.z5, z.z6, z.z7]));
      checked++;
      if (got !== stored) mismatches.push({ id: z.activity_id, stored, got });
    }
    expect(checked).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });
});
