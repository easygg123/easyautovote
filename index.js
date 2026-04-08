/*
 * top.gg Automatic Voter - Railway compatible
 */

const packageJson = require("./package.json");
const cp = require("child_process");
const path = require("path");
const fse = require("fs-extra");

for (let dep of Object.keys(packageJson.dependencies)) {
    try {
        require.resolve(dep);
    } catch (err) {
        console.log("Installing dependencies...");
        cp.execSync(`npm i`);
    }
}

const { connect } = require("puppeteer-real-browser");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adblockcachedir = path.resolve(__dirname, "./adblockcache");
if (!fse.existsSync(adblockcachedir)) {
    fse.mkdirSync(adblockcachedir, { recursive: true });
}

const token = process.env.TOKEN;
const botid = process.env.BOT_ID;

if (!token || !botid) {
    console.error("Error: Se requieren las variables de entorno TOKEN y BOT_ID");
    process.exit(1);
}

(async () => {
    console.log("Iniciando votador top.gg...");
    console.log("Bot ID:", botid);

    const { browser, page } = await connect({
        headless: true,
        turnstile: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
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

    // Inyectar token de Discord en localStorage antes de cargar
    await page.evaluateOnNewDocument((t) => {
        window.localStorage.setItem("token", JSON.stringify(t));
    }, token);

    console.log("Cargando top.gg...");
    await page.goto("https://top.gg", { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000);

    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasLogin = bodyText.toLowerCase().includes("login");
    const isLoggedIn = !hasLogin;

    console.log("¿Ya logueado?", isLoggedIn);

    // Solo hacer login si NO está logueado
    if (!isLoggedIn) {
        console.log("No está logueado, iniciando flujo de login...");

        // Buscar botón de login por texto
        try {
            await page.waitForFunction(
                () => {
                    const els = [...document.querySelectorAll("button, a")];
                    return els.some(el => el.innerText && el.innerText.trim().toLowerCase().includes("login"));
                },
                { timeout: 15000 }
            );
            await page.evaluate(() => {
                const els = [...document.querySelectorAll("button, a")];
                const el = els.find(el => el.innerText && el.innerText.trim().toLowerCase().includes("login"));
                if (el) el.click();
            });
            console.log("Clic en Login hecho");
        } catch (e) {
            console.log("No se encontró botón de login:", e.message);
        }

        // Esperar posible redireccion a Discord
        await delay(3000);
        try {
            await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 });
        } catch (_) {}

        const currentUrl = page.url();
        console.log("URL tras login:", currentUrl);

        if (currentUrl.includes("discord.com")) {
            console.log("En Discord OAuth, autorizando...");
            try {
                await page.waitForSelector("div.action__3d3b0 button", { visible: true, timeout: 15000 });
                await page.click("div.action__3d3b0 button");
            } catch (_) {
                await page.evaluate(() => {
                    const btns = [...document.querySelectorAll("button")];
                    const btn = btns.find(b => b.innerText && b.innerText.toLowerCase().includes("authoriz"));
                    if (btn) btn.click();
                });
            }
            await delay(3000);
            try {
                await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
            } catch (_) {}
        }
    }

    // Ir directamente a votar
    const voteUrl = `https://top.gg/bot/${botid}/vote`;
    console.log("Yendo a:", voteUrl);
    await page.goto(voteUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000);

    // Verificar estado del voto en un loop
    let attempts = 0;
    while (attempts < 20) {
        const text = await page.evaluate(() => document.body.innerText);

        if (text.includes("You have already voted")) {
            console.log("Ya votaste hoy. El voto fue registrado correctamente.");
            await browser.close();
            process.exit(0);
        }

        if (text.includes("You can vote now!")) {
            console.log("Puedo votar ahora, haciendo clic...");

            const clicked = await page.evaluate(() => {
                const buttons = [...document.querySelectorAll("button")];
                const voteBtn = buttons.find(b =>
                    b.innerText && b.innerText.toLowerCase().includes("vote") && !b.disabled
                );
                if (voteBtn) { voteBtn.click(); return true; }
                return false;
            });

            if (clicked) {
                console.log("Botón de voto clicado. Esperando confirmación...");
                await delay(5000);
                const afterText = await page.evaluate(() => document.body.innerText);
                if (afterText.includes("You have already voted") || afterText.includes("voted")) {
                    console.log("¡Voto registrado exitosamente!");
                } else {
                    console.log("Voto enviado.");
                }
            } else {
                console.log("No se encontró botón de voto activo.");
            }

            await browser.close();
            process.exit(0);
        }

        console.log("Esperando para votar... intento", attempts + 1);
        await delay(5000);
        attempts++;
    }

    console.log("No se pudo completar el voto después de varios intentos.");
    await browser.close();
    process.exit(1);
})();
