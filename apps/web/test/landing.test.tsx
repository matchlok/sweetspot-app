import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeView, WeekView } from "@sweetspot/engine";
import homeFixture from "../../../packages/engine/test/fixtures/home.json";
import weekFixture from "../../../packages/engine/test/fixtures/week.json";
import { api, ApiError } from "../src/api";
import { App } from "../src/App";
import { Landing } from "../src/screens/Landing";

afterEach(cleanup);

function shellApi() {
  vi.spyOn(api, "home").mockResolvedValue(homeFixture as unknown as HomeView);
  vi.spyOn(api, "week").mockResolvedValue(weekFixture as unknown as WeekView);
}

describe("auth gate", () => {
  beforeEach(shellApi);

  it("shows the landing page, not the login form, when logged out", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new ApiError(401, "unauthorized", "no"));
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.queryByLabelText("Passphrase")).toBeNull();
  });

  it("the header Sign in is the only Sign in; it opens the login, and a login shows the app", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new ApiError(401, "unauthorized", "no"));
    vi.spyOn(api, "login").mockResolvedValue(undefined);
    render(<App />);
    const buttons = await screen.findAllByRole("button", { name: "Sign in" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(screen.getByLabelText("Passphrase")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Tuesday")).toBeTruthy();
    expect(screen.queryByLabelText("Passphrase")).toBeNull();
  });

  it("the hero Join waitlist jumps to the signup form", () => {
    render(<Landing onSignIn={() => {}} />);
    expect(screen.getByRole("link", { name: "Join waitlist" }).getAttribute("href")).toBe("#waitlist");
    expect(document.getElementById("waitlist")?.querySelector("form")).toBeTruthy();
  });

  it("posts the email, then says you're on the list", async () => {
    const join = vi.spyOn(api, "joinWaitlist").mockResolvedValue(undefined);
    render(<Landing onSignIn={() => {}} />);
    const button = screen.getByRole("button", { name: "Join waitlist" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: " rider@example.com " } });
    fireEvent.click(button);
    expect(await screen.findByText("You're on the list.")).toBeTruthy();
    expect(screen.getByText("We'll let you know when it's available.")).toBeTruthy();
    expect(join).toHaveBeenCalledWith("rider@example.com", "");
  });

  it("shows a message and keeps the form when the signup fails", async () => {
    vi.spyOn(api, "joinWaitlist").mockRejectedValue(new ApiError(400, "invalid", "bad"));
    render(<Landing onSignIn={() => {}} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/doesn't look like an email/);
    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });

  it("never shows the landing page to a logged-in user", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ user: "x" });
    render(<App />);
    expect(await screen.findByText("Tuesday")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText("Sample data")).toBeNull();
  });
});

describe("Landing content", () => {
  it("has the pitch, a Sign in, a See how it works anchor and four features", () => {
    render(<Landing onSignIn={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/simplified training app for busy cyclists/);
    expect(screen.getByRole("link", { name: "See how it works" }).getAttribute("href")).toBe("#features");
    expect(document.getElementById("features")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/in zones/)).toBeTruthy();
    expect(screen.getByText(/Readiness indicator takes the guesswork out/)).toBeTruthy();
    expect(screen.getByText(/Move a day/)).toBeTruthy();
    expect(screen.getAllByText("Ready").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Go easier")).toBeTruthy();
    expect(screen.getByText("Rest")).toBeTruthy();
    expect(screen.getByText("Thursday")).toBeTruthy();
    expect(document.querySelector(".summary")?.textContent).toMatch(/moves to Thursday/);
  });

  it("labels every render as sample data and tire pressure as in the works", () => {
    render(<Landing onSignIn={() => {}} />);
    // hero + four features
    expect(screen.getAllByText("Sample data")).toHaveLength(5);
    const pressure = screen.getByRole("heading", { name: /Tire pressure/ }).closest("section")!;
    expect(within(pressure).getByText("In the works")).toBeTruthy();
    expect(screen.getAllByText("In the works")).toHaveLength(1);
  });

  it("avoids Strava, fitness claims and percentages", () => {
    const { container } = render(<Landing onSignIn={() => {}} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/strava|narjit|faster|FTP gain|%/i);
    expect(text).toMatch(/intervals\.icu/);
    expect(text).toMatch(/Google Calendar/);
  });
});

describe("network", () => {
  it("only asks the server who you are until someone joins the waitlist", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "unauthorized", message: "no" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]!);
    await waitFor(() => expect(screen.getByLabelText("Passphrase")).toBeTruthy());
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/auth/me"]);
    vi.unstubAllGlobals();
  });
});
