import { describe, expect, it } from "vitest";

import {
  DEFAULT_DELIVERY_MESSAGE,
  buildWhatsAppLink,
  renderDeliveryMessage,
  whatsAppPhone,
} from "@/lib/orders/whatsappMessage";

/**
 * `formatDZD` groups through `toLocaleString("fr-DZ")`, whose thousands
 * separator is U+202F NARROW NO-BREAK SPACE — not a plain space. Written as an
 * escape here rather than pasted, because the two are indistinguishable in a
 * diff and the difference is the whole assertion. Swapping the formatter (to
 * `formatDA`, say, which groups with commas) has to fail loudly.
 */
const NNBSP = " ";

describe("renderDeliveryMessage", () => {
  it("substitutes {price} with the formatted montant", () => {
    expect(renderDeliveryMessage("المبلغ: {price}", "2500")).toBe(
      `المبلغ: 2${NNBSP}500 DA`,
    );
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(renderDeliveryMessage("{price} / {price}", "800")).toBe(
      "800 DA / 800 DA",
    );
  });

  // The textarea is free text, so a typo is a matter of when, not if. A literal
  // "{pirce}" in a sent message is visibly wrong; a silently dropped token is
  // a message with no price in it, which is the failure worth avoiding.
  it("leaves an unknown token alone", () => {
    expect(renderDeliveryMessage("salam {pirce} {name}", "1000")).toBe(
      "salam {pirce} {name}",
    );
  });

  it("renders the shipped default with a price in it", () => {
    const rendered = renderDeliveryMessage(DEFAULT_DELIVERY_MESSAGE, "3200");
    expect(rendered).toContain(`3${NNBSP}200 DA`);
    expect(rendered).not.toContain("{price}");
  });

  // `montant` is a provider-shaped varchar: it has held "", and it is not this
  // function's job to decide an order is unsendable. A blank price is obvious
  // in the preview dialog; "NaN DA" going out to a customer is not.
  it("renders an empty price rather than NaN for a non-numeric montant", () => {
    expect(renderDeliveryMessage("x {price} y", "")).toBe("x  y");
    expect(renderDeliveryMessage("x {price} y", "abc")).toBe("x  y");
  });
});

describe("whatsAppPhone", () => {
  it("converts a canonical Algerian mobile to international form", () => {
    expect(whatsAppPhone("0555605770")).toBe("213555605770");
  });

  it("accepts the shapes that predate phone normalisation", () => {
    expect(whatsAppPhone("+213555605770")).toBe("213555605770");
    expect(whatsAppPhone("0555 60 57 70")).toBe("213555605770");
    expect(whatsAppPhone(" 0562 21 02 59")).toBe("213562210259");
  });

  // The 213-strip in phoneKey only fires on a long-enough string, precisely so
  // an Algiers landline (021 …) keeps its digits. That has to survive here.
  it("keeps a landline's digits", () => {
    expect(whatsAppPhone("021 34 56 78")).toBe("21321345678");
  });

  it("returns null when there is nothing to dial", () => {
    expect(whatsAppPhone("")).toBeNull();
    expect(whatsAppPhone(null)).toBeNull();
    expect(whatsAppPhone("   ")).toBeNull();
  });
});

describe("buildWhatsAppLink", () => {
  it("builds a wa.me link with the message percent-encoded", () => {
    const url = buildWhatsAppLink("0555605770", "salam");
    expect(url).toBe("https://wa.me/213555605770?text=salam");
  });

  it("encodes Arabic text and newlines", () => {
    const url = buildWhatsAppLink("0555605770", "السلام\nعليكم");
    expect(url?.startsWith("https://wa.me/213555605770?text=")).toBe(true);
    expect(url).toContain("%0A");
    expect(url).not.toContain("السلام");
    expect(decodeURIComponent(url!.split("?text=")[1])).toBe("السلام\nعليكم");
  });

  it("returns null when the number is unusable, so no caller can open a wrong chat", () => {
    expect(buildWhatsAppLink("", "salam")).toBeNull();
    expect(buildWhatsAppLink(null, "salam")).toBeNull();
  });
});
