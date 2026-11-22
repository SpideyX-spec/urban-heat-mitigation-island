import asyncio
import json
import subprocess
import time
import urllib.request
import websockets

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9226

async def capture_scenarios():
    proc = subprocess.Popen([
        CHROME_PATH,
        f"--remote-debugging-port={PORT}",
        "--headless=new",
        "--user-data-dir=C:\\temp\\test_slider_vis_profile"
    ])
    time.sleep(1.5)
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list") as r:
            targets = json.loads(r.read().decode())
        ws_url = targets[0]["webSocketDebuggerUrl"]

        async with websockets.connect(ws_url, max_size=10_000_000) as ws:
            msg_id = 1
            async def send_cmd(method, params=None):
                nonlocal msg_id
                payload = {"id": msg_id, "method": method}
                if params:
                    payload["params"] = params
                await ws.send(json.dumps(payload))
                curr_id = msg_id
                msg_id += 1
                while True:
                    resp = await ws.recv()
                    data = json.loads(resp)
                    if data.get("id") == curr_id:
                        return data

            await send_cmd("Page.enable")
            await send_cmd("Emulation.setDeviceMetricsOverride", {
                "width": 1440,
                "height": 900,
                "deviceScaleFactor": 1,
                "mobile": False
            })

            await send_cmd("Page.navigate", {"url": "http://localhost:5173/new_delhi/scenarios"})
            time.sleep(3)

            # 1. Capture sliders at baseline (0%)
            res = await send_cmd("Runtime.evaluate", {
                "expression": """
                (() => {
                    const el = document.querySelector('.sliders-container');
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: r.x, y: r.y, width: r.width, height: r.height };
                })()
                """,
                "returnByValue": True
            })
            rect = res.get("result", {}).get("result", {}).get("value")
            print("Sliders rect:", rect)

            if rect:
                snap0 = await send_cmd("Page.captureScreenshot", {
                    "format": "png",
                    "clip": {
                        "x": rect["x"],
                        "y": rect["y"],
                        "width": rect["width"],
                        "height": rect["height"],
                        "scale": 1
                    }
                })
                img_data0 = snap0.get("result", {}).get("data")
                if img_data0:
                    import base64
                    with open(r"C:\temp\sliders_baseline_0pct.png", "wb") as f:
                        f.write(base64.b64decode(img_data0))
                    print("Saved sliders at 0% to C:\\temp\\sliders_baseline_0pct.png")

            # 2. Set sliders to test values: 95%, 95%, 85%, 90%, 70% (matching user's screenshot)
            await send_cmd("Runtime.evaluate", {
                "expression": """
                (() => {
                    const testValues = {
                        'slider-tree_cover': '0.95',
                        'slider-cool_roofs': '0.95',
                        'slider-green_roofs': '0.85',
                        'slider-water_bodies': '0.90',
                        'slider-albedo_improvement': '0.70'
                    };
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    for (const [id, val] of Object.entries(testValues)) {
                        const input = document.getElementById(id);
                        if (input) {
                            nativeSetter.call(input, val);
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                })()
                """
            })
            time.sleep(1)

            # Check computed styles and custom property on sliders
            slider_status = await send_cmd("Runtime.evaluate", {
                "expression": """
                (() => {
                    const sliders = Array.from(document.querySelectorAll('.range-slider'));
                    return sliders.map(s => {
                        return {
                            id: s.id,
                            value: s.value,
                            pctVar: s.style.getPropertyValue('--slider-pct'),
                            ariaVal: s.getAttribute('aria-valuenow')
                        };
                    });
                })()
                """,
                "returnByValue": True
            })
            print("Slider status after updates:", json.dumps(slider_status.get("result", {}).get("result", {}).get("value"), indent=2))

            # 3. Capture screenshot of all 5 sliders with active green progress fills
            # Capture builder panel full scroll
            snap_all = await send_cmd("Page.captureScreenshot", {
                "format": "png",
                "clip": {
                    "x": 10,
                    "y": 100,
                    "width": 360,
                    "height": 780,
                    "scale": 1
                }
            })
            img_data_all = snap_all.get("result", {}).get("data")
            if img_data_all:
                import base64
                with open(r"C:\temp\all_5_sliders_filled.png", "wb") as f:
                    f.write(base64.b64decode(img_data_all))
                print("Saved all 5 sliders to C:\\temp\\all_5_sliders_filled.png")

            # 6. Test clicking "Reset" button
            reset_result = await send_cmd("Runtime.evaluate", {
                "expression": """
                (() => {
                    const resetBtn = document.querySelector('.btn-reset');
                    if (resetBtn) {
                        resetBtn.click();
                        return { clicked: true };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            time.sleep(1)

            # Check that all sliders are back to 0%
            reset_status = await send_cmd("Runtime.evaluate", {
                "expression": """
                (() => {
                    const sliders = Array.from(document.querySelectorAll('.range-slider'));
                    return sliders.map(s => ({
                        id: s.id,
                        value: s.value,
                        pctVar: s.style.getPropertyValue('--slider-pct')
                    }));
                })()
                """,
                "returnByValue": True
            })
            print("Sliders after Reset button:", json.dumps(reset_status.get("result", {}).get("result", {}).get("value"), indent=2))

            # 7. Test clicking a Preset (Preset 1 = Cool Roofs or Greenery)
            preset_result = await send_cmd("Runtime.evaluate", {
                "expression": """
                (() => {
                    const presets = document.querySelectorAll('.btn-preset');
                    if (presets.length > 1) {
                        presets[1].click();
                        return { clicked: true, presetName: presets[1].textContent.trim().substring(0, 30) };
                    }
                    return { clicked: false };
                })()
                """,
                "returnByValue": True
            })
            time.sleep(2)

            preset_slider_status = await send_cmd("Runtime.evaluate", {
                "expression": """
                (() => {
                    const sliders = Array.from(document.querySelectorAll('.range-slider'));
                    return sliders.map(s => ({
                        id: s.id,
                        value: s.value,
                        pctVar: s.style.getPropertyValue('--slider-pct')
                    }));
                })()
                """,
                "returnByValue": True
            })
            print(f"Preset loaded ({preset_result.get('result', {}).get('result', {}).get('value')}):")
            print(json.dumps(preset_slider_status.get("result", {}).get("result", {}).get("value"), indent=2))
    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(capture_scenarios())
