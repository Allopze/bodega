import { describe, it, expect } from "vitest"
import { thresholdPctOf, marginOf, windowHoursOf, thresholdStdDevsOf, configOf } from "@/lib/combustibles/anomaly-detector"

type Rule = { config: string | null }
const noConfig: Rule = { config: null }
const invalidJson: Rule = { config: "not valid json at all" }
const emptyObject: Rule = { config: "{}" }

describe("configOf", () => {
  it("returns empty object for null config", () => {
    expect(configOf(noConfig)).toEqual({})
  })

  it("returns parsed JSON for valid config", () => {
    expect(configOf({ config: '{"foo": 1}' })).toEqual({ foo: 1 })
  })

  it("returns empty object for malformed JSON", () => {
    expect(configOf(invalidJson)).toEqual({})
  })
})

describe("thresholdPctOf", () => {
  it("returns value from config when valid", () => {
    expect(thresholdPctOf({ config: '{"thresholdPct": 75}' }, 50)).toBe(75)
  })

  it("returns fallback when config is null", () => {
    expect(thresholdPctOf(noConfig, 50)).toBe(50)
  })

  it("returns fallback when value is below minimum of 1", () => {
    expect(thresholdPctOf({ config: '{"thresholdPct": 0.5}' }, 50)).toBe(50)
  })

  it("returns fallback when value is not a number", () => {
    expect(thresholdPctOf({ config: '{"thresholdPct": "abc"}' }, 50)).toBe(50)
  })

  it("returns fallback on invalid JSON", () => {
    expect(thresholdPctOf(invalidJson, 50)).toBe(50)
  })

  it("returns fallback on empty config object", () => {
    expect(thresholdPctOf(emptyObject, 10)).toBe(10)
  })
})

describe("marginOf", () => {
  it("returns value from config when valid", () => {
    expect(marginOf({ config: '{"margin": 0.1}' }, 0.05)).toBe(0.1)
  })

  it("returns fallback when config is null", () => {
    expect(marginOf(noConfig, 0.05)).toBe(0.05)
  })

  it("allows margin of 0 (boundary)", () => {
    expect(marginOf({ config: '{"margin": 0}' }, 0.05)).toBe(0)
  })

  it("returns fallback when value is negative", () => {
    expect(marginOf({ config: '{"margin": -0.1}' }, 0.05)).toBe(0.05)
  })

  it("returns fallback when value is not a number", () => {
    expect(marginOf({ config: '{"margin": "x"}' }, 0.05)).toBe(0.05)
  })

  it("returns fallback on invalid JSON", () => {
    expect(marginOf(invalidJson, 0.05)).toBe(0.05)
  })
})

describe("windowHoursOf", () => {
  it("returns value from config when valid", () => {
    expect(windowHoursOf({ config: '{"windowHours": 4}' }, 2)).toBe(4)
  })

  it("returns fallback when config is null", () => {
    expect(windowHoursOf(noConfig, 2)).toBe(2)
  })

  it("returns fallback when value is below minimum of 1", () => {
    expect(windowHoursOf({ config: '{"windowHours": 0.5}' }, 2)).toBe(2)
  })

  it("returns fallback when value is zero", () => {
    expect(windowHoursOf({ config: '{"windowHours": 0}' }, 2)).toBe(2)
  })

  it("returns fallback when value is not a number", () => {
    expect(windowHoursOf({ config: '{"windowHours": true}' }, 2)).toBe(2)
  })

  it("returns fallback on invalid JSON", () => {
    expect(windowHoursOf(invalidJson, 2)).toBe(2)
  })
})

describe("thresholdStdDevsOf", () => {
  it("returns value from config when valid", () => {
    expect(thresholdStdDevsOf({ config: '{"thresholdStdDevs": 3}' }, 2)).toBe(3)
  })

  it("returns fallback when config is null", () => {
    expect(thresholdStdDevsOf(noConfig, 2)).toBe(2)
  })

  it("allows minimum boundary of 0.1", () => {
    expect(thresholdStdDevsOf({ config: '{"thresholdStdDevs": 0.1}' }, 2)).toBe(0.1)
  })

  it("returns fallback when value is below 0.1", () => {
    expect(thresholdStdDevsOf({ config: '{"thresholdStdDevs": 0.05}' }, 2)).toBe(2)
  })

  it("returns fallback when value is negative", () => {
    expect(thresholdStdDevsOf({ config: '{"thresholdStdDevs": -1}' }, 2)).toBe(2)
  })

  it("returns fallback when value is not a number", () => {
    expect(thresholdStdDevsOf({ config: '{"thresholdStdDevs": null}' }, 2)).toBe(2)
  })

  it("returns fallback on invalid JSON", () => {
    expect(thresholdStdDevsOf(invalidJson, 2)).toBe(2)
  })
})
