const packageJson = require("./package.json");
const cp = require("child_process");
const path = require("path");
const fse = require("fs-extra");

for (let dep of Object.keys(packageJson.dependencies)) {
    try { require.resolve(dep); }
    catch (err) { console.log("Installing..."); cp.execSync(`npm i`); }
}

const { connect } = require("puppeteer-real-browser");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adblockcachedir = path.resolve(__dirname, "./adblockcache");
if (!fse.existsSync(adblockcachedir)) fse.mkdirSync(adblockcachedir, { recursive: true });

const token = process.env.TOKEN;
const botid = process.env.BOT_ID;
if (!token || !botid) { console.error("Faltan TOKEN o BOT_ID"); process.exit(1); }

(async () => {
    console.log("Iniciando... Bot ID:", botid);

    const { browser, page } = await connect({
        headless: true,
        turnstile: true,
        args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--window-size=1920,1080"],
        plugins: [require("puppeteer-extra-plugin-adblocker")({ blockTrackers: true, useCache: true, cacheDir: adblockcachedir })],
    });

    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument((t) => { window.localStorage.setItem("token", JSON.stringify(t)); }, token);

    console.log("Cargando top.gg...");
    await page.goto("https://top.gg", { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000);

    const homeText = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log("Texto home:", homeText);

    const isLoggedIn = !homeText.toLowerCase().includes("login");
    console.log("Logueado:", isLoggedIn);

    if (!isLoggedIn) {
        console.log("Intentando login manual...");
        await page.evaluate(() => {
            const els = [...document.querySelectorAll("button, a")];
            const el = els.find(el => el.innerText && el.innerText.trim().toLowerCase().includes("login"));
            if (el) el.click();
        });
        await delay(5000);
        try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }); } catch (_) {}
        const url = page.url();
        console.log("URL tras login:", url);
        if (url.includes("discord.com")) {
            await page.evaluate(() => {
                const btns = [...document.querySelectorAll("button")];
                const btn = btns.find(b => b.innerText && b.innerText.toLowerCase().includes("authoriz"));
                if (btn) btn.click();
            });
            await delay(5000);
            try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }); } catch (_) {}
        }
    }

    const voteUrl = `https://top.gg/bot/${botid}/vote`;
    console.log("Cargando página de voto...");
    await page.goto(voteUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(5000);

    const votePageText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
    console.log("=== TEXTO DE PÁGINA DE VOTO ===");
    console.log(votePageText);
    console.log("=== FIN TEXTO ===");

    // Buscar cualquier botón visible
    const buttons = await page.evaluate(() => {
        return [...document.querySelectorAll("button")].map(b => b.innerText.trim()).filter(t => t.length > 0);
    });
    console.log("Botones en página:", JSON.stringify(buttons));

    await browser.close();
    process.exit(0);
})();
