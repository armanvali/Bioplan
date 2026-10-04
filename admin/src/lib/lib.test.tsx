import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, statusTone, Table } from "@/components/ui";
import { can, type Admin } from "./api";

const editor: Admin = { id: "a", email: "e@x", name: "E", role: "clinical_editor", role_label: "Clinical editor", scopes: ["engine.read", "engine.draft", "engine.simulate"] };

describe("admin helpers", () => {
  it("checks scopes, never roles", () => {
    expect(can(editor, "engine.draft")).toBe(true);
    expect(can(editor, "engine.approve")).toBe(false);
    expect(can(null, "engine.read")).toBe(false);
  });

  it("maps workflow states to badge tones", () => {
    expect(statusTone("published")).toBe("green");
    expect(statusTone("in_review")).toBe("amber");
    expect(statusTone("checks_failed")).toBe("red");
    expect(statusTone("something_new")).toBe("grey");
  });

  it("renders tables and their empty state", () => {
    const { rerender } = render(<Table rows={[] as { id: string }[]} rowKey={(r) => r.id} empty="Queue is empty." cols={[{ key: "i", label: "Id", render: (r) => r.id }]} />);
    expect(screen.getByText("Queue is empty.")).toBeTruthy();
    rerender(<Table rows={[{ id: "rel_1" }]} rowKey={(r) => r.id} cols={[{ key: "i", label: "Id", render: (r) => <Badge>{r.id}</Badge> }]} />);
    expect(screen.getByText("rel_1")).toBeTruthy();
  });
});
