/*
 * OwO Farm Bot Stable / https://github.com/Mid0Hub/owofarmbot_stable/blob/main/utils/autovote.js
 * Copyright (C) 2024 Mido
 * This software is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 * For more information, see README.md and LICENSE
 */

const packageJson = require('./package.json');
const cp = require('child_process');
const path = require('path');
const fse = require('fs-extra');

for (let dep of Object.keys(packageJson.dependencies)) {
    try {
        require.resolve(dep);
    } catch (err) {
        console.log('Installing dependencies...');
        cp.execSync('npm i');
    }
}

const { connect } = require('puppeteer-real-browser');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adblockcachedir = path.resolve(__dirname, './adblockcache');

if (!fse.existsSync(adblockcachedir)) {
    fse.mkdirSync(adblockcachedir, { recursive: true });
}

const token = process.env.TOKEN;
const botid = process.env.BOT_ID;

if (!token || !botid) {
    console.error('Error: Se requieren las variables de entorno TOKEN y BOT_ID');
    process.exit(1);
}

(async () => {
    const topcici = 'https://top.gg';

    const { browser, page } = await connect({
        headless: true,
        turnstile: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
        plugins: [
            require('puppeteer-extra-plugin-adblocker')({
                blockTrackers: true,
                useCache: true,
                cacheDir: adblockcachedir,
            }),
        ],
    });
    await page.setViewport({ width: 1920, height: 1080 });

    await page.evaluateOnNewDocument((token) => {
        window.localStorage.setItem('token', JSON.stringify(token));
    }, token);

    await page.goto(topcici, { waitUntil: 'load' });
    await page.waitForSelector('.chakra-button.css-7rul47', { visible: true });
    await page.locator('.chakra-button.css-7rul47').setTimeout(3000).click();

    await page.waitForNavigation({ waitUntil: 'load' });
    await page.waitForSelector('div.action__3d3b0 button', { visible: true });
    await page.locator('div.action__3d3b0 button').setTimeout(3000).click();

    await page.waitForNavigation({ waitUntil: 'load' });
    await delay(5000);

    const isLoggedIn = await page.evaluate(() => {
        return !document.body.innerText.includes('Login');
    });

    if (isLoggedIn) {
        let topgglink = 'https://top.gg/bot/' + botid + '/vote';
        await page.goto(topgglink, { waitUntil: 'load' });

        while (true) {
            const isAlreadyVoted = await page.evaluate(() => {
                return document.body.innerText.includes('You have already voted');
            });
            const isvoteable = await page.evaluate(() => {
                return document.body.innerText.includes('You can vote now!');
            });

            if (isAlreadyVoted) {
                console.log('You have already voted. Exiting...');
                await browser.close();
                process.exit(0);
            }
            if (isvoteable) break;
            else await delay(2500);
        }

        await page.evaluate(() => {
            const button = document.querySelector('div.css-1yn6pjb button.chakra-button.css-7rul47');
            if (!button || button.disabled) return;
            button.click();
        });

        await delay(5000);
        console.log('Vote submitted successfully!');
    } else {
        console.log('Authorization failed.');
    }

    await browser.close();
})();
