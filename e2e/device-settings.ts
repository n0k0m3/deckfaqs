import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CDP_PORT } from './steam';

// Steam's screensaver timeouts. On the test device, the screensaver window froze Steam's UI thread
// while Playwright was attached, and CDP input does not reset Steam's idle timer.
// The run turns the screensaver off and puts the user's values back afterwards.
const FIELDS = {
    system_idle_screensaver_battery_sec: 24008,
    system_idle_screensaver_ac_sec: 24009,
};
// Outside test-results, which Playwright clears at the start of each run
const BACKUP_FILE = 'e2e/.screensaver-backup.json';

// One Runtime.evaluate over a plain CDP socket. Playwright is not used here: it pauses new windows.
async function evaluateInSteam(expression: string): Promise<any> {
    const pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const shared = pages.find((page: any) => page.title === 'SharedJSContext');
    const url = new URL(shared.webSocketDebuggerUrl);
    url.host = `127.0.0.1:${CDP_PORT}`;
    const socket = new WebSocket(url.toString());
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
    });
    try {
        const reply: any = await new Promise((resolve, reject) => {
            socket.onmessage = (event) => resolve(JSON.parse(String(event.data)));
            setTimeout(() => reject(new Error('Steam did not answer')), 15_000);
            socket.send(
                JSON.stringify({
                    id: 1,
                    method: 'Runtime.evaluate',
                    params: { expression, awaitPromise: true, returnByValue: true },
                })
            );
        });
        if (reply.result?.exceptionDetails) {
            throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 300));
        }
        return reply.result?.result?.value;
    } finally {
        socket.close();
    }
}

type Values = Record<keyof typeof FIELDS, number>;

const readValues = (): Promise<Values> =>
    evaluateInSteam(
        `(() => { const s = window.settingsStore.clientSettings; return ${JSON.stringify(
            Object.keys(FIELDS)
        )}.reduce((all, name) => ({ ...all, [name]: s[name] }), {}); })()`
    );

// Same message that Steam's settings screen sends: one CMsgClientSettings field, base64
async function writeValues(values: Values) {
    const writes = Object.entries(values).map(([name, value]) => [FIELDS[name as keyof Values], value]);
    await evaluateInSteam(`(async () => {
        const varint = (n) => { const b = []; while (n > 127) { b.push((n & 127) | 128); n = Math.floor(n / 128); } b.push(n); return b; };
        for (const [field, value] of ${JSON.stringify(writes)}) {
            SteamClient.Settings.SetSetting(btoa(String.fromCharCode(...varint(field * 8), ...varint(value))));
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    })()`);
}

export async function pauseScreensaver() {
    // A backup left by a crashed run holds the user's values; the live values are the zeros
    if (!existsSync(BACKUP_FILE)) {
        writeFileSync(BACKUP_FILE, JSON.stringify(await readValues()));
    }
    await writeValues({ system_idle_screensaver_battery_sec: 0, system_idle_screensaver_ac_sec: 0 });
}

export async function restoreScreensaver() {
    if (!existsSync(BACKUP_FILE)) return;
    const saved: Values = JSON.parse(readFileSync(BACKUP_FILE, 'utf8'));
    await writeValues(saved);
    const now = await readValues();
    if (JSON.stringify(now) !== JSON.stringify(saved)) {
        throw new Error(`screensaver settings not restored: want ${JSON.stringify(saved)}, have ${JSON.stringify(now)}`);
    }
    rmSync(BACKUP_FILE);
}
