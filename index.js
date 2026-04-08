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

// Clicks the first button/link that contains the given text
async function clickByText(page, text, timeout = 30000) {
    console.log(`Buscando elemento con texto: "${text}"`);
    await page.waitForFunction(
        (t) => {
            const els = [...document.querySelectorAll("button, a")];
            return els.some(el => el.innerText && el.innerText.trim().toLowerCase().includes(t.toLowerCase()));
        },
        { timeout },
        text
    );
    await page.evaluate((t) => {
        const els = [...document.querySelectorAll("button, a")];
        const el = els.find(el => el.innerText && el.innerText.trim().toLowerCase().includes(t.toLowerCase()));
        if (el) el.click();
    }, text);
}

// Tries a CSS selector first, then falls back to text search
async function clickElement(page, selector, fallbackText, timeout = 30000) {
    try {
        await page.waitForSelector(selector, { visible: true, timeout: 10000 });
        await page.locator(selector).setTimeout(5000).click();
        console.log(`Clic en selector: ${selector}`);
    } catch (e) {
        console.log(`Selector "${selector}" no encontrado, buscando por texto: "${fallbackText}"`);
        await clickByText(page, fallbackText, timeout);
    }
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

    // Inyectar token de Discord en localStorage antes de cargar la página
    await page.evaluateOnNewDocument((t) => {
        window.localStorage.setItem("token", JSON.stringify(t));
    }, token);

    console.log("Cargando top.gg...");
    await page.goto("https://top.gg", { waitUntil: "networkidle2", timeout: 60000 });
    await delay(3000);

    const pageText = await page.evaluate(() => document.body.innerText);
    console.log("Página cargada. ¿Contiene Login?", pageText.includes("Login"));

    // Clic en Login
    await clickElement(page, ".chakra-button.css-7rul47", "login", 30000);
    await delay(2000);

    // Esperar navegación (puede ir a Discord OAuth)
    try {
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
    } catch (e) {
        console.log("No hubo navegación tras el login (posiblemente ya autenticado)");
    }

    await delay(3000);

    // Si estamos en Discord, hacer clic en Authorize
    const currentUrl = page.url();
    console.log("URL actual:", currentUrl);

    if (currentUrl.includes("discord.com")) {
        console.log("Redirigido a Discord, autorizando...");
        await clickElement(page, "div.action__3d3b0 button", "authorize", 30000);
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });
        await delay(3000);
    }

    // Verificar si está logueado
    const bodyText = await page.evaluate(() => document.body.innerText);
    const isLoggedIn = !bodyText.includes("Login");
    console.log("¿Logueado?", isLoggedIn);

    if (isLoggedIn) {
        const voteUrl = `https://top.gg/bot/${botid}/vote`;
        console.log("Yendo a votar:", voteUrl);
        await page.goto(voteUrl, { waitUntil: "networkidle2", timeout: 60000 });
        await delay(3000);

        // Esperar hasta que se pueda votar o ya haya votado
        while (true) {
            const text = await page.evaluate(() => document.body.innerText);

            if (text.includes("You have already voted")) {
                console.log("Ya votaste hoy. Saliendo...");
                await browser.close();
                process.exit(0);
            }

            if (text.includes("You can vote now!") || text.includes("Vote")) {
                console.log("Votando...");
                break;
            }

            console.log("Esperando para poder votar...");
            await delay(3000);
        }

        // Clic en el botón de votar
        await page.evaluate(() => {
            const buttons = [...document.querySelectorAll("button")];
            const voteBtn = buttons.find(b =>
                b.innerText && (
                    b.innerText.toLowerCase().includes("vote") ||
                    b.classList.contains("chakra-button")
                ) && !b.disabled
            );
            if (voteBtn) {
                voteBtn.click();
                return true;
            }
            return false;
        });

        await delay(5000);
        console.log("¡Voto enviado exitosamente!");
    } else {
        console.log("Fallo de autenticación. Verifica que el TOKEN sea correcto.");
    }

    await browser.close();
    process.exit(0);
})();
