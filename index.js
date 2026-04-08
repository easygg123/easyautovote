const packageJson = require("./package.json");
const cp = require("child_process");
const path = require("path");
const fse = require("fs-extra");

for (let dep of Object.keys(packageJson.dependencies)) {
    try { require.resolve(dep); }
    catch (err) { console.log("Installing dependencies..."); cp.execSync("npm i"); }
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
            return true;
        }
    }
    return false;
}

(async () => {
    console.log("Iniciando votador top.gg | Bot:", botid);

    const { browser, page } = await connect({
        headless: false,
        turnstile: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--window-size=1920,1080",
        ],
        plugins: [
            require("puppeteer-extra-plugin-adblocker")({
                blockTrackers: true,
                useCache: true,
                cacheDir: adblockcachedir,
            }),
        ],
    });

    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument((t) => {
        window.localStorage.setItem("token", JSON.stringify(t));
    }, token);

    console.log("Cargando top.gg...");
    await page.goto("https://top.gg", { waitUntil: "networkidle2", timeout: 60000 });
    await delay(5000);

    const passed = await waitForCloudflare(page, 45000);
    if (!passed) {
        console.log("No se pudo pasar Cloudflare.");
        await browser.close();
        process.exit(1);
    }

    const homeText = await page.evaluate(() => document.body.innerText.substring(0, 300));
    const isLoggedIn = !homeText.toLowerCase().includes("login");
    console.log("Logueado:", isLoggedIn);

    if (!isLoggedIn) {
        await page.evaluate(() => {
            const el = [...document.querySelectorAll("button,a")].find(e =>
                e.innerText && e.innerText.trim().toLowerCase().includes("login")
            );
            if (el) el.click();
        });
        await delay(5000);
        try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }); } catch (_) {}
        if (page.url().includes("discord.com")) {
            await page.evaluate(() => {
                const btn = [...document.querySelectorAll("button")].find(b =>
                    b.innerText && b.innerText.toLowerCase().includes("authoriz")
                );
                if (btn) btn.click();
            });
            await delay(5000);
            try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }); } catch (_) {}
        }
    }

    const voteUrl = `https://top.gg/bot/${botid}/vote`;
    console.log("Cargando página de voto:", voteUrl);
    await page.goto(voteUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(5000);
    await waitForCloudflare(page, 45000);

    const voteText = await page.evaluate(() => document.body.innerText);
    console.log("Texto:", voteText.substring(0, 200));

    if (voteText.includes("You have already voted")) {
        console.log("Ya votaste hoy. Todo OK.");
        await browser.close();
        process.exit(0);
    }

    if (voteText.includes("You can vote now!") ||
        await page.evaluate(() => [...document.querySelectorAll("button")].some(b =>
            b.innerText && b.innerText.toLowerCase().includes("vote") && !b.disabled
        ))
    ) {
        console.log("Votando...");
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll("button")].find(b =>
                b.innerText && b.innerText.toLowerCase().includes("vote") && !b.disabled
            );
            if (btn) btn.click();
        });
        await delay(5000);
        console.log("Voto enviado.");
    } else {
        console.log("Estado desconocido:", voteText.substring(0, 300));
    }

    await browser.close();
    process.exit(0);
})();
