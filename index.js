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
        const text = await page.evaluate(() => document.body.innerText).catch(() => "");
        if (text.includes("Performing security verification") || text.includes("Verifying you are human")) {
            console.log("Cloudflare verificando... esperando...");
            await delay(3000);
        } else {
            console.log("Cloudflare superado OK");
            return true;
        }
    }
    console.log("Timeout en Cloudflare - IP bloqueada");
    return false;
}

(async () => {
    console.log("=== INICIANDO VOTADOR ===");
    console.log("Bot ID:", botid);

    const { browser, page } = await connect({
        headless: false,
        turnstile: true,
        args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--window-size=1920,1080"],
        plugins: [require("puppeteer-extra-plugin-adblocker")({ blockTrackers: true, useCache: true, cacheDir: adblockcachedir })],
    });

    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument((t) => { window.localStorage.setItem("token", JSON.stringify(t)); }, token);

    console.log("Cargando top.gg...");
    await page.goto("https://top.gg", { waitUntil: "networkidle2", timeout: 60000 });
    await delay(5000);

    const passed = await waitForCloudflare(page, 45000);
    if (!passed) {
        console.log("RESULTADO: FALLO - Cloudflare bloqueó la IP de GitHub Actions");
        await browser.close();
        process.exit(1);
    }

    const homeText = await page.evaluate(() => document.body.innerText);
    const isLoggedIn = !homeText.toLowerCase().includes("login");
    console.log("Logueado en top.gg:", isLoggedIn);

    if (!isLoggedIn) {
        console.log("Intentando login...");
        await page.evaluate(() => {
            const el = [...document.querySelectorAll("button,a")].find(e => e.innerText && e.innerText.trim().toLowerCase().includes("login"));
            if (el) el.click();
        });
        await delay(5000);
        try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }); } catch (_) {}
        if (page.url().includes("discord.com")) {
            console.log("En Discord OAuth, autorizando...");
            await page.evaluate(() => {
                const btn = [...document.querySelectorAll("button")].find(b => b.innerText && b.innerText.toLowerCase().includes("authoriz"));
                if (btn) btn.click();
            });
            await delay(5000);
            try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }); } catch (_) {}
        }
        const afterLogin = await page.evaluate(() => document.body.innerText);
        console.log("Logueado tras login:", !afterLogin.toLowerCase().includes("login"));
    }

    const voteUrl = `https://top.gg/bot/${botid}/vote`;
    console.log("Yendo a página de voto:", voteUrl);
    await page.goto(voteUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(5000);
    await waitForCloudflare(page, 45000);

    const voteText = await page.evaluate(() => document.body.innerText);
    console.log("=== TEXTO PÁGINA VOTO (primeros 500 chars) ===");
    console.log(voteText.substring(0, 500));
    console.log("=== FIN TEXTO ===");

    const buttons = await page.evaluate(() =>
        [...document.querySelectorAll("button")].map(b => ({ text: b.innerText.trim(), disabled: b.disabled })).filter(b => b.text)
    );
    console.log("Botones encontrados:", JSON.stringify(buttons));

    if (voteText.includes("You have already voted")) {
        console.log("RESULTADO: Ya votaste hoy - voto registrado correctamente");
        await browser.close();
        process.exit(0);
    }

    const voteBtn = buttons.find(b => b.text.toLowerCase().includes("vote") && !b.disabled);

    if (voteText.includes("You can vote now!") || voteBtn) {
        console.log("Puedo votar, haciendo clic...");
        const clicked = await page.evaluate(() => {
            const btn = [...document.querySelectorAll("button")].find(b =>
                b.innerText && b.innerText.toLowerCase().includes("vote") && !b.disabled
            );
            if (btn) { btn.click(); return true; }
            return false;
        });
        await delay(5000);
        const afterText = await page.evaluate(() => document.body.innerText);
        if (afterText.includes("You have already voted") || afterText.includes("voted")) {
            console.log("RESULTADO: ÉXITO - Voto registrado!");
        } else {
            console.log("RESULTADO: Clic hecho pero sin confirmación clara");
            console.log("Texto tras voto:", afterText.substring(0, 300));
        }
    } else {
        console.log("RESULTADO: No se encontró botón de voto activo");
        console.log("URL actual:", page.url());
    }

    await browser.close();
    process.exit(0);
})();
