import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pauseScreensaver } from './device-settings';
import { CDP_PORT, HOST, REMOTE_HELPER } from './steam';

// Outside test-results, which Playwright clears at the start of each run
export const TUNNEL_PID_FILE = 'e2e/.ssh-tunnel-pid';

async function cdpAnswers() {
    try {
        const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        return response.ok;
    } catch {
        return false;
    }
}

export default async function globalSetup() {
    if (!HOST) throw new Error('Set DFQ_HOST to the SSH host of the test device (see Readme.md)');
    // Copy the device helper every run, so the device never runs a stale copy
    execFileSync('ssh', ['-o', 'BatchMode=yes', HOST, 'mkdir -p deckfaqs-offline-dev']);
    execFileSync('scp', ['-q', 'e2e/device/dfq_device.py', `${HOST}:${REMOTE_HELPER}`]);

    if (!(await cdpAnswers())) await openTunnel();
    await pauseScreensaver();
}

async function openTunnel() {
    const tunnel = spawn(
        'ssh',
        [
            '-N',
            '-o', 'BatchMode=yes',
            '-o', 'ExitOnForwardFailure=yes',
            // Its own connection: a forward added to a shared ControlMaster outlives this process
            '-o', 'ControlMaster=no',
            '-o', 'ControlPath=none',
            '-L', `${CDP_PORT}:127.0.0.1:8080`,
            HOST,
        ],
        { detached: true, stdio: 'ignore' }
    );
    tunnel.unref();
    writeFileSync(TUNNEL_PID_FILE, String(tunnel.pid));
    for (let attempt = 0; attempt < 40; attempt++) {
        if (await cdpAnswers()) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Steam DevTools on ${HOST} did not answer through the tunnel`);
}
