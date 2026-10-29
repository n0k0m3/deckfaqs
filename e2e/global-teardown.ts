import { readFileSync, rmSync } from 'node:fs';
import { restoreScreensaver } from './device-settings';
import { TUNNEL_PID_FILE } from './global-setup';

export default async function globalTeardown() {
    await restoreScreensaver();
    let pid: number;
    try {
        pid = Number(readFileSync(TUNNEL_PID_FILE, 'utf8'));
    } catch {
        return; // setup reused a tunnel that it did not start
    }
    try {
        process.kill(pid);
    } catch {}
    rmSync(TUNNEL_PID_FILE, { force: true });
}
