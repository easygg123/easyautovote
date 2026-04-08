const https = require("https");

const token = process.env.TOKEN;
const botid = process.env.BOT_ID;

if (!token || !botid) {
    console.error("Faltan variables TOKEN o BOT_ID");
    process.exit(1);
}

console.log("Bot ID:", botid);

function request(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

(async () => {
    // Intentar votar directamente via API de top.gg
    const voteEndpoint = `/api/bots/${botid}/vote`;
    console.log("Intentando votar via API:", voteEndpoint);

    const res = await request({
        hostname: "top.gg",
        path: voteEndpoint,
        method: "POST",
        headers: {
            "Authorization": token,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": "https://top.gg",
            "Referer": `https://top.gg/bot/${botid}/vote`,
        },
    }, "{}");

    console.log("Respuesta status:", res.status);
    console.log("Respuesta body:", res.body);

    if (res.status === 200 || res.status === 204) {
        console.log("¡Voto enviado exitosamente!");
        process.exit(0);
    } else if (res.status === 401) {
        console.log("Token inválido o expirado.");
        process.exit(1);
    } else if (res.status === 429) {
        console.log("Ya votaste recientemente (rate limit). Intenta más tarde.");
        process.exit(0);
    } else {
        // Intentar con GET para ver el estado
        console.log("POST falló, comprobando estado con GET...");
        const checkRes = await request({
            hostname: "top.gg",
            path: `/api/bots/${botid}`,
            method: "GET",
            headers: {
                "Authorization": token,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        });
        console.log("GET status:", checkRes.status);
        console.log("GET body:", checkRes.body.substring(0, 500));
        process.exit(1);
    }
})();
