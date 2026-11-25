import { formatHardenVersion } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { hardenAboutPanel, hardenWindowTitle } from "../src/main/harden-display";

const line = formatHardenVersion();

describe("the desktop app's version display", () => {
  it("titles the window with the version line, keeping the page's waiting count", () => {
    expect(hardenWindowTitle("")).toBe(line);
    expect(hardenWindowTitle("CodeHarden")).toBe(line);
    expect(hardenWindowTitle("(2) CodeHarden")).toBe(`(2) ${line}`);
    expect(hardenWindowTitle("(2) ⏳ Waiting on you · CodeHarden")).toBe(
      `(2) ⏳ Waiting on you · ${line}`,
    );
    // Upstream's page name is not this product's: such a title is kept whole.
    expect(hardenWindowTitle("(2) CodeDen")).toBe(`(2) CodeDen · ${line}`);
    expect(hardenWindowTitle("Something else")).toBe(`Something else · ${line}`);
  });

  it("shows the product name and the version line in About", () => {
    expect(hardenAboutPanel()).toEqual({ applicationName: "CodeHarden", applicationVersion: line });
  });
});
