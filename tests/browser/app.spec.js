const fs = require("node:fs/promises");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const appOrigin = "http://127.0.0.1:4173";
const screenshotDir = path.resolve("test-results/screenshots");
const viewports = [
  { name: "desktop", size: { width: 1440, height: 1000 } },
  { name: "mobile", size: { width: 390, height: 844 } }
];

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) {
      if (url.pathname.startsWith("/api/")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}"
        });
      }
      return route.continue();
    }

    if (/\.(css|woff2?|ttf|otf)$/.test(url.pathname)) return route.abort();
    if (/\.(js|mjs)$/.test(url.pathname)) return route.abort();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}"
    });
  });
  await fs.mkdir(screenshotDir, { recursive: true });
});

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(screenshotDir, name),
    fullPage: true,
    animations: "disabled"
  });
}

for (const viewport of viewports) {
  test(`captures search home at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await page.goto("/#search");

    await expect(page.getByRole("heading", { name: /Vegan, vegetarian, Lacto-vegetarian, or non-veg\?/ })).toBeVisible();
    await expect(page.locator("#home")).toBeVisible();
    await expect(page.locator("#tiles .tile").first()).toBeVisible();
    await capture(page, `search-home-${viewport.name}.png`);
  });

  test(`captures search results at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await page.goto("/#search");
    await page.getByRole("searchbox", { name: /Search any ingredient/ }).fill("gelatin");
    await page.getByRole("searchbox", { name: /Search any ingredient/ }).press("Enter");

    await expect(page.locator("#results")).toBeVisible();
    await expect(page.locator("#sec-local")).toContainText("In the index");
    await expect(page.locator("#sec-local")).toContainText("E441 Gelatine");
    await capture(page, `search-results-${viewport.name}.png`);
  });

  test(`captures Reference Index at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await page.goto("/#search");
    await page.getByRole("tab", { name: "Index" }).click();

    await expect(page.locator("#view-index")).toBeVisible();
    await expect(page.locator("#ilist .card").first()).toBeVisible();
    await expect(page.locator("#total")).not.toHaveText("0");
    await capture(page, `reference-index-${viewport.name}.png`);
  });
}

test("filters the Reference Index and handles denied camera access without hardware", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        }
      }
    });
    window.BarcodeDetector = class {
      async detect() {
        return [];
      }
    };
  });
  await page.goto("/#search");
  await page.getByRole("tab", { name: "Index" }).click();
  await page.getByRole("searchbox", { name: "Filter the index" }).fill("gelatine");
  await expect(page.locator("#ilist .card").filter({ hasText: "E441 Gelatine" })).toBeVisible();

  await page.getByRole("tab", { name: "Search" }).click();
  await page.locator("#cambtn").click();
  await expect(page.locator("#camdlg")).toBeVisible();
  await expect(page.locator("#camstatus")).toContainText("Camera permission was refused");
});

test("shows restaurant scope, sources, and region-specific entries", async ({ page }) => {
  await page.goto("/#search");
  await page.getByRole("tab", { name: "Index" }).click();
  const regionFilterRow = page.locator("#regionfilterrow");
  const verdictFilters = page.locator("#kchips");
  const vaccines = page.locator("#catchips").getByRole("button", { name: /Vaccines/ });
  await expect(regionFilterRow).toBeHidden();
  await vaccines.click();
  await expect(regionFilterRow).toBeHidden();
  await expect(verdictFilters).toBeVisible();

  await page.locator("#catchips").getByRole("button", { name: /^Restaurants/ }).click();

  const regionFilter = page.locator("#regionfilter");
  const restaurants = page.locator("#ilist .card");
  await expect(regionFilterRow).toBeVisible();
  await expect(regionFilterRow).not.toContainText("Any verdict");
  await expect(regionFilter).toHaveValue("all");
  const indiaChain = restaurants.filter({ hasText: "McDonald's India (veg menu)" });
  await expect(indiaChain.locator(".badges")).toContainText("India");
  await expect(indiaChain).toContainText("menus and preparation can vary by location");
  await expect(restaurants.filter({ hasText: "Taco Bell" })).toBeVisible();

  await regionFilter.selectOption("India");
  await expect(restaurants.filter({ hasText: "Domino's India" })).toBeVisible();
  await expect(restaurants.filter({ hasText: "Taco Bell" })).toHaveCount(0);

  const regionOptions = await regionFilter.locator("option").allTextContents();
  expect(regionOptions).toContain("Canada");
  expect(regionOptions).not.toContain("Brampton, Ontario, Canada");
  expect(regionOptions).not.toContain("Mississauga, Ontario, Canada");
  await regionFilter.selectOption("Canada");
  await expect(regionFilter).toHaveValue("Canada");
  const bramptonRestaurant = restaurants.filter({ hasText: "Punjabi Chaap Corner — Airport & Sandalwood" });
  const mississaugaRestaurant = restaurants.filter({ hasText: "Punjabi Chaap Corner — Bramalea & Drew" });
  await expect(bramptonRestaurant).toBeVisible();
  await expect(mississaugaRestaurant).toBeVisible();
  await expect(bramptonRestaurant.locator(".badges")).toContainText("Check source");
  await expect(bramptonRestaurant.locator(".badges")).toContainText("Brampton, Ontario, Canada");
  await expect(mississaugaRestaurant.locator(".badges")).toContainText("Mississauga, Ontario, Canada");
  await expect(bramptonRestaurant.locator(".card__id .aka")).toContainText("2945 Sandalwood Pkwy E · Brampton, Ontario");
  await expect(bramptonRestaurant.locator(".field").filter({ hasText: "How it's derived" }).locator("dd")).toContainText("2945 Sandalwood Pkwy E, Brampton, Ontario, Canada, L6R 3J6");
  await expect(mississaugaRestaurant.locator(".card__id .aka")).toContainText("7305 Bramalea Rd, Unit 6 · Mississauga, Ontario");
  await expect(mississaugaRestaurant.locator(".field").filter({ hasText: "How it's derived" }).locator("dd")).toContainText("7305 Bramalea Rd, Unit #6, Mississauga, Ontario, Canada, L5S 1W4");
  await expect(bramptonRestaurant.locator(".evidence-note")).toContainText("Needs verification");
  await expect(bramptonRestaurant.locator(".evidence-note")).toContainText("business advertises its chaap as “100% vegetarian” and “zero meat”");
  await expect(bramptonRestaurant.locator(".evidence-note")).toContainText("not independent certification");
  await expect(bramptonRestaurant.locator(".evidence-note")).toContainText("do not clarify egg use across the full menu");
  await expect(bramptonRestaurant.locator(".evidence-note")).toContainText("vegan status is not established");
  await expect(bramptonRestaurant.locator(".evidence-note")).not.toContainText("Canada guidance");
  await expect(bramptonRestaurant.getByRole("link", { name: "Official chaap claim ↗" })).toHaveAttribute("href", "https://punjabichaapcorner.ca/");
  await expect(bramptonRestaurant.getByRole("link", { name: "Official locations list ↗" })).toHaveAttribute("href", "https://punjabichaapcorner.ca/locations/");
  await expect(mississaugaRestaurant.locator(".evidence-note")).toContainText("not independent certification");
  await expect(mississaugaRestaurant.locator(".evidence-note")).toContainText("do not clarify egg use across the full menu");

  await vaccines.click();
  await expect(regionFilterRow).toBeHidden();
  await expect(regionFilter).toHaveValue("all");
  await expect(page.locator("#activetag")).not.toContainText("India");
  await expect(page.locator("#ilist .card").first()).toBeVisible();
});

test("Reference Index loads more entries while scrolling", async ({ page }) => {
  await page.goto("/#index");
  const before = await page.locator("#ilist .card").count();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.locator("#ilist .card").count()).toBeGreaterThan(before);
});

test("Reference Index grows from Open Food Facts while typing", async ({ page }) => {
  await page.route("https://world.openfoodfacts.org/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("taxonomy_suggestions")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ suggestions: ["fish gelatine", "egg white powder"] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      "en:fish-gelatine": { vegan: { en: "no" }, vegetarian: { en: "no" }, description: { en: "Gelatine made from fish skin." } },
      "en:egg-white-powder": { vegan: { en: "no" }, vegetarian: { en: "yes" } }
    }) });
  });
  await page.goto("/#index");
  const total = Number(await page.locator("#total").textContent());
  await page.locator("#iq").fill("gelat");
  await expect(page.locator("#growline")).toContainText("added");
  await expect.poll(async () => Number(await page.locator("#total").textContent())).toBeGreaterThan(total);
  await expect(page.locator(".card", { hasText: "Fish gelatine" }).first()).toContainText("Non-veg");
});

test("Restaurant search still returns places when Overpass is unavailable", async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) return route.continue();
    if (url.hostname.includes("overpass")) return route.abort();
    if (url.hostname === "nominatim.openstreetmap.org" && url.searchParams.get("q")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: "42.3314", lon: "-83.0458", display_name: "Detroit, Michigan" }]) });
    }
    if (url.hostname === "nominatim.openstreetmap.org") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.searchParams.get("amenity") === "restaurant"
        ? [{ osm_type: "node", osm_id: 1, lat: "42.333", lon: "-83.046", name: "Green Bowl", category: "amenity", type: "restaurant", extratags: { "diet:vegan": "yes" } }]
        : []) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ features: [] }) });
  });
  await page.goto("/#eat");
  await page.locator("#place").fill("Detroit");
  await page.locator("#eatgo").click();
  await expect(page.locator("#eatlist")).toContainText("Green Bowl", { timeout: 15000 });
});

test("Place search works worldwide: village suggestions and a city picker for states", async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) return route.continue();
    const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.hostname.includes("open-meteo")) return json({ results: [{ name: "Kodaikanal", latitude: 10.23, longitude: 77.48, admin2: "Dindigul", admin1: "Tamil Nadu", country: "India", feature_code: "PPL" }] });
    if (url.hostname === "nominatim.openstreetmap.org" && url.pathname.includes("reverse")) return json({ extratags: { wikidata: "Q668" } });
    if (url.hostname === "nominatim.openstreetmap.org" && url.searchParams.get("q")) return json([{ lat: "10.3", lon: "76.3", display_name: "Kerala, India", addresstype: "state", extratags: { wikidata: "Q1186" }, boundingbox: ["8.1", "12.8", "74.8", "77.5"] }]);
    if (url.hostname === "query.wikidata.org") return json({ results: { bindings: [
      { cLabel: { value: "Delhi" }, coord: { value: "Point(77.2 28.6)" }, pop: { value: "3" } },
      { cLabel: { value: "Kochi" }, coord: { value: "Point(76.27 9.93)" }, pop: { value: "2" } }
    ] } });
    return route.abort();
  });
  await page.goto("/#eat");
  await page.locator("#place").fill("Kodai");
  await expect(page.locator("#placesug option")).toHaveCount(1);
  await page.locator("#place").fill("Kerala");
  await page.locator("#eatgo").click();
  await expect(page.locator("[data-bigcity]")).toHaveText(["Kochi"]);
});

test("Gluten-free category, allergen profile and Ledger health rating on a product", async ({ page }) => {
  const product = { code: "3017620422003", product_name: "Choco Hazel Spread", brands: "TestBrand",
    ingredients_text: "Sugar, palm oil, hazelnuts 13%, skimmed milk powder, emulsifier: lecithins (soya). May contain wheat.",
    ingredients_analysis_tags: ["en:non-vegan", "en:vegetarian"], allergens_tags: ["en:milk", "en:nuts", "en:soybeans"], traces_tags: ["en:gluten"],
    additives_tags: ["en:e322", "en:e171"], labels_tags: [], nutriscore_grade: "e", nova_group: 4,
    image_nutrition_url: "https://images.openfoodfacts.org/images/products/301/762/042/2003/nutrition_en.jpg" };
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) return route.continue();
    if (url.pathname.includes("/api/v2/product/")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: 1, product }) });
    return route.abort();
  });
  await page.goto("/#index");
  await page.locator("#catchips").getByRole("button", { name: /^Gluten-free/ }).click();
  await expect(page.locator("#ilist .card").first().locator(".gfbadge")).toHaveText("Gluten-free");

  await page.locator("#profbtn").click();
  await page.locator("#algpick label", { hasText: "Tree nuts" }).click();
  await page.locator("#profdlg .btn.clay").click();
  await expect(page.locator("#profsum")).toContainText("tree nuts allergy");

  await page.getByRole("tab", { name: "Search" }).click();
  const box = page.getByRole("searchbox", { name: /Search any ingredient/ });
  await box.fill("3017620422003");
  await box.press("Enter");
  const card = page.locator("#sec-food .product").first();
  await expect(card.locator(".aalert")).toContainText("Contains your allergen: Tree nuts");
  await expect(card.locator(".gfbadge")).toHaveText("May contain gluten");
  await expect(card.locator(".healthwrap > summary .minis")).toHaveText(/^\d+$/);
  await expect(card.locator(".labellink").first()).toContainText("Nutrition label");
  await expect(card.locator(".labellink").first()).toHaveAttribute("href", /nutrition_en\.jpg$/);
});
