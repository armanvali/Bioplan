import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { AnswerSchema, AnswerValue, Area, Impact } from "@/lib/types";
import { AnswerControls } from "./intake/AnswerControls";
import { StopCard } from "./intake/IntakeParts";
import { ImpactRadar } from "./plan/Impact";

const areas: Area[] = [
  { id: "sleep", name: "Sleep", short: "Sleep", color: "#5560C9", icon: "moon" },
  { id: "energy", name: "Energy", short: "Energy", color: "#B98A12", icon: "bolt" },
  { id: "immunity", name: "Immunity", short: "Immunity", color: "#6FA23A", icon: "shield" },
];

describe("ImpactRadar", () => {
  it("draws a filled shape when every area is visible", () => {
    const impact: Impact = { plan_id: "p", areas: areas.map((a) => ({ area: a.id, need: 8, projected: 6 })), aria_summary: "Sleep 75% covered" };
    const { container } = render(<ImpactRadar impact={impact} areas={areas} />);
    expect(screen.getByRole("img", { name: /Sleep 75% covered/ })).toBeTruthy();
    expect(container.querySelectorAll("polygon").length).toBe(6); // 4 rings + need + projected
  });

  it("never plots locked areas as zero", () => {
    const impact: Impact = { plan_id: "p", areas: [{ area: "sleep", need: 10, projected: 7 }, { area: "energy", locked: true }, { area: "immunity", locked: true }] };
    const { container } = render(<ImpactRadar impact={impact} areas={areas} need={{ energy: 8, immunity: 6 }} />);
    expect(container.querySelectorAll("polygon").length).toBe(5); // no projected polygon
    expect(screen.getAllByText("Locked", { selector: "td" })).toHaveLength(2);
  });
});

function Harness({ schema }: { schema: AnswerSchema }) {
  const [v, setV] = useState<AnswerValue>({ picks: [] });
  return (
    <>
      <AnswerControls schema={schema} value={v} onChange={setV} />
      <output data-testid="value">{JSON.stringify(v)}</output>
    </>
  );
}

describe("AnswerControls", () => {
  it("'None of these' clears other picks in a multi-choice", () => {
    const schema: AnswerSchema = {
      type: "multi", allow_unsure: false, follow: [], fields: [], hours: [], items: [], scale: [], sources: [],
      options: [{ id: "thyroid", label: "Thyroid" }, { id: "kidney", label: "Kidney" }, { id: "none", label: "None of these", exclusive: true }],
    };
    render(<Harness schema={schema} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Thyroid/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Kidney/ }));
    expect(screen.getByTestId("value").textContent).toBe('{"picks":["thyroid","kidney"]}');
    fireEvent.click(screen.getByRole("checkbox", { name: /None of these/ }));
    expect(screen.getByTestId("value").textContent).toBe('{"picks":["none"]}');
    fireEvent.click(screen.getByRole("checkbox", { name: /Thyroid/ }));
    expect(screen.getByTestId("value").textContent).toBe('{"picks":["thyroid"]}');
  });
});

describe("StopCard", () => {
  it("offers no way forward on a terminal stop", () => {
    render(<StopCard card={{ id: "chest", action: "stop", severity: "urgent", title: "Please see a doctor first", body: "b", can_continue: false }} onContinue={() => undefined} />);
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByRole("heading", { name: "Please see a doctor first" })).toBeTruthy();
  });
});
