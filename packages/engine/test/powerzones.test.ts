import { describe, expect, it } from "vitest";
import { zonesFromPowerStream, type PowerSettings } from "../src/powerzones";

const cfg: PowerSettings = { ftp: 200, zoneTopsPct: [55, 75, 90, 105, 120, 150, 999], sweetSpotPct: { min: 84, max: 97 } };
const flat = (watts: number, secs: number, extra = {}) => ({ time: Array.from({ length: secs }, (_, i) => i), watts: Array(secs).fill(watts), ...extra });

describe("zonesFromPowerStream", () => {
  it("puts steady power in the right zone with inclusive tops", () => {
    expect(zonesFromPowerStream(flat(150, 60), cfg)!.power).toEqual([0, 60, 0, 0, 0, 0, 0]); // 75% = top of Z2
    expect(zonesFromPowerStream(flat(151, 60), cfg)!.power).toEqual([0, 0, 60, 0, 0, 0, 0]);
    expect(zonesFromPowerStream(flat(400, 60), cfg)!.power).toEqual([0, 0, 0, 0, 0, 0, 60]);
  });

  it("counts sweet spot as whole-watt band 168 to 194 W and overlaps Z3/Z4", () => {
    const at = (w: number) => zonesFromPowerStream(flat(w, 30), cfg)!;
    expect(at(167).sweetSpotSeconds).toBe(0);
    expect(at(168).sweetSpotSeconds).toBe(30);
    expect(at(194).sweetSpotSeconds).toBe(30);
    expect(at(195).sweetSpotSeconds).toBe(0);
    expect(at(180).power[2]).toBe(30); // 180 W is exactly 90% FTP, top of Z3 (inclusive)
    expect(at(181).power[3]).toBe(30);
  });

  it("smooths over 5 s, so a 1 s spike does not reach a high zone", () => {
    const watts = Array(30).fill(100);
    watts[15] = 600;
    const r = zonesFromPowerStream({ time: watts.map((_, i) => i), watts }, cfg)!;
    expect(r.power[6]).toBe(0);
    expect(r.power.reduce((a, b) => a + b, 0)).toBe(30);
  });

  it("drops stopped samples and gaps instead of counting them as Z1", () => {
    const stopped = flat(0, 40, { moving: [...Array(30).fill(true), ...Array(10).fill(false)] });
    expect(zonesFromPowerStream(stopped, cfg)!.power.reduce((a, b) => a + b, 0)).toBe(30);
    const gap = { time: [0, 1, 2, 100, 101, 102], watts: [150, 150, 150, 150, 150, 150] };
    expect(zonesFromPowerStream(gap, cfg)!.power.reduce((a, b) => a + b, 0)).toBeLessThan(15);
  });

  it("returns undefined with no watts or no FTP, never a guess", () => {
    expect(zonesFromPowerStream({ time: [], watts: [] }, cfg)).toBeUndefined();
    expect(zonesFromPowerStream({ time: [0, 1, 2], watts: [null, null, null] }, cfg)).toBeUndefined();
    expect(zonesFromPowerStream(flat(150, 10), { ...cfg, ftp: 0 })).toBeUndefined();
  });
});
