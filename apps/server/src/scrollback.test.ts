import { describe, expect, test } from "bun:test";
import { trimScrollback } from "./scrollback";

describe("trimScrollback", () => {
  test("appends while under the limit", () => {
    expect(trimScrollback("abc", "de", 10)).toBe("abcde");
  });

  test("keeps the tail once over the limit", () => {
    expect(trimScrollback("abc", "defg", 4)).toBe("defg");
    expect(trimScrollback("abcdef", "", 3)).toBe("def");
  });

  test("empty data leaves the buffer untouched", () => {
    expect(trimScrollback("abc", "", 10)).toBe("abc");
  });
});
