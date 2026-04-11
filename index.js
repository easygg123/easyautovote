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
              console.log("Cloudflare verificando...");
              await delay(3000);
          } else {
              return true;
          }
      }
      return false;
  }

  async function checkLoggedIn(page) {
      return await page.evaluate(() => {
          // Buscar avatar de usuario o elementos que solo aparecen cuando estás logueado
          const hasAvatar = !!document.querySelector("img[src*='cdn.discordapp.com/avatars']");
          const hasUserMenu = !!document.querySelector("[data-test='user-menu'], [class*='userAvatar'], [class*='avatar']");
          // Si hay un botón de Login visible en el nav, no estamos logueados
          const loginBtn = [...document.querySelectorAll("a, button")].find(el => {
              const txt = el.innerText?.trim().toLowerCase();
              return txt === "login" || txt === "log in" || txt === "sign in";
          });
          if (loginBtn) return false;
          if (hasAvatar || hasUserMenu) return true;
          // Como último recurso, verificar si hay token en localStorage
          const lsToken = localStorage.getItem("token");
          return !!lsToken;
      });
  }

  async function waitForVoteButton(page, maxMs = 30000) {
      console.log("Esperando botón de voto activo (puede haber un anuncio de ~5 seg)...");
      const start = Date.now();
      while (Date.now() - start < maxMs) {
          const result = await page.evaluate(() => {
              const buttons = [...document.querySelectorAll("button")];
              const voteBtn = buttons.find(b => {
                  const txt = b.innerText.trim().toLowerCase();
                  return (txt.includes("vote") || txt === "vote") && !b.disabled;
              });
              if (voteBtn) return { found: true, text: voteBtn.innerText.trim() };
              const adBtn = buttons.find(b => /^\d+$/.test(b.innerText.trim()));
              if (adBtn) return { found: false, ad: adBtn.innerText.trim() };
              return { found: false };
          });

          if (result.found) {
              console.log("Botón de voto activo encontrado:", result.text);
              return true;
          }
          if (result.ad) {
              console.log("Anuncio en progreso, contador:", result.ad, "seg...");
          }
          await delay(1500);
      }
      return false;
  }

  (async () => {
      console.log("=== VOTADOR TOP.GG | Bot:", botid, "===");

      const { browser, page } = await connect({
          headless: false,
          turnstile: true,
          args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--window-size=1920,1080"],
          plugins: [require("puppeteer-extra-plugin-adblocker")({ blockTrackers: true, useCache: true, cacheDir: adblockcachedir })],
      });

      await page.setViewport({ width: 1920, height: 1080 });

      // Inyectar token antes de cada carga de página
      await page.evaluateOnNewDocument((t) => {
          window.localStorage.setItem("token", JSON.stringify(t));
      }, token);

      console.log("Cargando top.gg...");
      await page.goto("https://top.gg", { waitUntil: "networkidle2", timeout: 60000 });
      await delay(4000);

      const passed = await waitForCloudflare(page, 45000);
      if (!passed) { console.log("FALLO: Cloudflare bloqueó la IP"); await browser.close(); process.exit(1); }

      // Recargar la página para que top.gg procese el token del localStorage
      console.log("Recargando para procesar token...");
      await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
      await delay(5000);

      const isLoggedIn = await checkLoggedIn(page);
      console.log("Logueado:", isLoggedIn);

      if (!isLoggedIn) {
          console.log("ERROR: No se pudo iniciar sesión. Verifica que el TOKEN sea correcto y no haya expirado.");
          await browser.close();
          process.exit(1);
      }

      const voteUrl = `https://top.gg/bot/${botid}/vote`;
      console.log("Cargando página de voto...");
      await page.goto(voteUrl, { waitUntil: "networkidle2", timeout: 60000 });
      await delay(3000);
      await waitForCloudflare(page, 45000);

      const pageText = await page.evaluate(() => document.body.innerText);

      if (pageText.includes("You have already voted")) {
          console.log("RESULTADO: Ya votaste recientemente — espera el tiempo de cooldown.");
          await browser.close();
          process.exit(0);
      }

      const btnReady = await waitForVoteButton(page, 30000);

      if (btnReady) {
          await page.evaluate(() => {
              const btn = [...document.querySelectorAll("button")].find(b =>
                  b.innerText && b.innerText.trim().toLowerCase().includes("vote") && !b.disabled
              );
              if (btn) btn.click();
          });
          console.log("Clic en botón de voto hecho. Esperando confirmación...");
          await delay(6000);

          const afterText = await page.evaluate(() => document.body.innerText);
          if (afterText.includes("You have already voted") || afterText.includes("Your vote has been cast") || afterText.includes("successfully voted")) {
              console.log("RESULTADO: ÉXITO — Voto registrado correctamente!");
          } else {
              console.log("RESULTADO: Clic hecho pero no se confirmó el voto. Texto:", afterText.substring(0, 300));
              process.exit(1);
          }
      } else {
          const finalText = await page.evaluate(() => document.body.innerText);
          console.log("RESULTADO: No se encontró botón de voto. Texto:", finalText.substring(0, 300));
          process.exit(1);
      }

      await browser.close();
      process.exit(0);
  })();