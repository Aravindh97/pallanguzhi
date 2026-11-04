import { expect, test, type Page } from "@playwright/test";

const pits = async (p: Page) => {
  const labels = await p.locator(".board .pit").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!));
  return labels.map((l) => +l.match(/: (\d+) seeds/)![1]).reduce((a, b) => a + b, 0);
};
const fast = async (p: Page) => p.getByLabel("animation speed").fill("300"); // no animation delay

test("two players and a spectator play through the Go server", async ({ browser }) => {
  const anita = await (await browser.newContext()).newPage();
  await anita.goto("/");
  await anita.getByRole("tab", { name: "Play a friend online" }).click();
  await anita.getByLabel("your name").fill("Anita");
  await anita.getByRole("button", { name: "Create a room" }).click();
  await expect(anita.getByText("Waiting for a second player")).toBeVisible();
  const link = anita.url();
  expect(link).toMatch(/\?room=[A-Z2-9]{6}$/);

  const ravi = await (await browser.newContext()).newPage();
  await ravi.goto(link.replace(/^.*\?/, "/?"));
  await ravi.getByLabel("your name").fill("Ravi");
  await ravi.getByRole("button", { name: "Join the game" }).click();
  await expect(anita.getByText("Your move: click a glowing pit.")).toBeVisible();
  await expect(ravi.getByText(/Anita to move/)).toBeVisible();
  await fast(anita);
  await fast(ravi);

  const watcher = await (await browser.newContext()).newPage();
  await watcher.goto(link.replace(/^.*\?/, "/?"));
  await watcher.getByRole("button", { name: "Join the game" }).click(); // both seats taken: watches
  await expect(watcher.getByText("watching", { exact: true })).toBeVisible();
  await expect(anita.getByText("1 watching")).toBeVisible();

  // Six moves, each by whoever's turn it is, clicking their first glowing pit.
  for (let i = 0; i < 6; i++) {
    const mover = (await anita.getByText("Your move: click a glowing pit.").isVisible()) ? anita : ravi;
    await expect(mover.getByText("Your move: click a glowing pit.")).toBeVisible();
    await mover.locator(".pit.legal").first().click();
    await expect(mover.getByText("Your move: click a glowing pit.")).toBeHidden({ timeout: 10_000 }).catch(() => {});
  }
  // Every view settles on the same position, with all 148 seeds accounted for.
  const total = async (p: Page) => {
    const stores = await p.locator(".store b").allInnerTexts();
    return (await pits(p)) + stores.reduce((a, b) => a + +b, 0);
  };
  const board = (p: Page) => p.locator(".board .pit").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.split(": ")[1]).join(","));
  for (const p of [anita, ravi, watcher]) await expect.poll(() => total(p), { timeout: 10_000 }).toBe(148);
  const north = await board(ravi), south = await board(anita);
  expect(north.split(",").length).toBe(14);
  await expect.poll(() => board(watcher)).toBe(south); // the watcher sees South's view

  // Ravi's tab reloads: he gets his seat back, and Anita sees him return.
  await ravi.reload();
  await expect(ravi.getByText("North: Ravi (you)")).toBeVisible();
  await expect(anita.locator(".player").nth(1).locator(".dot.on")).toBeVisible();
});

test("an unknown room code keeps retrying without crashing the page", async ({ page }) => {
  await page.goto("/?room=ZZZZZZ");
  await page.getByRole("button", { name: "Join the game" }).click();
  await expect(page.getByText("reconnecting…")).toBeVisible();
});
