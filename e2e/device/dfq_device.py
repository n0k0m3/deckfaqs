"""Device side of the end-to-end tests. Runs on the handheld in the Game Mode user's context.

    python3 dfq_device.py screenshot > frame.png   # whole composited frame, Steam and Decky included
    python3 dfq_device.py touch                    # virtual touchscreen; reads commands on stdin

Touch commands, one per line, each answered with "ok" or "error <reason>":
    tap X Y
    swipe X1 Y1 X2 Y2 MS
    quit
X and Y are physical screen pixels. The device exists only while the process runs.
"""
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

CAPTURE_PATH = Path("/tmp/gamescope.png")
CAPTURE_PROPERTY = "GAMESCOPECTRL_DEBUG_REQUEST_SCREENSHOT"
CAPTURE_TIMEOUT = 20.0


def gamescope_environment() -> dict:
    runtime = Path("/run/user") / str(os.getuid())
    displays = [
        line.removeprefix("DISPLAY=")
        for line in (runtime / "gamescope-environment").read_text().splitlines()
        if line.startswith("DISPLAY=")
    ]
    if len(displays) != 1:
        sys.exit("no single gamescope DISPLAY: is the device in Game Mode?")
    return dict(os.environ, DISPLAY=displays[0], XDG_RUNTIME_DIR=str(runtime))


def screenshot() -> None:
    # gamescopectl screenshot captures the game plane only; this root property captures every overlay too
    before = CAPTURE_PATH.stat().st_mtime_ns if CAPTURE_PATH.is_file() else 0
    subprocess.run(
        ["xprop", "-root", "-f", CAPTURE_PROPERTY, "8s", "-set", CAPTURE_PROPERTY, str(time.time_ns())],
        env=gamescope_environment(), check=True, capture_output=True, timeout=CAPTURE_TIMEOUT,
    )
    deadline = time.monotonic() + CAPTURE_TIMEOUT
    while time.monotonic() < deadline:
        if CAPTURE_PATH.is_file():
            info = CAPTURE_PATH.stat()
            if info.st_mtime_ns > before and info.st_size > 0:
                time.sleep(0.2)  # gamescope can still be writing the file
                with open(CAPTURE_PATH, "rb") as f:
                    shutil.copyfileobj(f, sys.stdout.buffer)
                return
        time.sleep(0.1)
    sys.exit("gamescope did not write a screenshot")


def screen_size() -> tuple:
    for mode_file in sorted(Path("/sys/class/drm").glob("card*-eDP-*/modes")):
        first = mode_file.read_text().split()
        if first:
            width, height = first[0].split("x")
            return int(width), int(height)
    sys.exit("no internal display found")


def touch() -> None:
    from evdev import AbsInfo, UInput, ecodes as e

    width, height = screen_size()
    x_axis = AbsInfo(value=0, min=0, max=width - 1, fuzz=0, flat=0, resolution=10)
    y_axis = AbsInfo(value=0, min=0, max=height - 1, fuzz=0, flat=0, resolution=10)
    capabilities = {
        e.EV_KEY: [e.BTN_TOUCH],
        e.EV_ABS: [
            (e.ABS_X, x_axis),
            (e.ABS_Y, y_axis),
            (e.ABS_MT_SLOT, AbsInfo(0, 0, 9, 0, 0, 0)),
            (e.ABS_MT_TRACKING_ID, AbsInfo(0, 0, 65535, 0, 0, 0)),
            (e.ABS_MT_POSITION_X, x_axis),
            (e.ABS_MT_POSITION_Y, y_axis),
        ],
    }
    device = UInput(capabilities, name="DeckFAQs e2e touchscreen", input_props=[e.INPUT_PROP_DIRECT])
    tracking_id = 0

    def move(x: int, y: int) -> None:
        device.write(e.EV_ABS, e.ABS_MT_POSITION_X, x)
        device.write(e.EV_ABS, e.ABS_MT_POSITION_Y, y)
        device.write(e.EV_ABS, e.ABS_X, x)
        device.write(e.EV_ABS, e.ABS_Y, y)

    def down(x: int, y: int) -> None:
        nonlocal tracking_id
        tracking_id += 1
        device.write(e.EV_ABS, e.ABS_MT_SLOT, 0)
        device.write(e.EV_ABS, e.ABS_MT_TRACKING_ID, tracking_id)
        move(x, y)
        device.write(e.EV_KEY, e.BTN_TOUCH, 1)
        device.syn()

    def up() -> None:
        device.write(e.EV_ABS, e.ABS_MT_TRACKING_ID, -1)
        device.write(e.EV_KEY, e.BTN_TOUCH, 0)
        device.syn()

    try:
        time.sleep(1.0)  # gamescope needs a moment to add the new device
        print(f"ready {width} {height}", flush=True)
        for line in sys.stdin:
            parts = line.split()
            try:
                if not parts:
                    continue
                if parts[0] == "quit":
                    break
                if parts[0] == "tap":
                    x, y = int(parts[1]), int(parts[2])
                    down(x, y)
                    time.sleep(0.06)
                    up()
                elif parts[0] == "swipe":
                    x1, y1, x2, y2, ms = (int(p) for p in parts[1:6])
                    steps = max(2, ms // 16)
                    down(x1, y1)
                    for step in range(1, steps + 1):
                        time.sleep(ms / 1000 / steps)
                        move(x1 + (x2 - x1) * step // steps, y1 + (y2 - y1) * step // steps)
                        device.syn()
                    up()
                else:
                    raise ValueError(f"unknown command {parts[0]}")
                print("ok", flush=True)
            except (ValueError, IndexError) as error:
                print(f"error {error}", flush=True)
    finally:
        device.close()


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "screenshot":
        screenshot()
    elif command == "touch":
        touch()
    else:
        sys.exit(__doc__)
