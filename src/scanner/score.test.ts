import { describe, expect, it } from "vitest";
import { actionForScore, gradeForScore, isStrongGrade } from "./score";

describe("conviction grade", () => {
  it("keeps A+ and A as a rank, and says the order is the trigger", () => {
    expect(gradeForScore(85)).toBe("A+");
    expect(gradeForScore(75)).toBe("A");
    expect(gradeForScore(62)).toBe("B");
    expect(isStrongGrade("A+")).toBe(true);
    expect(isStrongGrade("B")).toBe(false);
    expect(actionForScore(90)).toContain("Prime or Standard trigger");
    expect(actionForScore(80)).toContain("Prime or Standard trigger");
    expect(actionForScore(90)).not.toContain("Swing long");
  });
});
