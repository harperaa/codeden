import { HARDEN_COMMAND } from "@codeden/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NetworkSettings } from "@/components/settings/sections-network";
import { renderWithClient } from "./utils";

describe("Settings › Network access › Trusted origins", () => {
  it("names this product's command in the hint for adding one", async () => {
    renderWithClient(<NetworkSettings />);
    const hint = await screen.findByText(/network origin add https:\/\/<host>/);
    expect(hint.textContent).toBe(`${HARDEN_COMMAND} network origin add https://<host>`);
    expect(hint.tagName).toBe("CODE");
  });
});
