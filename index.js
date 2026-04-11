const packageJson = require("./package.json");
const cp = require("child_process");
const path = require("path");
const fse = require("fs-extra");

for (let dep of Object.keys(packageJson.dependencies)) {
    try { require.resolve(dep); }
    catch (err) { console.log("Installing..."); cp.execSync("npm i"); }
}

const { connect } = require("puppeteer-real-browser");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adblockcachedir = path.resolve(__dirname, "./adblockcache");
if (!fse.existsSync(adblockcachedir)) fse.mkdirSync(adblockcachedir, { recursive: true });

const token = process.env.TOKEN;
const botid = process.env.BOT_ID;
if (!token || !botid) { console.error("Faltan TOKEN o BOT_ID"); process.exit(1); }

async function waitForCloudflare(page, maxMs = 45000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        const text = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
        if (text.includes("Performing security verification") || text.includes("Verifying you are human")) {
            console.log("Cloudflare verificando...");
            await delay(3000);
        } else {
            return true;
        }
    }
    return false;
}

async function injectDiscordToken(page) {
    const result = await page.evaluate((t) => {
        try {
            window.localStorage.setItem("token", JSON.stringify(t));
            return "ok";
        } catch (e) {
            return "error: " + e.message;
        }
    }, token).catch(e => "eval-error: " + e.message);
    console.log("Inject token result:", result);
    return result === "ok";
}

async function waitForVoteButton(page, maxMs = 35000) {
    console.log("Esperando botón de voto...");
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        const result = await page.evaluate(() => {
            const buttons = [...document.querySelectorAll("button")];
            const voteBtn = buttons.find(b => {
                const txt = (b.innerText || "").trim().toLowerCase();
                return (txt.includes("vote") || txt === "vote") && !b.disabled;
            });
            if (voteBtn) return { found: true, text: voteBtn.innerText.trim() };
            const adBtn = buttons.find(b => /^\d+$/.test((b.innerText || "").trim()));
            if (adBtn) return { found: false, ad: adBtn.innerText.trim() };
            return { found: false };
        }).catch(() => ({ found: false }));

        if (result.found) {
            console.log("Botón de voto encontrado:", result.text);
            return true;
        }
        if (result.ad) console.log("Anuncio, contador:", result.ad, "seg...");
        await delay(1500);
    }
    return false;
}

(async () => {
    console.log("=== VOTADOR TOP.GG | Bot:", botid, "===");

    const { browser, page } = await connect({
        headless: false,
        turnstile: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--window-size=1920,1080"],
        plugins: [require("puppeteer-extra-plugin-adblocker")({ blockTrackers: true, useCache: true, cacheDir: adblockcachedir })],
    });

    await page.setViewport({ width: 1920, height: 1080 });

    // === STEP 1: Pre-inject token on discord.com using evaluateOnNewDocument ===
    await page.evaluateOnNewDocument((t) => {
        try { window.localStorage.setItem("token", JSON.stringify(t)); } catch (e) {}
    }, token);

    // === STEP 2: Go to discord.com first and inject token ===
    console.log("Cargando discord.com para inyectar token...");
    await page.goto("https://discord.com", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await delay(3000);
    await injectDiscordToken(page);
    await delay(1000);

    // === STEP 3: Navigate to vote page ===
    const voteUrl = `https://top.gg/bot/${botid}/vote`;
    console.log("Cargando página de voto:", voteUrl);
    await page.goto(voteUrl, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await delay(3000);
    await waitForCloudflare(page, 30000);

    let currentUrl = page.url();
    let pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    console.log("URL actual:", currentUrl);
    console.log("Texto página (150 chars):", pageText.substring(0, 150));

    // === STEP 4: If not logged in, click Login button ===
    if (pageText.toLowerCase().includes("login") && !pageText.includes("You have already voted")) {
        console.log("No logueado — buscando botón Login...");

        const loginClicked = await page.evaluate(() => {
            const all = [...document.querySelectorAll("a, button")];
            const loginEl = all.find(el => {
                const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
                return txt === "login" || txt === "log in" || txt === "sign in";
            });
            if (loginEl) {
                loginEl.click();
                return loginEl.href || "clicked";
            }
            return null;
        });

        console.log("Login element clicked:", loginClicked);
        await delay(4000);

        try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }); } catch (_) {}

        currentUrl = page.url();
        console.log("URL tras login click:", currentUrl);

        // === STEP 5: If we land on Discord OAuth, inject token and authorize ===
        if (currentUrl.includes("discord.com")) {
            console.log("Estamos en Discord OAuth — inyectando token...");
            await injectDiscordToken(page);
            await delay(2000);

            // Reload the OAuth page now that we have the token
            await page.reload({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
            await delay(3000);

            console.log("URL tras reload OAuth:", page.url());
            const oauthText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
            console.log("Contenido OAuth (100 chars):", oauthText.substring(0, 100));

            // Click Authorize if visible
            const authorized = await page.evaluate(() => {
                const btns = [...document.querySelectorAll("button")];
                const authBtn = btns.find(b => {
                    const txt = (b.innerText || b.textContent || "").trim().toLowerCase();
                    return txt.includes("authoriz") || txt.includes("autorizar");
                });
                if (authBtn) { authBtn.click(); return true; }
                return false;
            }).catch(() => false);

            console.log("Authorize clicked:", authorized);

            if (authorized) {
                await delay(5000);
                try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }); } catch (_) {}
            }

            console.log("URL final tras OAuth:", page.url());

            // Return to vote page
            console.log("Volviendo a página de voto...");
            await page.goto(voteUrl, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
            await delay(3000);
            await waitForCloudflare(page, 30000);

            pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
            console.log("Texto página voto (200 chars):", pageText.substring(0, 200));
        }
    }

    // === STEP 6: Check if already voted ===
    if (pageText.includes("You have already voted")) {
        console.log("RESULTADO: Ya votaste — correcto, voto activo.");
        await browser.close();
        process.exit(0);
    }

    // === STEP 7: Wait for and click vote button ===
    const btnReady = await waitForVoteButton(page, 35000);

    if (btnReady) {
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll("button")].find(b =>
                (b.innerText || "").trim().toLowerCase().includes("vote") && !b.disabled
            );
            if (btn) btn.click();
        });
        console.log("Clic en Vote. Esperando confirmación...");
        await delay(6000);

        const afterText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
        console.log("Texto tras voto:", afterText.substring(0, 300));

        if (afterText.includes("You have already voted") || afterText.includes("reminder") || afterText.includes("voted")) {
            console.log("RESULTADO: ÉXITO — Voto registrado!");
        } else {
            console.log("RESULTADO: Clic enviado. Revisá top.gg para confirmar.");
        }
    } else {
        const finalText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
        console.log("RESULTADO: No se encontró botón Vote. Texto:", finalText.substring(0, 300));
    }

    await browser.close();
    process.exit(0);
})();
